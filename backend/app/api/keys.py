"""Create, list and revoke API keys (dashboard, admin+ only).

- publishable (pk_...): embedded in the website widget. Can ONLY chat, only from the
  listed website origins, and is rate-limited. Safe to expose in page source.
- secret (sk_...): for server-to-server integrations (e.g. syncing orders). Never put it
  in a website. Cannot be used for chat.
The full key is shown once; only its SHA-256 hash is stored.
"""

import uuid
from datetime import datetime, timezone
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import CurrentUser, get_current_user, get_tenant, require_role
from app.core.security import new_token, sha256
from app.db.session import get_db
from app.models import ApiKey, Tenant

router = APIRouter(prefix="/tenants/{tenant_id}/api-keys", tags=["api-keys"], dependencies=[Depends(require_role("admin"))])

PREFIX = {"publishable": "pk_", "secret": "sk_"}


def normalize_origin(value: str) -> str:
    """'https://Shop.com/' -> 'https://shop.com'. Must be scheme://host[:port] only."""
    v = value.strip().rstrip("/")
    p = urlparse(v)
    if p.scheme not in ("http", "https") or not p.hostname or p.path or p.query or p.fragment or p.username:
        raise ValueError(f"'{value}' is not a valid website origin. Use e.g. https://www.example.com")
    port = f":{p.port}" if p.port else ""
    return f"{p.scheme}://{p.hostname.lower()}{port}"


class KeyCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    kind: str = Field(pattern="^(publishable|secret)$")
    allowed_origins: list[str] = Field(default_factory=list, max_length=20)

    @field_validator("allowed_origins")
    @classmethod
    def _origins(cls, v: list[str]) -> list[str]:
        return sorted({normalize_origin(o) for o in v if o.strip()})


class KeyOut(BaseModel):
    id: uuid.UUID
    name: str
    kind: str
    prefix: str
    allowed_origins: list[str]
    created_at: datetime
    last_used_at: datetime | None
    revoked_at: datetime | None


class KeyCreated(KeyOut):
    key: str  # the full key, returned ONCE


def _out(k: ApiKey) -> dict:
    return {f: getattr(k, f) for f in KeyOut.model_fields}


@router.post("", response_model=KeyCreated, status_code=201)
async def create_key(
    body: KeyCreate,
    tenant: Tenant = Depends(get_tenant),
    current: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if body.kind == "publishable" and not body.allowed_origins:
        raise HTTPException(422, "Add at least one website (origin) where the widget will run.")
    raw = PREFIX[body.kind] + new_token(32)
    key = ApiKey(
        tenant_id=tenant.id, name=body.name.strip(), kind=body.kind, prefix=raw[:11], key_hash=sha256(raw),
        allowed_origins=body.allowed_origins if body.kind == "publishable" else [], created_by=current.user.id,
    )
    db.add(key)
    await db.commit()
    await db.refresh(key)
    return KeyCreated(**_out(key), key=raw)


@router.get("", response_model=list[KeyOut])
async def list_keys(tenant: Tenant = Depends(get_tenant), db: AsyncSession = Depends(get_db)):
    rows = await db.scalars(select(ApiKey).where(ApiKey.tenant_id == tenant.id).order_by(ApiKey.created_at.desc()))
    return [_out(k) for k in rows]


@router.delete("/{key_id}", status_code=204)
async def revoke_key(key_id: uuid.UUID, tenant: Tenant = Depends(get_tenant), db: AsyncSession = Depends(get_db)) -> None:
    key = await db.get(ApiKey, key_id)
    if key is None or key.tenant_id != tenant.id:
        raise HTTPException(404, "Key not found")
    if key.revoked_at is None:
        key.revoked_at = datetime.now(timezone.utc)
        await db.commit()
