"""Public API used by API keys instead of logins.

/api/public/*  -> website widget, publishable key (X-Rehber-Key header), only from websites
                  listed on the key: widget config, chat, and restoring the visitor's own chat.
/api/v1/*      -> server-to-server, secret key (Authorization: Bearer sk_...).
"""

import json
import uuid
from datetime import datetime, timedelta, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.business import OrderIn, _upsert_orders
from app.core import ratelimit
from app.core.security import sha256, sign, verify_signature
from app.db.session import SessionLocal, get_db
from app.models import ApiKey, Conversation, Message, Tenant
from app.services.agent.runner import run_turn
from app.services.business import load_settings

router = APIRouter(tags=["public"])
TOKEN_PURPOSE = "widget-conversation"


async def _load_key(db: AsyncSession, raw: str | None, kind: str) -> ApiKey:
    if not raw or not raw.startswith("pk_" if kind == "publishable" else "sk_"):
        raise HTTPException(401, "Missing or invalid API key.")
    key = await db.scalar(select(ApiKey).where(ApiKey.key_hash == sha256(raw)))
    if key is None or key.kind != kind or key.revoked_at is not None:
        raise HTTPException(401, "Missing or invalid API key.")
    now = datetime.now(timezone.utc)
    if key.last_used_at is None or now - key.last_used_at > timedelta(minutes=1):
        key.last_used_at = now
        await db.commit()
    return key


async def publishable_key(request: Request, db: AsyncSession = Depends(get_db)) -> ApiKey:
    key = await _load_key(db, request.headers.get("X-Rehber-Key"), "publishable")
    # Browsers always send Origin on cross-site requests; only listed websites may use this key.
    origin = (request.headers.get("origin") or "").rstrip("/").lower()
    if origin not in key.allowed_origins:
        raise HTTPException(403, "This website is not allowed to use this key.")
    return key


async def secret_key(request: Request, db: AsyncSession = Depends(get_db)) -> ApiKey:
    auth = request.headers.get("authorization") or ""
    raw = auth[7:].strip() if auth.lower().startswith("bearer ") else None
    return await _load_key(db, raw, "secret")


def _ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


# ---------------------------------------------------------------- widget
#
# Visitors are anonymous, so the widget gets a reduced view of each event: no retrieved passages
# that weren't cited, no relevance scores, no tool arguments/results, no model or token stats.


def public_source(src: dict) -> dict:
    url = src.get("source_uri") if src.get("source_type") == "url" else None
    return {"n": src.get("n"), "title": src.get("document_title"), "page": src.get("page"), "url": url}


def public_event(event: str, data: dict) -> dict | None:
    if event == "meta":
        return {"conversation_id": data["conversation_id"], "language": data.get("language"),
                "conversation_token": sign(data["conversation_id"], TOKEN_PURPOSE)}
    if event == "token":
        return {"text": data["text"]}
    if event == "tool":
        return {"id": data.get("id"), "name": data.get("name"), "status": data.get("status")}
    if event == "done":
        return {"message_id": data["message_id"], "conversation_status": data.get("conversation_status"),
                "cited": [public_source(s) for s in data.get("cited") or []]}
    if event == "error":
        return {"message": data.get("message", "Something went wrong.")}
    return None


Lang = Literal["tr", "en", "de", "ru", "fr", "ar", "fa", "ur"]


class WidgetChatIn(BaseModel):
    message: str = Field(min_length=1, max_length=2000)
    conversation_id: uuid.UUID | None = None
    conversation_token: str | None = Field(default=None, max_length=128)
    language: Lang | None = None  # the widget's UI language, used only when the message is unclear


class WidgetHistoryIn(BaseModel):
    conversation_id: uuid.UUID
    conversation_token: str = Field(max_length=128)


@router.get("/public/widget-config")
async def widget_config(key: ApiKey = Depends(publishable_key), db: AsyncSession = Depends(get_db)):
    tenant = await db.get(Tenant, key.tenant_id)
    biz = load_settings(tenant.settings)
    return {
        "business_name": tenant.name,
        "default_language": tenant.default_language,
        "widget": biz.widget.model_dump(),
        "tools": biz.tools.model_dump(),
    }


async def _widget_conversation(db: AsyncSession, key: ApiKey, conversation_id: uuid.UUID, token: str | None) -> Conversation:
    # A visitor can only reach a conversation the server started for them on this business's widget.
    if not verify_signature(str(conversation_id), token, TOKEN_PURPOSE):
        raise HTTPException(403, "Invalid conversation token.")
    convo = await db.get(Conversation, conversation_id)
    if convo is None or convo.tenant_id != key.tenant_id or convo.channel != "widget":
        raise HTTPException(404, "Conversation not found.")
    return convo


@router.post("/public/history")
async def widget_history(request: Request, body: WidgetHistoryIn, key: ApiKey = Depends(publishable_key),
                         db: AsyncSession = Depends(get_db)):
    """Restore the visitor's conversation after a page reload."""
    await ratelimit.enforce(f"widget:history:{key.id}:{_ip(request)}", 30, 60, "Too many requests.")
    convo = await _widget_conversation(db, key, body.conversation_id, body.conversation_token)
    rows = (await db.scalars(
        select(Message).where(Message.conversation_id == convo.id).order_by(Message.created_at.desc()).limit(50)
    )).all()
    return {
        "status": convo.status,
        "messages": [
            {"role": m.role, "content": m.content, "language": m.language,
             "cited": [public_source(s) for s in m.sources or []]}
            for m in reversed(rows)
        ],
    }


@router.post("/public/chat")
async def widget_chat(request: Request, body: WidgetChatIn, key: ApiKey = Depends(publishable_key)):
    await ratelimit.enforce(f"widget:key:{key.id}", 120, 60, "This chat is very busy. Please try again in a minute.")
    await ratelimit.enforce(f"widget:ip:{key.id}:{_ip(request)}", 15, 60, "You're sending messages too quickly.")

    if body.conversation_id:
        async with SessionLocal() as db:
            await _widget_conversation(db, key, body.conversation_id, body.conversation_token)

    async def events():
        async with SessionLocal() as db:
            t = await db.get(Tenant, key.tenant_id)
            async for ev in run_turn(db, t, body.message.strip(), body.conversation_id, channel="widget",
                                     language_hint=body.language):
                data = public_event(ev["event"], ev["data"])
                if data is not None:
                    yield f"event: {ev['event']}\ndata: {json.dumps(data, ensure_ascii=False, default=str)}\n\n"

    return StreamingResponse(events(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


# ---------------------------------------------------------------- server-to-server


@router.post("/v1/orders", status_code=204)
async def sync_orders(body: list[OrderIn], key: ApiKey = Depends(secret_key), db: AsyncSession = Depends(get_db)) -> None:
    """Create or update orders from the business's shop system."""
    if len(body) > 500:
        raise HTTPException(413, "Send at most 500 orders per request.")
    await ratelimit.enforce(f"v1:key:{key.id}", 60, 60)
    await _upsert_orders(db, key.tenant_id, body)
