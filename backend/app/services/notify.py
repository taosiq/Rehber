"""Emails to the team about things that need them."""

import logging
import uuid

from sqlalchemy import select

from app.core.config import get_settings
from app.db.session import SessionLocal
from app.models import Conversation, Membership, Tenant, User
from app.services import email

log = logging.getLogger(__name__)


async def handoff(tenant_id: uuid.UUID, conversation_id: uuid.UUID) -> int:
    """Tell the business's owners and admins that a customer needs a person. Returns emails sent."""
    async with SessionLocal() as db:
        tenant = await db.get(Tenant, tenant_id)
        convo = await db.get(Conversation, conversation_id)
        if tenant is None or convo is None:
            return 0
        people = (await db.scalars(
            select(User).join(Membership, Membership.user_id == User.id)
            .where(Membership.tenant_id == tenant_id, Membership.role.in_(["owner", "admin"]))
        )).all()
    url = f"{get_settings().public_url.rstrip('/')}/dashboard/conversations?c={conversation_id}"
    sent = 0
    for person in people:
        ok = await email.send(email.handoff_alert(person.email, tenant.name, convo.handoff_reason, convo.customer_contact, url))
        sent += ok
    return sent
