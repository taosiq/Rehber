"""Tools the agent can call.

Security: every tool is built per request and bound to ONE tenant and
conversation on the server. The model only supplies the arguments a customer
could know (dates, names, order numbers), never which business to act on.

Each tool returns (text for the model, structured artifact for the UI card).
"""

import re
import uuid
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from langchain_core.tools import BaseTool, StructuredTool
from pydantic import BaseModel, Field
from sqlalchemy import select

from app.core.config import get_settings
from app.db.session import SessionLocal
from app.models import Appointment, Conversation, Order
from app.services.agent.sources import SourceRegistry, format_sources
from app.services.booking import BookingError, available_slots, book, find_service
from app.services.business import BusinessSettings
from app.services.search import search_chunks


@dataclass
class ToolContext:
    tenant_id: uuid.UUID
    conversation_id: uuid.UUID
    turn_id: str  # id of the customer message being answered
    settings: BusinessSettings
    registry: SourceRegistry


def _parse_date(value: str) -> date:
    try:
        return date.fromisoformat(value.strip()[:10])
    except ValueError as exc:
        raise BookingError("Date must look like 2026-11-20.") from exc


def _digits(s: str) -> str:
    return re.sub(r"\D", "", s)


def normalize_time(value: str) -> str:
    try:
        return datetime.strptime(value.strip()[:5], "%H:%M").strftime("%H:%M")
    except ValueError as exc:
        raise BookingError("Time must look like 14:30.") from exc


def booking_key(d: dict) -> str:
    """Compare proposals loosely: case, spacing and phone formatting don't matter."""
    contact = d["customer_contact"].lower()
    contact = _digits(contact) if "@" not in contact else contact.replace(" ", "")
    name = " ".join(d["customer_name"].lower().split())
    return "|".join([name, contact, d["date"], d["time"], d["service"].lower()])


def contact_matches(order: Order, given: str) -> bool:
    """Accept the order's email (case-insensitive) or phone (last 7+ digits)."""
    given = given.strip().lower()
    if order.customer_email and given == order.customer_email.lower():
        return True
    g, p = _digits(given), _digits(order.customer_phone or "")
    return len(g) >= 7 and len(p) >= 7 and (p.endswith(g) or g.endswith(p))


# ---------- argument schemas (what the model may provide) ----------


class SearchArgs(BaseModel):
    query: str = Field(description="Short search query about the business, e.g. 'parking' or 'refund policy'")


class AvailabilityArgs(BaseModel):
    date: str = Field(description="Date in YYYY-MM-DD format (use the calendar in your instructions)")
    service: str | None = Field(
        default=None, description="Service name exactly as written in your services list (not translated)"
    )


class BookArgs(BaseModel):
    customer_name: str = Field(description="Customer's full name")
    customer_contact: str = Field(description="Customer's phone number or email")
    date: str = Field(description="Date in YYYY-MM-DD format")
    time: str = Field(description="Start time in 24h HH:MM format, one of the free times")
    service: str | None = Field(
        default=None, description="Service name exactly as written in your services list (not translated)"
    )
    notes: str | None = Field(default=None, description="Optional note from the customer")


class OrderArgs(BaseModel):
    order_number: str = Field(description="Order number exactly as the customer gave it")
    email_or_phone: str = Field(description="Email or phone number used for the order")


class HandoffArgs(BaseModel):
    reason: str = Field(description="One sentence: what the customer needs help with")
    customer_contact: str | None = Field(default=None, description="Customer's phone or email, if known")


