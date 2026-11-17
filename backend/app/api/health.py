from fastapi import APIRouter
from sqlalchemy import text

from app.core.config import get_settings
from app.db.session import engine

router = APIRouter(tags=["health"])


@router.get("/health")
async def health() -> dict:
    """Liveness check: the API process is up."""
    return {"status": "ok", "app": get_settings().app_name}


@router.get("/health/db")
async def health_db() -> dict:
    """Readiness check: the database answers."""
    try:
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
        return {"database": "ok"}
    except Exception as exc:  # noqa: BLE001 - report any connection failure
        return {"database": "error", "detail": str(exc)[:200]}
