import time
from dataclasses import asdict

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_tenant
from app.db.session import get_db
from app.models import Tenant
from app.schemas import SearchRequest, SearchResponse
from app.services.search import search_chunks

router = APIRouter(prefix="/tenants/{tenant_id}", tags=["search"])


@router.post("/search", response_model=SearchResponse)
async def search(body: SearchRequest, tenant: Tenant = Depends(get_tenant), db: AsyncSession = Depends(get_db)):
    start = time.perf_counter()
    hits = await search_chunks(db, tenant.id, body.query, body.k)
    return SearchResponse(
        query=body.query,
        hits=[asdict(h) for h in hits],
        took_ms=int((time.perf_counter() - start) * 1000),
    )
