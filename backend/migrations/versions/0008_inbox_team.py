"""Inbox (take-over, staff replies, unread) and team invitations.

Revision ID: 0008
Revises: 0007
Create Date: 2026-11-18
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0008"
down_revision: str | None = "0007"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("conversations", sa.Column("ai_paused", sa.Boolean(), server_default=sa.text("false"), nullable=False))
    op.add_column("conversations", sa.Column("assigned_to", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True))
    op.add_column("conversations", sa.Column("last_message_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("conversations", sa.Column("staff_seen_at", sa.DateTime(timezone=True), nullable=True))
    op.create_index("ix_conversations_last_message_at", "conversations", ["last_message_at"])
    op.execute(
        "UPDATE conversations c SET last_message_at = coalesce("
        "(SELECT max(m.created_at) FROM messages m WHERE m.conversation_id = c.id), c.created_at)"
    )
    # Everything that existed before the inbox counts as already read.
    op.execute("UPDATE conversations SET staff_seen_at = last_message_at")
    op.add_column("messages", sa.Column("author_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True))

    op.create_table(
        "invitations",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("tenant_id", sa.Uuid(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("email", sa.String(320), nullable=False),
        sa.Column("role", sa.String(20), nullable=False),
        sa.Column("token_hash", sa.String(64), nullable=False, unique=True),
        sa.Column("invited_by", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("accepted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_invitations_tenant_id", "invitations", ["tenant_id"])


def downgrade() -> None:
    op.drop_index("ix_invitations_tenant_id", table_name="invitations")
    op.drop_table("invitations")
    op.drop_column("messages", "author_id")
    op.drop_index("ix_conversations_last_message_at", table_name="conversations")
    for col in ("staff_seen_at", "last_message_at", "assigned_to", "ai_paused"):
        op.drop_column("conversations", col)
