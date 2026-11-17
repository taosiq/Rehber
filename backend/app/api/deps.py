import uuid

from fastapi import Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.models import Tenant


async def get_tenant(tenant_id: uuid.UUID, db: AsyncSession = Depends(get_db)) -> Tenant:
    """Load the tenant from the URL. Phase 5 adds auth so callers can only reach their own."""
    tenant = await db.get(Tenant, tenant_id)
    if tenant is None:
        raise HTTPException(status_code=404, detail="Business not found")
    return tenant
