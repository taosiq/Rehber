"""Appointment availability and booking.

All times are handled in the business's own timezone and stored in UTC.
"""

import secrets
import uuid
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Appointment
from app.services.business import WEEKDAYS, BusinessSettings, Service

MIN_LEAD = timedelta(minutes=30)  # don't offer slots starting within the next 30 minutes


class BookingError(Exception):
    """A problem the customer should be told about (closed day, slot taken...)."""


@dataclass
class Booked:
    code: str
    service: str
    start: datetime  # local time
    end: datetime
    customer_name: str


def _parse_hm(s: str) -> time:
    h, m = map(int, s.split(":"))
    return time(h, m)


def find_service(settings: BusinessSettings, name: str | None) -> Service:
    services = settings.booking.services
    if name:
        wanted = name.strip().lower()
        for s in services:
            if s.name.lower() == wanted or wanted in s.name.lower() or s.name.lower() in wanted:
                return s
    if len(services) == 1 or not name:
        return services[0] if services else Service(name=name or "Appointment", minutes=settings.booking.slot_minutes)
    names = ", ".join(s.name for s in services)
    raise BookingError(f"Unknown service '{name}'. Available services: {names}.")


def _opening(settings: BusinessSettings, day: date) -> tuple[time, time] | None:
    span = settings.booking.hours.get(WEEKDAYS[day.weekday()])
    if not span:
        return None
    start, end = span.split("-")
    return _parse_hm(start), _parse_hm(end)


def _validate_day(settings: BusinessSettings, day: date, now_local: datetime) -> tuple[time, time]:
    if day < now_local.date():
        raise BookingError("That date is in the past.")
    if day > now_local.date() + timedelta(days=settings.booking.max_days_ahead):
        raise BookingError(f"Bookings are only possible up to {settings.booking.max_days_ahead} days ahead.")
    hours = _opening(settings, day)
    if hours is None:
        raise BookingError(f"The business is closed on {day.strftime('%A')}s.")
    return hours


async def _busy_ranges(db: AsyncSession, tenant_id: uuid.UUID, day_start: datetime, day_end: datetime):
    rows = await db.scalars(
        select(Appointment).where(
            Appointment.tenant_id == tenant_id,
            Appointment.status == "confirmed",
            Appointment.start_at < day_end,
            Appointment.end_at > day_start,
        )
    )
    return [(a.start_at, a.end_at) for a in rows]


async def available_slots(
    db: AsyncSession,
    tenant_id: uuid.UUID,
    settings: BusinessSettings,
    day: date,
    service_name: str | None = None,
    now: datetime | None = None,
) -> tuple[Service, list[str]]:
    tz = ZoneInfo(settings.timezone)
    now_local = (now or datetime.now(tz)).astimezone(tz)
    open_t, close_t = _validate_day(settings, day, now_local)
    service = find_service(settings, service_name)
    duration = timedelta(minutes=service.minutes)
    step = timedelta(minutes=settings.booking.slot_minutes)

    day_open = datetime.combine(day, open_t, tz)
    day_close = datetime.combine(day, close_t, tz)
    busy = await _busy_ranges(db, tenant_id, day_open, day_close)

    slots: list[str] = []
    t = day_open
    while t + duration <= day_close:
        free = t >= now_local + MIN_LEAD and all(not (t < b_end and t + duration > b_start) for b_start, b_end in busy)
        if free:
            slots.append(t.strftime("%H:%M"))
        t += step
    return service, slots


def _new_code() -> str:
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # no look-alikes (0/O, 1/I)
    return "RB-" + "".join(secrets.choice(alphabet) for _ in range(5))


async def book(
    db: AsyncSession,
    tenant_id: uuid.UUID,
    settings: BusinessSettings,
    *,
    day: date,
    start_time: str,
    customer_name: str,
    customer_contact: str,
    service_name: str | None,
    notes: str | None = None,
    conversation_id: uuid.UUID | None = None,
    now: datetime | None = None,
) -> Booked:
    service, slots = await available_slots(db, tenant_id, settings, day, service_name, now)
    try:
        hm = _parse_hm(start_time).strftime("%H:%M")
    except ValueError as exc:
        raise BookingError("Time must look like 14:30.") from exc
    if hm not in slots:
        nearby = ", ".join(slots[:6]) or "none"
        raise BookingError(f"{hm} is not available on {day.isoformat()}. Free times: {nearby}.")

    tz = ZoneInfo(settings.timezone)
    start = datetime.combine(day, _parse_hm(hm), tz)
    end = start + timedelta(minutes=service.minutes)
    appt = Appointment(
        tenant_id=tenant_id,
        conversation_id=conversation_id,
        code=_new_code(),
        customer_name=customer_name.strip(),
        customer_contact=customer_contact.strip(),
        service=service.name,
        start_at=start,
        end_at=end,
        notes=notes,
    )
    db.add(appt)
    try:
        await db.commit()
    except IntegrityError as exc:  # someone else took the slot a moment ago
        await db.rollback()
        raise BookingError(f"{hm} was just taken. Please choose another time.") from exc
    return Booked(code=appt.code, service=service.name, start=start, end=end, customer_name=appt.customer_name)
