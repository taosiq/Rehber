"""Sign up, log in, log out, current user."""

import re
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import CurrentUser, get_current_user
from app.core import ratelimit
from app.core.config import get_settings
from app.core.security import hash_password, new_token, sha256, verify_password
from app.db.session import get_db
from app.models import AuthSession, Membership, Tenant, User

router = APIRouter(prefix="/auth", tags=["auth"])

EMAIL_RE = re.compile(r"^[^@\s]{1,64}@[^@\s]+\.[^@\s]{2,}$")
BAD_LOGIN = "Incorrect email or password."  # same message for unknown email and wrong password


def _email(v: str) -> str:
    v = v.strip().lower()
    if len(v) > 320 or not EMAIL_RE.match(v):
        raise ValueError("Please enter a valid email address.")
    return v


class SignupIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    email: str
    password: str = Field(min_length=10, max_length=128)

    _norm_email = field_validator("email")(_email)

    @field_validator("password")
    @classmethod
    def _strong_enough(cls, v: str) -> str:
        if len(set(v)) < 5:
            raise ValueError("Password is too simple. Use at least 10 characters with some variety.")
        return v


class LoginIn(BaseModel):
    email: str
    password: str = Field(min_length=1, max_length=128)

    _norm_email = field_validator("email")(_email)


class TenantBrief(BaseModel):
    id: str
    name: str
    role: str


class MeOut(BaseModel):
    id: str
    email: str
    name: str
    csrf_token: str
    tenants: list[TenantBrief]


def _client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


async def _me(db: AsyncSession, user: User, session: AuthSession) -> MeOut:
    rows = (
        await db.execute(
            select(Tenant, Membership.role)
            .join(Membership, Membership.tenant_id == Tenant.id)
            .where(Membership.user_id == user.id)
            .order_by(Tenant.created_at)
        )
    ).all()
    return MeOut(
        id=str(user.id), email=user.email, name=user.name, csrf_token=session.csrf_token,
        tenants=[TenantBrief(id=str(t.id), name=t.name, role=role) for t, role in rows],
    )


async def _start_session(db: AsyncSession, user: User, request: Request, response: Response) -> AuthSession:
    s = get_settings()
    now = datetime.now(timezone.utc)
    # Housekeeping: drop this user's expired sessions.
    await db.execute(delete(AuthSession).where(AuthSession.user_id == user.id, AuthSession.expires_at <= now))

    token = new_token(32)  # a NEW token every login (prevents session fixation)
    session = AuthSession(
        user_id=user.id, token_hash=sha256(token), csrf_token=new_token(32),
        expires_at=now + timedelta(days=s.session_days), last_seen_at=now,
        ip=_client_ip(request)[:64], user_agent=(request.headers.get("user-agent") or "")[:300],
    )
    db.add(session)
    user.last_login_at = now
    await db.commit()
    response.set_cookie(
        s.session_cookie, token, max_age=s.session_days * 86400, httponly=True, secure=s.cookie_secure,
        samesite="lax", path="/", domain=s.cookie_domain,
    )
    return session


@router.post("/signup", response_model=MeOut, status_code=201)
async def signup(body: SignupIn, request: Request, response: Response, db: AsyncSession = Depends(get_db)):
    await ratelimit.enforce(f"signup:ip:{_client_ip(request)}", 5, 3600, "Too many sign-ups from this network. Try later.")
    user = User(email=body.email, name=body.name.strip(), password_hash=hash_password(body.password))
    db.add(user)
    try:
        await db.flush()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(409, "An account with this email already exists. Try logging in.") from None
    session = await _start_session(db, user, request, response)
    return await _me(db, user, session)


@router.post("/login", response_model=MeOut)
async def login(body: LoginIn, request: Request, response: Response, db: AsyncSession = Depends(get_db)):
    ip = _client_ip(request)
    # Two limits: per network (spraying many emails) and per account (guessing one password).
    await ratelimit.enforce(f"login:ip:{ip}", 30, 900)
    await ratelimit.enforce(f"login:email:{body.email}", 8, 900, "Too many attempts for this account. Wait 15 minutes.")

    user = await db.scalar(select(User).where(User.email == body.email))
    ok, upgraded = verify_password(body.password, user.password_hash if user else None)  # constant work either way
    if not user or not ok:
        raise HTTPException(401, BAD_LOGIN)
    if upgraded:
        user.password_hash = upgraded
    await ratelimit.clear(f"login:email:{body.email}")
    session = await _start_session(db, user, request, response)
    return await _me(db, user, session)


@router.post("/logout", status_code=204)
async def logout(response: Response, current: CurrentUser = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    await db.delete(current.session)
    await db.commit()
    s = get_settings()
    response.delete_cookie(s.session_cookie, path="/", domain=s.cookie_domain)


@router.get("/me", response_model=MeOut)
async def me(current: CurrentUser = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return await _me(db, current.user, current.session)



# ---------------------------------------------------------------- account


class ProfileIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)


class PasswordIn(BaseModel):
    current_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=10, max_length=128)

    @field_validator("new_password")
    @classmethod
    def _strong_enough(cls, v: str) -> str:
        if len(set(v)) < 5:
            raise ValueError("Password is too simple. Use at least 10 characters with some variety.")
        return v


class SessionOut(BaseModel):
    id: str
    created_at: datetime
    last_seen_at: datetime | None
    ip: str | None
    user_agent: str | None
    current: bool


@router.patch("/me", response_model=MeOut)
async def update_profile(body: ProfileIn, current: CurrentUser = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    current.user.name = body.name.strip()
    await db.commit()
    return await _me(db, current.user, current.session)


@router.post("/password", status_code=204)
async def change_password(body: PasswordIn, current: CurrentUser = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Needs the current password. Signs out every other browser (this one stays logged in)."""
    await ratelimit.enforce(f"password:{current.user.id}", 8, 900, "Too many attempts. Wait 15 minutes.")
    ok, _ = verify_password(body.current_password, current.user.password_hash)
    if not ok:
        raise HTTPException(400, "Your current password is not correct.")
    if body.new_password == body.current_password:
        raise HTTPException(400, "Choose a password different from the current one.")
    current.user.password_hash = hash_password(body.new_password)
    await db.execute(delete(AuthSession).where(AuthSession.user_id == current.user.id, AuthSession.id != current.session.id))
    await db.commit()


@router.get("/sessions", response_model=list[SessionOut])
async def list_sessions(current: CurrentUser = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    now = datetime.now(timezone.utc)
    rows = (await db.scalars(select(AuthSession).where(AuthSession.user_id == current.user.id, AuthSession.expires_at > now)
                             .order_by(AuthSession.last_seen_at.desc().nulls_last()))).all()
    return [SessionOut(id=str(s.id), created_at=s.created_at, last_seen_at=s.last_seen_at, ip=s.ip,
                       user_agent=s.user_agent, current=s.id == current.session.id) for s in rows]


@router.post("/sessions/revoke-others", status_code=204)
async def revoke_other_sessions(current: CurrentUser = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    await db.execute(delete(AuthSession).where(AuthSession.user_id == current.user.id, AuthSession.id != current.session.id))
    await db.commit()
