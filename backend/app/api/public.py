"""Public API used by API keys instead of logins.

/api/public/*  -> website widget, publishable key (X-Rehber-Key header), any website
                  listed on the key, chat only.
/api/v1/*      -> server-to-server, secret key (Authorization: Bearer sk_...).
"""

import json
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.business import OrderIn, _upsert_orders
from app.core import ratelimit
from app.core.security import sha256, sign, verify_signature
from app.db.session import SessionLocal, get_db
from app.models import ApiKey, Conversation, Tenant
from app.services.agent.runner import run_turn

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


class WidgetChatIn(BaseModel):
    message: str = Field(min_length=1, max_length=2000)
    conversation_id: uuid.UUID | None = None
    conversation_token: str | None = Field(default=None, max_length=128)


@router.get("/public/widget-config")
async def widget_config(key: ApiKey = Depends(publishable_key), db: AsyncSession = Depends(get_db)):
    tenant = await db.get(Tenant, key.tenant_id)
    return {"business_name": tenant.name, "default_language": tenant.default_language}


@router.post("/public/chat")
async def widget_chat(request: Request, body: WidgetChatIn, key: ApiKey = Depends(publishable_key)):
    await ratelimit.enforce(f"widget:key:{key.id}", 120, 60, "This chat is very busy. Please try again in a minute.")
    await ratelimit.enforce(f"widget:ip:{key.id}:{_ip(request)}", 15, 60, "You're sending messages too quickly.")

    async with SessionLocal() as db:
        tenant = await db.get(Tenant, key.tenant_id)
        if body.conversation_id:
            # A visitor can only continue a conversation the server started for them.
            if not verify_signature(str(body.conversation_id), body.conversation_token, TOKEN_PURPOSE):
                raise HTTPException(403, "Invalid conversation token.")
            convo = await db.get(Conversation, body.conversation_id)
            if convo is None or convo.tenant_id != tenant.id or convo.channel != "widget":
                raise HTTPException(404, "Conversation not found.")

    async def events():
        async with SessionLocal() as db:
            t = await db.get(Tenant, key.tenant_id)
            async for ev in run_turn(db, t, body.message.strip(), body.conversation_id, channel="widget"):
                data = ev["data"]
                if ev["event"] == "meta":
                    data = data | {"conversation_token": sign(data["conversation_id"], TOKEN_PURPOSE)}
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
