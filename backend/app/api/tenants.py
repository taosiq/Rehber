import re
import secrets
import shutil
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import CurrentUser, get_current_user, get_tenant, require_role
from app.api.documents import STORAGE_DIR
from app.db.session import get_db
from app.models import Membership, Tenant
from app.schemas import TenantCreate, TenantOut

router = APIRouter(prefix="/tenants", tags=["tenants"])


def _slugify(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:80] or "business"
    return f"{slug}-{secrets.token_hex(3)}"


@router.post("", response_model=TenantOut, status_code=201)
async def create_tenant(
    body: TenantCreate, current: CurrentUser = Depends(get_current_user), db: AsyncSession = Depends(get_db)
) -> Tenant:
    tenant = Tenant(name=body.name, slug=_slugify(body.name), default_language=body.default_language)
    db.add(tenant)
    await db.flush()
    db.add(Membership(user_id=current.user.id, tenant_id=tenant.id, role="owner"))
    await db.commit()
    await db.refresh(tenant)
    return tenant


@router.get("", response_model=list[TenantOut])
async def list_tenants(current: CurrentUser = Depends(get_current_user), db: AsyncSession = Depends(get_db)) -> list[Tenant]:
    """Only the businesses this user is a member of."""
    stmt = (
        select(Tenant)
        .join(Membership, Membership.tenant_id == Tenant.id)
        .where(Membership.user_id == current.user.id)
        .order_by(Tenant.created_at)
    )
    return list((await db.scalars(stmt)).all())


@router.get("/{tenant_id}", response_model=TenantOut)
async def get_one(tenant: Tenant = Depends(get_tenant)) -> Tenant:
    return tenant


class TenantUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=200)
    default_language: Literal["tr", "en", "de", "ru", "fr", "ar", "fa", "ur"] | None = None


class TenantDelete(BaseModel):
    confirm_name: str = Field(max_length=200)


@router.patch("/{tenant_id}", response_model=TenantOut, dependencies=[Depends(require_role("admin"))])
async def update_tenant(body: TenantUpdate, tenant: Tenant = Depends(get_tenant), db: AsyncSession = Depends(get_db)) -> Tenant:
    if body.name is not None:
        tenant.name = body.name.strip()
    if body.default_language is not None:
        tenant.default_language = body.default_language
    await db.commit()
    await db.refresh(tenant)
    return tenant


@router.post("/{tenant_id}/delete", status_code=204, dependencies=[Depends(require_role("owner"))])
async def delete_tenant(body: TenantDelete, tenant: Tenant = Depends(get_tenant), db: AsyncSession = Depends(get_db)) -> None:
    """Permanently delete the business and everything in it. The owner must type its name."""
    if body.confirm_name.strip() != tenant.name:
        raise HTTPException(400, "The name you typed doesn't match the business name.")
    tid = tenant.id
    await db.delete(tenant)  # documents, chunks, conversations, keys, members... cascade in the database
    await db.commit()
    shutil.rmtree(STORAGE_DIR / str(tid), ignore_errors=True)  # uploaded PDFs
