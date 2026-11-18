"""Authentication and authorization dependencies.

Every dashboard route under /tenants/{tenant_id} depends on `get_tenant`, which:
  1. requires a valid, unexpired session cookie        -> else 401
  2. requires the X-CSRF-Token header on state changes -> else 403
  3. requires a membership in THAT business            -> else 404 (don't reveal it exists)
Routes that change configuration add `require_role("admin")`.
"""

import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from fastapi import Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.security import constant_time_equals, sha256
from app.db.session import get_db
from app.models import ROLES, AuthSession, Membership, Tenant, User

SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}


@dataclass
class CurrentUser:
    user: User
    session: AuthSession


async def get_current_user(request: Request, db: AsyncSession = Depends(get_db)) -> CurrentUser:
    token = request.cookies.get(get_settings().session_cookie)
    if not token:
        raise HTTPException(401, "Please log in.")
    session = await db.scalar(select(AuthSession).where(AuthSession.token_hash == sha256(token)))
    now = datetime.now(timezone.utc)
    if session is None or session.expires_at <= now:
        raise HTTPException(401, "Your session has expired. Please log in again.")

    # CSRF: cookies are sent automatically by browsers, so any state-changing request
    # must also prove it came from our dashboard by echoing the per-session token.
    if request.method not in SAFE_METHODS and not constant_time_equals(
        request.headers.get("X-CSRF-Token"), session.csrf_token
    ):
        raise HTTPException(403, "Security check failed (missing or invalid CSRF token). Please reload the page.")

    user = await db.get(User, session.user_id)
    if user is None:
        raise HTTPException(401, "Please log in.")

    # Touch at most every 5 minutes to avoid a write on every request.
    if session.last_seen_at is None or now - session.last_seen_at > timedelta(minutes=5):
        session.last_seen_at = now
        await db.commit()
    return CurrentUser(user=user, session=session)


async def get_membership(
    tenant_id: uuid.UUID, current: CurrentUser = Depends(get_current_user), db: AsyncSession = Depends(get_db)
) -> Membership:
    membership = await db.get(Membership, (current.user.id, tenant_id))
    if membership is None:
        # 404, not 403: don't confirm that another business exists.
        raise HTTPException(404, "Business not found")
    return membership


async def get_tenant(
    tenant_id: uuid.UUID, membership: Membership = Depends(get_membership), db: AsyncSession = Depends(get_db)
) -> Tenant:
    tenant = await db.get(Tenant, tenant_id)
    if tenant is None:
        raise HTTPException(404, "Business not found")
    return tenant


def require_role(minimum: str):
    """Dependency factory: e.g. Depends(require_role("admin"))."""

    async def check(membership: Membership = Depends(get_membership)) -> Membership:
        if ROLES.get(membership.role, 0) < ROLES[minimum]:
            raise HTTPException(403, f"This action needs the '{minimum}' role.")
        return membership

    return check
