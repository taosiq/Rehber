"""Chat endpoints. Answers stream as Server-Sent Events (SSE)."""

import json
import re
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import CurrentUser, get_current_user, get_tenant
from app.core import ratelimit
from app.db.session import SessionLocal, get_db
from app.core.crypto import decrypt
from app.models import Conversation, Message, Tenant, User, WhatsAppAccount
from app.services import whatsapp as wa
from app.services.agent.runner import run_turn
from app.services.whatsapp import WINDOW

router = APIRouter(prefix="/tenants/{tenant_id}", tags=["chat"])


class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=4000)
    conversation_id: uuid.UUID | None = None


class MessageOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    role: str
    content: str
    language: str | None
    sources: list | None
    tool_calls: list | None
    model: str | None
    prompt_tokens: int | None
    completion_tokens: int | None
    latency_ms: int | None
    first_token_ms: int | None
    author_name: str | None = None  # staff replies
    delivery: str | None = None  # WhatsApp ticks: sent | delivered | read | failed
    created_at: datetime | None = None


class Person(BaseModel):
    id: uuid.UUID
    name: str


class LastMessage(BaseModel):
    role: str
    preview: str
    at: datetime


class ConversationOut(BaseModel):
    id: uuid.UUID
    title: str | None
    channel: str
    status: str
    ai_paused: bool = False
    assigned_to: Person | None = None
    handoff_reason: str | None
    handoff_at: datetime | None
    customer_contact: str | None
    customer_name: str | None = None
    language: str | None = None
    message_count: int
    # WhatsApp: you may only write freely until 24h after the customer's last message.
    reply_window_ends_at: datetime | None = None
    unread: bool = False
    last_message: LastMessage | None = None
    last_message_at: datetime | None = None
    created_at: datetime


class ReplyIn(BaseModel):
    text: str = Field(min_length=1, max_length=4000)


@router.post("/chat")
async def chat(body: ChatRequest, tenant: Tenant = Depends(get_tenant)) -> StreamingResponse:
    async def events():
        # The stream outlives the request's DB dependency, so it gets its own session.
        async with SessionLocal() as db:
            async for ev in run_turn(db, tenant, body.message.strip(), body.conversation_id):
                yield f"event: {ev['event']}\ndata: {json.dumps(ev['data'], ensure_ascii=False, default=str)}\n\n"

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


async def _summaries(db: AsyncSession, convos: list[Conversation]) -> list[ConversationOut]:
    """Inbox rows: message count, last message, customer language, assignee, unread."""
    if not convos:
        return []
    ids = [c.id for c in convos]
    counts = dict((await db.execute(
        select(Message.conversation_id, func.count()).where(Message.conversation_id.in_(ids)).group_by(Message.conversation_id)
    )).all())
    last = {m.conversation_id: m for m in (await db.scalars(
        select(Message).where(Message.conversation_id.in_(ids))
        .distinct(Message.conversation_id).order_by(Message.conversation_id, Message.created_at.desc())
    )).all()}
    langs = dict((await db.execute(
        select(Message.conversation_id, Message.language)
        .where(Message.conversation_id.in_(ids), Message.role == "user", Message.language.is_not(None))
        .distinct(Message.conversation_id).order_by(Message.conversation_id, Message.created_at.desc())
    )).all())
    wa_ids = [c.id for c in convos if c.channel == "whatsapp"]
    last_user = dict((await db.execute(
        select(Message.conversation_id, func.max(Message.created_at))
        .where(Message.conversation_id.in_(wa_ids), Message.role == "user").group_by(Message.conversation_id)
    )).all()) if wa_ids else {}
    assignees = {c.assigned_to for c in convos if c.assigned_to}
    people = {u.id: u for u in (await db.scalars(select(User).where(User.id.in_(assignees)))).all()} if assignees else {}
    out = []
    for c in convos:
        m = last.get(c.id)
        out.append(ConversationOut(
            id=c.id, title=c.title, channel=c.channel, status=c.status, ai_paused=c.ai_paused,
            assigned_to=Person(id=c.assigned_to, name=people[c.assigned_to].name) if c.assigned_to in people else None,
            handoff_reason=c.handoff_reason, handoff_at=c.handoff_at, customer_contact=c.customer_contact,
            customer_name=c.customer_name, language=langs.get(c.id), message_count=counts.get(c.id, 0),
            reply_window_ends_at=last_user[c.id] + WINDOW if c.id in last_user else None,
            # Unread = the customer wrote last and nobody on the team has opened it since.
            unread=bool(m and m.role == "user" and (c.staff_seen_at is None or c.staff_seen_at < m.created_at)),
            last_message=LastMessage(role=m.role, preview=_preview(m.content), at=m.created_at) if m else None,
            last_message_at=c.last_message_at, created_at=c.created_at,
        ))
    return out


