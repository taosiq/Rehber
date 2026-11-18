"""Chat endpoints. Answers stream as Server-Sent Events (SSE)."""

import json
import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_tenant
from app.db.session import SessionLocal, get_db
from app.models import Conversation, Message, Tenant
from app.services.agent.runner import run_turn

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


class ConversationOut(BaseModel):
    id: uuid.UUID
    title: str | None
    channel: str
    status: str
    handoff_reason: str | None
    handoff_at: datetime | None
    customer_contact: str | None
    message_count: int
    created_at: datetime


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


@router.get("/conversations", response_model=list[ConversationOut])
async def list_conversations(
    status: str | None = None, tenant: Tenant = Depends(get_tenant), db: AsyncSession = Depends(get_db)
):
    count = func.count(Message.id).label("n")
    stmt = (
        select(Conversation, count)
        .outerjoin(Message, Message.conversation_id == Conversation.id)
        .where(Conversation.tenant_id == tenant.id)
        .group_by(Conversation.id)
        .order_by(Conversation.created_at.desc())
        .limit(100)
    )
    if status:
        stmt = stmt.where(Conversation.status == status)
    rows = (await db.execute(stmt)).all()
    return [
        ConversationOut(
            id=c.id, title=c.title, channel=c.channel, status=c.status, handoff_reason=c.handoff_reason,
            handoff_at=c.handoff_at, customer_contact=c.customer_contact, message_count=n, created_at=c.created_at,
        )
        for c, n in rows
    ]


async def _get_convo(db: AsyncSession, tenant: Tenant, conversation_id: uuid.UUID) -> Conversation:
    convo = await db.get(Conversation, conversation_id)
    if convo is None or convo.tenant_id != tenant.id:
        raise HTTPException(404, "Conversation not found")
    return convo


@router.get("/conversations/{conversation_id}/messages", response_model=list[MessageOut])
async def conversation_messages(
    conversation_id: uuid.UUID, tenant: Tenant = Depends(get_tenant), db: AsyncSession = Depends(get_db)
):
    convo = await _get_convo(db, tenant, conversation_id)
    return list(
        (await db.scalars(select(Message).where(Message.conversation_id == convo.id).order_by(Message.created_at))).all()
    )


@router.post("/conversations/{conversation_id}/resolve", status_code=204)
async def resolve_conversation(
    conversation_id: uuid.UUID, tenant: Tenant = Depends(get_tenant), db: AsyncSession = Depends(get_db)
) -> None:
    """Staff mark a handed-off conversation as dealt with."""
    convo = await _get_convo(db, tenant, conversation_id)
    convo.status = "resolved"
    await db.commit()
