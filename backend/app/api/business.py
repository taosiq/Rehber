"""Business configuration and the records agent tools create (appointments, orders)."""

import uuid
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_tenant, require_role
from app.db.session import get_db
from app.models import Appointment, Order, Tenant
from app.services.business import BusinessSettings, load_settings

router = APIRouter(prefix="/tenants/{tenant_id}", tags=["business"])


# ---------- settings ----------


@router.get("/settings", response_model=BusinessSettings)
async def get_settings_(tenant: Tenant = Depends(get_tenant)) -> BusinessSettings:
    return load_settings(tenant.settings)


@router.put("/settings", response_model=BusinessSettings, dependencies=[Depends(require_role("admin"))])
async def put_settings(
    body: BusinessSettings, tenant: Tenant = Depends(get_tenant), db: AsyncSession = Depends(get_db)
) -> BusinessSettings:
    try:
        from zoneinfo import ZoneInfo

        ZoneInfo(body.timezone)
    except Exception as exc:
        raise HTTPException(422, f"Unknown timezone '{body.timezone}'") from exc
    tenant.settings = body.model_dump()
    await db.commit()
    return body


# ---------- appointments ----------


class AppointmentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    code: str
    customer_name: str
    customer_contact: str
    service: str
    start_at: datetime
    end_at: datetime
    status: str
    notes: str | None
    conversation_id: uuid.UUID | None


@router.get("/appointments", response_model=list[AppointmentOut])
async def list_appointments(
    include_past: bool = False, tenant: Tenant = Depends(get_tenant), db: AsyncSession = Depends(get_db)
):
    stmt = select(Appointment).where(Appointment.tenant_id == tenant.id).order_by(Appointment.start_at)
    if not include_past:
        stmt = stmt.where(Appointment.end_at >= datetime.now(timezone.utc))
    return list((await db.scalars(stmt.limit(200))).all())


@router.post("/appointments/{appointment_id}/cancel", response_model=AppointmentOut)
async def cancel_appointment(
    appointment_id: uuid.UUID, tenant: Tenant = Depends(get_tenant), db: AsyncSession = Depends(get_db)
):
    appt = await db.get(Appointment, appointment_id)
    if appt is None or appt.tenant_id != tenant.id:
        raise HTTPException(404, "Appointment not found")
    appt.status = "cancelled"
    await db.commit()
    return appt


# ---------- orders ----------


class OrderIn(BaseModel):
    order_number: str = Field(min_length=1, max_length=50)
    customer_email: str | None = None
    customer_phone: str | None = None
    status: str = Field(pattern="^(processing|shipped|delivered|cancelled|returned)$")
    items: list[dict] = Field(default_factory=list)
    total: Decimal
    currency: str = Field(default="TRY", min_length=3, max_length=3)
    carrier: str | None = None
    tracking_number: str | None = None
    estimated_delivery: date | None = None


class OrderOut(OrderIn):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID


async def _upsert_orders(db: AsyncSession, tenant_id: uuid.UUID, orders: list[OrderIn]) -> None:
    for o in orders:
        values = o.model_dump() | {"tenant_id": tenant_id, "order_number": o.order_number.strip().lstrip("#").upper()}
        stmt = insert(Order).values(id=uuid.uuid4(), **values)
        stmt = stmt.on_conflict_do_update(
            constraint="uq_orders_number", set_={k: stmt.excluded[k] for k in values if k != "tenant_id"}
        )
        await db.execute(stmt)
    await db.commit()


@router.get("/orders", response_model=list[OrderOut])
async def list_orders(tenant: Tenant = Depends(get_tenant), db: AsyncSession = Depends(get_db)):
    stmt = select(Order).where(Order.tenant_id == tenant.id).order_by(Order.created_at.desc()).limit(200)
    return list((await db.scalars(stmt)).all())


@router.post("/orders", status_code=204, dependencies=[Depends(require_role("admin"))])
async def upsert_orders(
    body: list[OrderIn], tenant: Tenant = Depends(get_tenant), db: AsyncSession = Depends(get_db)
) -> None:
    """Sync orders from the business's shop system (creates or updates by order number)."""
    await _upsert_orders(db, tenant.id, body)


@router.post("/orders/demo", status_code=204, dependencies=[Depends(require_role("admin"))])
async def load_demo_orders(tenant: Tenant = Depends(get_tenant), db: AsyncSession = Depends(get_db)) -> None:
    """Add a few sample orders so the order-lookup tool can be tried right away."""
    today = date.today()
    demo = [
        OrderIn(order_number="48213", customer_email="ayse@example.com", customer_phone="+90 532 111 2233",
                status="shipped", items=[{"name": "Whitening kit", "qty": 1}], total=Decimal("849.90"),
                carrier="Yurtiçi Kargo", tracking_number="YK-99120", estimated_delivery=today + timedelta(days=1)),
        OrderIn(order_number="48250", customer_email="john@example.com", customer_phone="+44 7700 900123",
                status="processing", items=[{"name": "Electric toothbrush", "qty": 1},
                                            {"name": "Brush heads (4 pack)", "qty": 2}],
                total=Decimal("1520.00"), estimated_delivery=today + timedelta(days=4)),
        OrderIn(order_number="48177", customer_email="mehmet@example.com", customer_phone="+90 555 444 6677",
                status="delivered", items=[{"name": "Night guard", "qty": 1}], total=Decimal("2300.00"),
                carrier="Aras Kargo", tracking_number="AR-55821", estimated_delivery=today - timedelta(days=3)),
    ]
    await _upsert_orders(db, tenant.id, demo)
