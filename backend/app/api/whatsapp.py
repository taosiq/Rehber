"""WhatsApp: Meta's webhook, and connecting a business's number from the dashboard."""

import hashlib
import hmac
import json
import logging
import re
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import CurrentUser, get_current_user, get_membership, get_tenant, require_role
from app.core import ratelimit
from app.core.config import get_settings
from app.core.crypto import decrypt, encrypt
from app.core.security import constant_time_equals
from app.db.session import get_db
from app.models import ROLES, Conversation, Membership, Message, Tenant, WhatsAppAccount
from app.services import whatsapp as wa

log = logging.getLogger(__name__)
router = APIRouter(tags=["whatsapp"])
MAX_WEBHOOK_BYTES = 1_000_000


# ---------------------------------------------------------------- Meta's webhook (public, signed)


@router.get("/whatsapp/webhook", response_class=PlainTextResponse)
async def verify_webhook(
    mode: str = Query("", alias="hub.mode"),
    token: str = Query("", alias="hub.verify_token"),
    challenge: str = Query("", alias="hub.challenge", max_length=200),
):
    """Meta calls this once when the webhook is set up and expects the challenge echoed back."""
    expected = get_settings().whatsapp_verify_token
    if mode != "subscribe" or not expected or not constant_time_equals(token, expected):
        raise HTTPException(403, "Verification failed.")
    return challenge


def valid_signature(body: bytes, header: str | None) -> bool:
    secret = get_settings().whatsapp_app_secret
    if not secret or not header or not header.startswith("sha256="):
        return False
    expected = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, header[7:])


@router.post("/whatsapp/webhook")
async def receive_webhook(request: Request, background: BackgroundTasks):
    """Messages and delivery updates. Answered at once; the AI replies in the background."""
    if not get_settings().whatsapp_app_secret:
        raise HTTPException(503, "WhatsApp is not configured on this server.")
    body = await request.body()
    if len(body) > MAX_WEBHOOK_BYTES:
        raise HTTPException(413, "Too large.")
    # Only Meta knows the App Secret, so a valid signature proves the call came from Meta, unchanged.
    if not valid_signature(body, request.headers.get("x-hub-signature-256")):
        raise HTTPException(401, "Invalid signature.")
    try:
        payload = json.loads(body)
    except ValueError:
        raise HTTPException(400, "Invalid JSON.")
    inbound, statuses = wa.parse_webhook(payload if isinstance(payload, dict) else {})
    for msg in inbound:
        background.add_task(wa.handle_inbound, msg)
    if statuses:
        background.add_task(wa.handle_statuses, statuses)
    return {"ok": True}


# ---------------------------------------------------------------- dashboard


class ConnectIn(BaseModel):
    phone_number_id: str = Field(min_length=5, max_length=32)
    access_token: str = Field(min_length=20, max_length=1000)
    waba_id: str | None = Field(default=None, max_length=32)

    @field_validator("phone_number_id", "waba_id")
    @classmethod
    def digits(cls, v: str | None) -> str | None:
        if v is None or not v.strip():
            return None
        v = v.strip()
        if not v.isdigit():
            raise ValueError("Must be the numeric ID shown in Meta (digits only).")
        return v

    @field_validator("access_token")
    @classmethod
    def token(cls, v: str) -> str:
        v = v.strip()
        if not re.fullmatch(r"[A-Za-z0-9_\-.|]+", v):
            raise ValueError("That doesn't look like an access token. Copy it again from Meta.")
        return v


class TestIn(BaseModel):
    to: str = Field(min_length=6, max_length=24)

    @field_validator("to")
    @classmethod
    def phone(cls, v: str) -> str:
        digits = re.sub(r"[\s\-().+]", "", v)
        if not digits.isdigit() or not 7 <= len(digits) <= 15:
            raise ValueError("Enter the full number with country code, e.g. +90 532 123 45 67.")
        return digits


def _webhook_info(is_admin: bool) -> dict:
    s = get_settings()
    return {
        "url": f"{s.public_url.rstrip('/')}/api/whatsapp/webhook",
        # The verify token is only typed into Meta's settings, so admins need to see it.
        "verify_token": s.whatsapp_verify_token if is_admin else None,
        "server_ready": bool(s.whatsapp_app_secret and s.whatsapp_verify_token),
        "public": s.public_url.startswith("https://"),
    }


