"""Dashboard home: setup checklist, today's numbers, recent conversations, upcoming appointments."""

from datetime import datetime, time, timezone
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.chat import _summaries
from app.db.session import get_db
from app.models import ApiKey, Appointment, Conversation, Document, Membership, Message, Tenant
from app.api.deps import get_tenant
from app.services import tracing
from app.services.business import load_settings

router = APIRouter(prefix="/tenants/{tenant_id}", tags=["overview"])


@router.get("/overview")
async def overview(tenant: Tenant = Depends(get_tenant), db: AsyncSession = Depends(get_db)):
    biz = load_settings(tenant.settings)
    tz = ZoneInfo(biz.timezone)
    now = datetime.now(timezone.utc)
    today_start = datetime.combine(datetime.now(tz).date(), time.min, tz)
    tid = tenant.id

    async def count(stmt) -> int:
        return await db.scalar(stmt) or 0

    docs_total = await count(select(func.count()).select_from(Document).where(Document.tenant_id == tid))
    docs_ready = await count(select(func.count()).select_from(Document).where(Document.tenant_id == tid, Document.status == "ready"))
    widget_keys = await count(select(func.count()).select_from(ApiKey).where(
        ApiKey.tenant_id == tid, ApiKey.kind == "publishable", ApiKey.revoked_at.is_(None)))
    widget_convos = await count(select(func.count()).select_from(Conversation).where(
        Conversation.tenant_id == tid, Conversation.channel == "widget"))
    any_convos = await count(select(func.count()).select_from(Conversation).where(Conversation.tenant_id == tid))
    team = await count(select(func.count()).select_from(Membership).where(Membership.tenant_id == tid))

    today = {
        "conversations": await count(select(func.count(func.distinct(Message.conversation_id))).where(
            Message.tenant_id == tid, Message.created_at >= today_start)),
        "answers": await count(select(func.count()).select_from(Message).where(
            Message.tenant_id == tid, Message.role == "assistant", Message.created_at >= today_start)),
        "bookings": await count(select(func.count()).select_from(Appointment).where(
            Appointment.tenant_id == tid, Appointment.created_at >= today_start, Appointment.status == "confirmed")),
        "needs_human": await count(select(func.count()).select_from(Conversation).where(
            Conversation.tenant_id == tid, Conversation.status == "handoff")),
    }

    recent = await _summaries(db, list((await db.scalars(
        select(Conversation).where(Conversation.tenant_id == tid)
        .order_by(func.coalesce(Conversation.last_message_at, Conversation.created_at).desc()).limit(6)
    )).all()))
    upcoming = (await db.scalars(
        select(Appointment).where(Appointment.tenant_id == tid, Appointment.status == "confirmed", Appointment.start_at >= now)
        .order_by(Appointment.start_at).limit(5)
    )).all()

    return {
        "business": {"name": tenant.name, "timezone": biz.timezone, "default_language": tenant.default_language},
        "setup": {
            "documents": docs_ready > 0,
            "documents_ready": docs_ready, "documents_total": docs_total,
            "tools": bool(tenant.settings),  # saved at least once on Agent Tools (new businesses start with {})
            "tested": any_convos > 0,
            "widget_key": widget_keys > 0,
            "widget_live": widget_convos > 0,
            "team": team > 1,
            "tracing": tracing.enabled(),
        },
        "today": today,
        "recent": [r.model_dump(mode="json") for r in recent],
        "upcoming": [{"id": str(a.id), "code": a.code, "customer_name": a.customer_name, "service": a.service,
                      "start_at": a.start_at.isoformat(), "conversation_id": str(a.conversation_id) if a.conversation_id else None}
                     for a in upcoming],
    }