def build_tools(ctx: ToolContext) -> list[BaseTool]:
    s = ctx.settings

    async def search_knowledge(query: str):
        async with SessionLocal() as db:
            hits = await search_chunks(db, ctx.tenant_id, query, 4)
        hits = [h for h in hits if h.score >= get_settings().min_relevance]
        found = ctx.registry.add(hits)
        if not found:
            return "No matching information found in the business's documents.", {"query": query, "found": 0}
        return format_sources(found), {"query": query, "found": len(found), "sources": [x.n for x in found]}

    async def check_availability(date: str, service: str | None = None):
        try:
            day = _parse_date(date)
            async with SessionLocal() as db:
                svc, slots = await available_slots(db, ctx.tenant_id, s, day, service)
        except BookingError as exc:
            return f"Error: {exc}", {"error": str(exc), "date": date}
        artifact = {"date": day.isoformat(), "weekday": day.strftime("%A"), "service": svc.name,
                    "minutes": svc.minutes, "slots": slots}
        if not slots:
            return f"No free times on {day.strftime('%A')} {day.isoformat()} for {svc.name}.", artifact
        return (
            f"Free start times on {day.strftime('%A')} {day.isoformat()} for {svc.name} ({svc.minutes} min): "
            + ", ".join(slots),
            artifact,
        )

    async def book_appointment(customer_name: str, customer_contact: str, date: str, time: str,
                               service: str | None = None, notes: str | None = None):
        """Two-step booking enforced in code:
        1st call -> validates the slot and stores a *proposal* (nothing booked).
        Same details again in a LATER customer turn -> books it.
        So the customer always sees the details and replies before anything is reserved.
        """
        try:
            day = _parse_date(date)
            svc = find_service(s, service)
            hm = normalize_time(time)
            details = {
                "customer_name": customer_name.strip(), "customer_contact": customer_contact.strip(),
                "date": day.isoformat(), "time": hm, "service": svc.name,
            }
            key = booking_key(details)
            tz = ZoneInfo(s.timezone)
            start = datetime.combine(day, datetime.strptime(hm, "%H:%M").time(), tz)
            card = details | {"weekday": day.strftime("%A"),
                              "end_time": (start + timedelta(minutes=svc.minutes)).strftime("%H:%M")}

            async with SessionLocal() as db:
                convo = await db.get(Conversation, ctx.conversation_id)
                if convo is None or convo.tenant_id != ctx.tenant_id:
                    return "Error: conversation not found.", {"error": "conversation not found"}

                # Already booked in this conversation? Return the same code (idempotent).
                existing = await db.scalar(select(Appointment).where(
                    Appointment.tenant_id == ctx.tenant_id, Appointment.conversation_id == ctx.conversation_id,
                    Appointment.status == "confirmed", Appointment.start_at == start))
                if existing:
                    return (f"Already booked earlier in this conversation. Confirmation code {existing.code}.",
                            card | {"code": existing.code})

                pending = convo.pending_action or {}
                confirmed = (pending.get("type") == "booking" and pending.get("key") == key
                             and pending.get("turn") != ctx.turn_id)
                if not confirmed:
                    _, slots = await available_slots(db, ctx.tenant_id, s, day, svc.name)
                    if hm not in slots:
                        raise BookingError(f"{hm} is not available on {day.isoformat()}. "
                                           f"Free times: {', '.join(slots[:6]) or 'none'}.")
                    convo.pending_action = {"type": "booking", "key": key, "turn": ctx.turn_id, "details": details}
                    await db.commit()
                    return (
                        "NOT BOOKED YET. Show the customer these details and ask them to confirm: "
                        f"{svc.name} on {card['weekday']} {day.isoformat()} at {hm}-{card['end_time']}, "
                        f"name {details['customer_name']}, contact {details['customer_contact']}. When they confirm "
                        "in their next message, call book_appointment again with exactly the same details.",
                        card | {"pending": True},
                    )

                b = await book(db, ctx.tenant_id, s, day=day, start_time=hm, customer_name=details["customer_name"],
                               customer_contact=details["customer_contact"], service_name=svc.name, notes=notes,
                               conversation_id=ctx.conversation_id)
                convo = await db.get(Conversation, ctx.conversation_id)
                convo.pending_action = None
                await db.commit()
        except BookingError as exc:
            return f"Booking failed: {exc}", {"error": str(exc)}
        return (
            f"Booked. Confirmation code {b.code}: {b.service} on {card['weekday']} {card['date']} "
            f"{card['time']}-{card['end_time']} for {b.customer_name}.",
            card | {"code": b.code},
        )

    async def get_order_status(order_number: str, email_or_phone: str):
        number = order_number.strip().lstrip("#").upper()
        async with SessionLocal() as db:
            order = await db.scalar(
                select(Order).where(Order.tenant_id == ctx.tenant_id, Order.order_number == number)
            )
        # Same message whether the order is missing or the contact is wrong: no info leak.
        if order is None or not contact_matches(order, email_or_phone):
            msg = "No order matches that order number and contact detail."
            return msg, {"error": msg, "order_number": number}
        items = ", ".join(f"{i.get('qty', 1)}x {i.get('name')}" for i in order.items)
        artifact = {
            "order_number": order.order_number, "status": order.status, "items": order.items,
            "total": f"{order.total:.2f}", "currency": order.currency, "carrier": order.carrier,
            "tracking_number": order.tracking_number,
            "estimated_delivery": order.estimated_delivery.isoformat() if order.estimated_delivery else None,
        }
        text = (f"Order {order.order_number}: status {order.status}. Items: {items}. Total {artifact['total']} "
                f"{order.currency}.")
        if order.carrier:
            text += f" Carrier {order.carrier}, tracking {order.tracking_number or 'n/a'}."
        if order.estimated_delivery:
            text += f" Estimated delivery {artifact['estimated_delivery']}."
        return text, artifact

    async def handoff_to_human(reason: str, customer_contact: str | None = None):
        async with SessionLocal() as db:
            convo = await db.get(Conversation, ctx.conversation_id)
            if convo is None or convo.tenant_id != ctx.tenant_id:
                return "Error: conversation not found.", {"error": "conversation not found"}
            convo.status = "handoff"
            convo.handoff_reason = reason[:1000]
            convo.handoff_at = datetime.now(timezone.utc)
            if customer_contact:
                convo.customer_contact = customer_contact[:200]
            await db.commit()
        return (
            "Handed off. The team has been notified and will contact the customer.",
            {"reason": reason, "customer_contact": customer_contact},
        )

    def make(fn, name: str, description: str, schema: type[BaseModel]) -> BaseTool:
        return StructuredTool.from_function(
            coroutine=fn, name=name, description=description, args_schema=schema,
            response_format="content_and_artifact",
        )

    tools = [make(search_knowledge, "search_knowledge",
                  "Search the business's documents for information not already in your sources.", SearchArgs)]
    if s.tools.booking:
        tools += [
            make(check_availability, "check_availability",
                 "List free appointment start times for a date (and optional service).", AvailabilityArgs),
            make(book_appointment, "book_appointment",
                 "Book an appointment. Only call after the customer confirmed all details.", BookArgs),
        ]
    if s.tools.orders:
        tools.append(make(get_order_status, "get_order_status",
                          "Look up an order's status. Requires order number and the email or phone on the order.",
                          OrderArgs))
    if s.tools.handoff:
        tools.append(make(handoff_to_human, "handoff_to_human",
                          "Pass the conversation to a human team member.", HandoffArgs))
    return tools
