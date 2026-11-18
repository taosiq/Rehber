"""Team: members, roles and invitations.

Rules:
- Everyone in a business can see who else is in it.
- Admins and owners invite people and change/remove members and admins.
- Only owners can make someone an owner or change/remove an owner.
- A business always keeps at least one owner.
- Invite links are random, stored as SHA-256 only, expire after 7 days, work once, and only for
  the account with the invited email address. Until email sending exists (Phase 9) the dashboard
  shows the link once so it can be shared by hand.
"""

import uuid
from datetime import datetime, timedelta, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, field_validator
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.auth import _email
from app.api.deps import CurrentUser, get_current_user, get_membership, get_tenant, require_role
from app.core import ratelimit
from app.core.config import get_settings
from app.core.net import client_ip
from app.core.security import new_token, sha256
from app.db.session import get_db
from app.models import ROLES, Invitation, Membership, Tenant, User
from app.services import email

router = APIRouter(tags=["team"])
INVITE_DAYS = 7

Role = Literal["owner", "admin", "member"]


class MemberOut(BaseModel):
    user_id: uuid.UUID
    name: str
    email: str
    role: str
    joined_at: datetime
    is_you: bool


class RoleIn(BaseModel):
    role: Role


class InviteIn(BaseModel):
    email: str
    role: Literal["admin", "member"] = "member"

    _norm = field_validator("email")(_email)


class InvitationOut(BaseModel):
    id: uuid.UUID
    email: str
    role: str
    invited_by: str | None
    created_at: datetime
    expires_at: datetime


async def _owner_count(db: AsyncSession, tenant_id: uuid.UUID) -> int:
    return await db.scalar(select(func.count()).select_from(Membership)
                           .where(Membership.tenant_id == tenant_id, Membership.role == "owner")) or 0


def _check_can_manage(me: Membership, target_role: str, new_role: str | None = None) -> None:
    if ROLES[me.role] < ROLES["admin"]:
        raise HTTPException(403, "Only owners and admins can manage the team.")
    if me.role != "owner" and ("owner" in (target_role, new_role)):
        raise HTTPException(403, "Only an owner can change owners.")


# ---------------------------------------------------------------- members


@router.get("/tenants/{tenant_id}/members", response_model=list[MemberOut])
async def list_members(current: CurrentUser = Depends(get_current_user), tenant: Tenant = Depends(get_tenant),
                       db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(
        select(Membership, User).join(User, User.id == Membership.user_id)
        .where(Membership.tenant_id == tenant.id).order_by(Membership.created_at)
    )).all()
    return [MemberOut(user_id=u.id, name=u.name, email=u.email, role=m.role, joined_at=m.created_at,
                      is_you=u.id == current.user.id) for m, u in rows]


@router.patch("/tenants/{tenant_id}/members/{user_id}", response_model=MemberOut)
async def change_role(user_id: uuid.UUID, body: RoleIn, current: CurrentUser = Depends(get_current_user),
                      me: Membership = Depends(get_membership), db: AsyncSession = Depends(get_db)):
    target = await db.get(Membership, (user_id, me.tenant_id))
    if target is None:
        raise HTTPException(404, "Member not found")
    _check_can_manage(me, target.role, body.role)
    if target.role == "owner" and body.role != "owner" and await _owner_count(db, me.tenant_id) <= 1:
        raise HTTPException(409, "A business needs at least one owner. Make someone else an owner first.")
    target.role = body.role
    await db.commit()
    user = await db.get(User, user_id)
    return MemberOut(user_id=user.id, name=user.name, email=user.email, role=target.role, joined_at=target.created_at,
                     is_you=user.id == current.user.id)


@router.delete("/tenants/{tenant_id}/members/{user_id}", status_code=204)
async def remove_member(user_id: uuid.UUID, current: CurrentUser = Depends(get_current_user),
                        me: Membership = Depends(get_membership), db: AsyncSession = Depends(get_db)) -> None:
    """Remove someone, or leave the business yourself."""
    target = await db.get(Membership, (user_id, me.tenant_id))
    if target is None:
        raise HTTPException(404, "Member not found")
    if user_id != current.user.id:
        _check_can_manage(me, target.role)
    if target.role == "owner" and await _owner_count(db, me.tenant_id) <= 1:
        raise HTTPException(409, "A business needs at least one owner. Make someone else an owner first.")
    await db.delete(target)
    await db.commit()


# ---------------------------------------------------------------- invitations


@router.get("/tenants/{tenant_id}/invitations", response_model=list[InvitationOut],
            dependencies=[Depends(require_role("admin"))])
