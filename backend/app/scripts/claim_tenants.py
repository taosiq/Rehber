"""Give businesses that have no members to a user (one-time, for data created before logins).

Usage:  python -m app.scripts.claim_tenants you@example.com
"""

import asyncio
import sys

from sqlalchemy import select

from app.db.session import SessionLocal
from app.models import Membership, Tenant, User


async def main(email: str) -> None:
    async with SessionLocal() as db:
        user = await db.scalar(select(User).where(User.email == email.strip().lower()))
        if user is None:
            sys.exit(f"No user with email {email}. Sign up in the dashboard first.")
        owned = select(Membership.tenant_id)
        orphans = (await db.scalars(select(Tenant).where(Tenant.id.not_in(owned)))).all()
        for t in orphans:
            db.add(Membership(user_id=user.id, tenant_id=t.id, role="owner"))
        await db.commit()
        print(f"Gave {len(orphans)} business(es) to {user.email}: {', '.join(t.name for t in orphans) or '-'}")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    asyncio.run(main(sys.argv[1]))