_CITE = re.compile(r"\s?\[\d+(?:\s*,\s*\d+)*\]")


def _preview(text: str) -> str:
    """One line for the inbox list: no citation markers like [1], no extra whitespace."""
    return " ".join(_CITE.sub("", text).split())[:160]


def _like(q: str) -> str:
    """ILIKE pattern with the user's text taken literally."""
    return "%" + q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"


@router.get("/conversations", response_model=list[ConversationOut])
async def list_conversations(
    status: str | None = Query(None, pattern="^(open|handoff|resolved)$"),
    channel: str | None = Query(None, max_length=20),
    q: str | None = Query(None, max_length=200),
    unread: bool = False,
    limit: int = Query(100, ge=1, le=200),
    tenant: Tenant = Depends(get_tenant),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(Conversation).where(Conversation.tenant_id == tenant.id)
    if status:
        stmt = stmt.where(Conversation.status == status)
    if channel:
        stmt = stmt.where(Conversation.channel == channel)
    if q and q.strip():
        like = _like(q.strip())
        in_messages = select(Message.conversation_id).where(Message.tenant_id == tenant.id, Message.content.ilike(like))
        stmt = stmt.where(Conversation.title.ilike(like) | Conversation.customer_contact.ilike(like)
                          | Conversation.customer_name.ilike(like) | Conversation.id.in_(in_messages))
    stmt = stmt.order_by(func.coalesce(Conversation.last_message_at, Conversation.created_at).desc()).limit(limit)
    rows = await _summaries(db, list((await db.scalars(stmt)).all()))
    return [r for r in rows if r.unread] if unread else rows


@router.get("/inbox/counts")
async def inbox_counts(tenant: Tenant = Depends(get_tenant), db: AsyncSession = Depends(get_db)):
    """Badge numbers for the sidebar."""
    last_user = (
        select(func.max(Message.created_at)).where(Message.conversation_id == Conversation.id, Message.role == "user")
        .correlate(Conversation).scalar_subquery()
    )
    last_any = (
        select(func.max(Message.created_at)).where(Message.conversation_id == Conversation.id)
        .correlate(Conversation).scalar_subquery()
    )
    needs = await db.scalar(select(func.count()).select_from(Conversation)
                            .where(Conversation.tenant_id == tenant.id, Conversation.status == "handoff"))
    unread = await db.scalar(select(func.count()).select_from(Conversation).where(
        Conversation.tenant_id == tenant.id, last_user.is_not(None), last_user == last_any,
        Conversation.staff_seen_at.is_(None) | (Conversation.staff_seen_at < last_user),
    ))
    return {"needs_human": needs or 0, "unread": unread or 0}


async def _get_convo(db: AsyncSession, tenant: Tenant, conversation_id: uuid.UUID) -> Conversation:
    convo = await db.get(Conversation, conversation_id)
    if convo is None or convo.tenant_id != tenant.id:
        raise HTTPException(404, "Conversation not found")
    return convo


@router.get("/conversations/{conversation_id}", response_model=ConversationOut)
async def get_conversation(conversation_id: uuid.UUID, tenant: Tenant = Depends(get_tenant), db: AsyncSession = Depends(get_db)):
    return (await _summaries(db, [await _get_convo(db, tenant, conversation_id)]))[0]


@router.get("/conversations/{conversation_id}/messages", response_model=list[MessageOut])
async def conversation_messages(
    conversation_id: uuid.UUID, tenant: Tenant = Depends(get_tenant), db: AsyncSession = Depends(get_db)
):
    convo = await _get_convo(db, tenant, conversation_id)
    rows = (await db.execute(
        select(Message, User.name).outerjoin(User, User.id == Message.author_id)
        .where(Message.conversation_id == convo.id).order_by(Message.created_at)
    )).all()
    return [MessageOut.model_validate(m).model_copy(update={"author_name": name}) for m, name in rows]


@router.post("/conversations/{conversation_id}/seen", status_code=204)
async def mark_seen(conversation_id: uuid.UUID, tenant: Tenant = Depends(get_tenant), db: AsyncSession = Depends(get_db)) -> None:
    convo = await _get_convo(db, tenant, conversation_id)
    convo.staff_seen_at = datetime.now(timezone.utc)
    await db.commit()


def _take(convo: Conversation, user: User, reason: str) -> None:
    convo.ai_paused = True
    convo.assigned_to = user.id
    if convo.status != "handoff":
        convo.status = "handoff"
        convo.handoff_at = convo.handoff_at or datetime.now(timezone.utc)
        convo.handoff_reason = convo.handoff_reason or f"{reason} {user.name}"


@router.post("/conversations/{conversation_id}/takeover", response_model=ConversationOut)
async def take_over(conversation_id: uuid.UUID, current: CurrentUser = Depends(get_current_user),
                    tenant: Tenant = Depends(get_tenant), db: AsyncSession = Depends(get_db)):
    """A team member takes the conversation: the AI stops answering until it is handed back."""
    convo = await _get_convo(db, tenant, conversation_id)
    _take(convo, current.user, "Taken over by")
    await db.commit()
    return (await _summaries(db, [convo]))[0]


@router.post("/conversations/{conversation_id}/release", response_model=ConversationOut)
async def hand_back(conversation_id: uuid.UUID, tenant: Tenant = Depends(get_tenant), db: AsyncSession = Depends(get_db)):
    """Give the conversation back to the AI."""
    convo = await _get_convo(db, tenant, conversation_id)
    convo.ai_paused = False
    convo.assigned_to = None
    convo.status = "open"
    await db.commit()
    return (await _summaries(db, [convo]))[0]


async def _send_on_whatsapp(db: AsyncSession, tenant: Tenant, convo: Conversation, text: str, now: datetime) -> str | None:
    """Deliver a team reply to the customer's WhatsApp. Raises a clear error instead of saving a reply
    the customer would never receive."""
    last = await wa.last_customer_message_at(db, convo.id)
    if last is None or now - last > WINDOW:
        raise HTTPException(409, "WhatsApp only allows replies within 24 hours of the customer's last message. "
                                 "They need to write to you again first.")
    account = await db.scalar(select(WhatsAppAccount).where(WhatsAppAccount.tenant_id == tenant.id))
    token = decrypt(account.token_encrypted) if account else None
    if account is None or token is None or not convo.external_user:
        raise HTTPException(409, "WhatsApp isn't connected for this business any more. Connect it on the WhatsApp page.")
    try:
        ids = await wa.send_text(account.phone_number_id, token, convo.external_user, wa.to_whatsapp(text))
    except wa.WhatsAppError as exc:
        if exc.outside_window:
            raise HTTPException(409, "WhatsApp only allows replies within 24 hours of the customer's last message.")
        raise HTTPException(502, f"WhatsApp didn't accept the message: {exc.message}")
    return ids[0] if ids else None


@router.post("/conversations/{conversation_id}/reply", response_model=MessageOut, status_code=201)
async def staff_reply(conversation_id: uuid.UUID, body: ReplyIn, current: CurrentUser = Depends(get_current_user),
                      tenant: Tenant = Depends(get_tenant), db: AsyncSession = Depends(get_db)):
    """Reply as a person. Replying takes the conversation over, so the AI doesn't talk over you."""
    await ratelimit.enforce(f"staff-reply:{current.user.id}", 60, 60)
    convo = await _get_convo(db, tenant, conversation_id)
    now = datetime.now(timezone.utc)
    text = body.text.strip()
    external_id = delivery = None
    if convo.channel == "whatsapp":
        external_id = await _send_on_whatsapp(db, tenant, convo, text, now)
        delivery = "sent"
    if not convo.ai_paused:
        _take(convo, current.user, "Answered by")
    msg = Message(tenant_id=tenant.id, conversation_id=convo.id, role="staff", content=text,
                  author_id=current.user.id, external_id=external_id, delivery=delivery)
    db.add(msg)
    convo.last_message_at = now
    convo.staff_seen_at = now
    await db.commit()
    await db.refresh(msg)
    return MessageOut.model_validate(msg).model_copy(update={"author_name": current.user.name})


@router.post("/conversations/{conversation_id}/resolve", status_code=204)
async def resolve_conversation(
    conversation_id: uuid.UUID, tenant: Tenant = Depends(get_tenant), db: AsyncSession = Depends(get_db)
) -> None:
    """Mark the conversation as dealt with. If the customer writes again, the AI answers again."""
    convo = await _get_convo(db, tenant, conversation_id)
    convo.status = "resolved"
    convo.ai_paused = False
    convo.assigned_to = None
    convo.staff_seen_at = datetime.now(timezone.utc)
    await db.commit()