async def _status(db: AsyncSession, tenant: Tenant, membership: Membership) -> dict:
    account = await db.scalar(select(WhatsAppAccount).where(WhatsAppAccount.tenant_id == tenant.id))
    since = datetime.now(timezone.utc) - timedelta(days=7)
    convos = await db.scalar(select(func.count()).select_from(Conversation)
                             .where(Conversation.tenant_id == tenant.id, Conversation.channel == "whatsapp"))
    week = await db.scalar(
        select(func.count()).select_from(Message).join(Conversation, Conversation.id == Message.conversation_id)
        .where(Message.tenant_id == tenant.id, Conversation.channel == "whatsapp", Message.role == "user",
               Message.created_at >= since))
    out = {
        "connected": account is not None,
        "webhook": _webhook_info(ROLES.get(membership.role, 0) >= ROLES["admin"]),
        "stats": {"conversations": convos or 0, "messages_7d": week or 0},
        "account": None,
    }
    if account:
        out["account"] = {
            "phone_number_id": account.phone_number_id, "waba_id": account.waba_id,
            "display_phone_number": account.display_phone_number, "verified_name": account.verified_name,
            "connected_at": account.created_at, "last_inbound_at": account.last_inbound_at,
            "last_error": account.last_error, "last_error_at": account.last_error_at,
            "token_ok": decrypt(account.token_encrypted) is not None,
        }
    return out


@router.get("/tenants/{tenant_id}/whatsapp")
async def get_whatsapp(tenant: Tenant = Depends(get_tenant), membership: Membership = Depends(get_membership),
                       db: AsyncSession = Depends(get_db)):
    return await _status(db, tenant, membership)


@router.put("/tenants/{tenant_id}/whatsapp", dependencies=[Depends(require_role("admin"))])
async def connect_whatsapp(body: ConnectIn, tenant: Tenant = Depends(get_tenant),
                           membership: Membership = Depends(get_membership),
                           current: CurrentUser = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Check the number and token with Meta, then save them (token encrypted)."""
    await ratelimit.enforce(f"wa-connect:{tenant.id}", 10, 300, "Too many attempts. Please wait a few minutes.")
    other = await db.scalar(select(WhatsAppAccount).where(WhatsAppAccount.phone_number_id == body.phone_number_id,
                                                          WhatsAppAccount.tenant_id != tenant.id))
    if other is not None:
        raise HTTPException(409, "This WhatsApp number is already connected to another business.")
    try:
        info = await wa.phone_info(body.phone_number_id, body.access_token)
    except wa.WhatsAppError as exc:
        raise HTTPException(400, f"Meta didn't accept these details: {exc.message}")

    warning = None
    if body.waba_id:
        try:
            await wa.subscribe_app(body.waba_id, body.access_token)
        except wa.WhatsAppError as exc:
            warning = f"Connected, but subscribing the app to the account failed: {exc.message}"

    account = await db.scalar(select(WhatsAppAccount).where(WhatsAppAccount.tenant_id == tenant.id))
    if account is None:
        account = WhatsAppAccount(tenant_id=tenant.id, phone_number_id=body.phone_number_id, token_encrypted="")
        db.add(account)
    account.phone_number_id = body.phone_number_id
    account.waba_id = body.waba_id
    account.token_encrypted = encrypt(body.access_token)
    account.display_phone_number = (info.get("display_phone_number") or "")[:40] or None
    account.verified_name = (info.get("verified_name") or "")[:200] or None
    account.connected_by = current.user.id
    account.last_error = warning
    account.last_error_at = datetime.now(timezone.utc) if warning else None
    await db.commit()
    return await _status(db, tenant, membership)


@router.delete("/tenants/{tenant_id}/whatsapp", status_code=204, dependencies=[Depends(require_role("admin"))])
async def disconnect_whatsapp(tenant: Tenant = Depends(get_tenant), db: AsyncSession = Depends(get_db)) -> None:
    """Forget the number and its token. Past conversations stay in the inbox."""
    account = await db.scalar(select(WhatsAppAccount).where(WhatsAppAccount.tenant_id == tenant.id))
    if account is not None:
        await db.delete(account)
        await db.commit()


@router.post("/tenants/{tenant_id}/whatsapp/test", dependencies=[Depends(require_role("admin"))])
async def test_whatsapp(body: TestIn, tenant: Tenant = Depends(get_tenant), db: AsyncSession = Depends(get_db)):
    """Send Meta's "hello_world" template to a phone, to prove sending works."""
    await ratelimit.enforce(f"wa-test:{tenant.id}", 5, 600, "Too many test messages. Please wait a few minutes.")
    account = await db.scalar(select(WhatsAppAccount).where(WhatsAppAccount.tenant_id == tenant.id))
    if account is None:
        raise HTTPException(404, "Connect a WhatsApp number first.")
    token = decrypt(account.token_encrypted)
    if token is None:
        raise HTTPException(409, "The saved token can't be read. Connect the number again.")
    try:
        await wa.send_template(account.phone_number_id, token, body.to)
    except wa.WhatsAppError as exc:
        hint = (" With Meta's free test number you can only message numbers added under "
                "\"To\" in WhatsApp → API Setup." if exc.code in (131030, 131026) else "")
        raise HTTPException(400, f"Meta refused the message: {exc.message}.{hint}")
    return {"sent": True}