async def list_invitations(tenant: Tenant = Depends(get_tenant), db: AsyncSession = Depends(get_db)):
    now = datetime.now(timezone.utc)
    rows = (await db.execute(
        select(Invitation, User.name).outerjoin(User, User.id == Invitation.invited_by)
        .where(Invitation.tenant_id == tenant.id, Invitation.accepted_at.is_(None), Invitation.revoked_at.is_(None),
               Invitation.expires_at > now)
        .order_by(Invitation.created_at.desc())
    )).all()
    return [InvitationOut(id=i.id, email=i.email, role=i.role, invited_by=name, created_at=i.created_at,
                          expires_at=i.expires_at) for i, name in rows]


@router.post("/tenants/{tenant_id}/invitations", status_code=201, dependencies=[Depends(require_role("admin"))])
async def invite(body: InviteIn, current: CurrentUser = Depends(get_current_user),
                 tenant: Tenant = Depends(get_tenant), db: AsyncSession = Depends(get_db)):
    """Returns the invite token ONCE. Inviting the same email again replaces the earlier link."""
    await ratelimit.enforce(f"invite:{tenant.id}", 30, 3600, "Too many invitations. Try again later.")
    existing = await db.scalar(select(User).where(User.email == body.email))
    if existing and await db.get(Membership, (existing.id, tenant.id)):
        raise HTTPException(409, "This person is already in the team.")
    now = datetime.now(timezone.utc)
    for old in (await db.scalars(select(Invitation).where(
        Invitation.tenant_id == tenant.id, Invitation.email == body.email,
        Invitation.accepted_at.is_(None), Invitation.revoked_at.is_(None),
    ))).all():
        old.revoked_at = now
    token = new_token(32)
    inv = Invitation(tenant_id=tenant.id, email=body.email, role=body.role, token_hash=sha256(token),
                     invited_by=current.user.id, expires_at=now + timedelta(days=INVITE_DAYS))
    db.add(inv)
    await db.commit()
    url = f"{get_settings().public_url.rstrip('/')}/invite/{token}"
    sent = await email.send(email.invitation(inv.email, tenant.name, current.user.name, inv.role, url))
    return {"id": str(inv.id), "email": inv.email, "role": inv.role, "expires_at": inv.expires_at, "token": token,
            "emailed": bool(sent and email.enabled())}


@router.delete("/tenants/{tenant_id}/invitations/{invitation_id}", status_code=204,
               dependencies=[Depends(require_role("admin"))])
async def revoke_invitation(invitation_id: uuid.UUID, tenant: Tenant = Depends(get_tenant),
                            db: AsyncSession = Depends(get_db)) -> None:
    inv = await db.get(Invitation, invitation_id)
    if inv is None or inv.tenant_id != tenant.id:
        raise HTTPException(404, "Invitation not found")
    inv.revoked_at = datetime.now(timezone.utc)
    await db.commit()


async def _valid_invitation(db: AsyncSession, token: str) -> Invitation:
    inv = await db.scalar(select(Invitation).where(Invitation.token_hash == sha256(token)))
    now = datetime.now(timezone.utc)
    # One message for every invalid case: unknown, used, revoked or expired.
    if inv is None or inv.accepted_at or inv.revoked_at or inv.expires_at <= now:
        raise HTTPException(404, "This invitation link is invalid or has expired. Ask for a new one.")
    return inv


@router.get("/invitations/{token}")
async def view_invitation(token: str, request: Request, db: AsyncSession = Depends(get_db)):
    """Public: what the invite page shows before logging in. Knowing the token is the permission."""
    ip = client_ip(request)
    await ratelimit.enforce(f"invite-view:{ip}", 30, 600)
    inv = await _valid_invitation(db, token)
    tenant = await db.get(Tenant, inv.tenant_id)
    inviter = await db.get(User, inv.invited_by) if inv.invited_by else None
    return {"business": tenant.name, "role": inv.role, "email": inv.email,
            "invited_by": inviter.name if inviter else None, "expires_at": inv.expires_at}


@router.post("/invitations/{token}/accept")
async def accept_invitation(token: str, current: CurrentUser = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    await ratelimit.enforce(f"invite-accept:{current.user.id}", 20, 600)
    inv = await _valid_invitation(db, token)
    if inv.email != current.user.email:
        raise HTTPException(403, f"This invitation is for {inv.email}. Log in with that email address to accept it.")
    existing = await db.get(Membership, (current.user.id, inv.tenant_id))
    if existing is None:
        db.add(Membership(user_id=current.user.id, tenant_id=inv.tenant_id, role=inv.role))
    inv.accepted_at = datetime.now(timezone.utc)
    await db.commit()
    return {"tenant_id": str(inv.tenant_id)}
