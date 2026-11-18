import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import update

from app.api import chat, documents, health, search, tenants
from app.core.config import get_settings
from app.db.session import SessionLocal
from app.models import Document
from app.services.embeddings import get_embedder

settings = get_settings()
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


app = FastAPI(title="Rehber API", version="0.3.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

for r in (health.router, tenants.router, documents.router, search.router, chat.router):
    app.include_router(r, prefix="/api")
