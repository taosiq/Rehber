import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from sqlalchemy import update

from app.api import analytics, auth, business, chat, documents, health, keys, public, search, tenants
from app.core.config import get_settings
from app.core.middleware import SecurityHeaders, SplitCORS
from app.db.session import SessionLocal
from app.models import Document
from app.services import tracing
from app.services.embeddings import get_embedder

settings = get_settings()
settings.check_production_safety()
logging.basicConfig(level=logging.INFO)


async def _fail_interrupted_jobs() -> None:
    """Documents left mid-processing by a restart would spin forever; mark them failed."""
    async with SessionLocal() as db:
        await db.execute(
            update(Document)
            .where(Document.status.in_(["pending", "processing"]))
            .values(status="failed", error="Processing was interrupted by a server restart. Click retry.")
        )
        await db.commit()


@asynccontextmanager
async def lifespan(app: FastAPI):
    if settings.environment != "test":
        await _fail_interrupted_jobs()
        # Load the embedding model in the background so the first upload is fast.
        embedder = get_embedder()
        if hasattr(embedder, "warm_up"):
            asyncio.get_running_loop().run_in_executor(None, embedder.warm_up)
    yield
    tracing.flush()  # send any traces still queued


is_prod = settings.environment == "production"
app = FastAPI(
    title="Rehber API",
    version="0.5.0",
    lifespan=lifespan,
    # Interactive API docs only outside production.
    docs_url=None if is_prod else "/docs",
    redoc_url=None,
    openapi_url=None if is_prod else "/openapi.json",
)

# The last added middleware runs first: CORS handles preflights before anything else.
app.add_middleware(SecurityHeaders)
app.add_middleware(SplitCORS, dashboard_origins=settings.cors_origins)

for r in (health.router, auth.router, tenants.router, documents.router, search.router, chat.router,
          business.router, keys.router, public.router, analytics.router):
    app.include_router(r, prefix="/api")
