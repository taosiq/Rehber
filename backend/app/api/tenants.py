import re
import secrets

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_tenant
from app.db.session import get_db
from app.models import Tenant
from app.schemas import TenantCreate, TenantOut

router = APIRouter(prefix="/tenants", tags=["tenants"])


def _slugify(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:80] or "business"
    return f"{slug}-{secrets.token_hex(3)}"


@router.post("", response_model=TenantOut, status_code=201)
async def create_tenant(body: TenantCreate, db: AsyncSession = Depends(get_db)) -> Tenant:
    tenant = Tenant(name=body.name, slug=_slugify(body.name), default_language=body.default_language)
    db.add(tenant)
    await db.commit()
    await db.refresh(tenant)
    return tenant


@router.get("", response_model=list[TenantOut])
async def list_tenants(db: AsyncSession = Depends(get_db)) -> list[Tenant]:
    return list((await db.scalars(select(Tenant).order_by(Tenant.created_at))).all())


@router.get("/{tenant_id}", response_model=TenantOut)
async def get_one(tenant: Tenant = Depends(get_tenant)) -> Tenant:
    return tenant
