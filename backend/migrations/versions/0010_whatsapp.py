"""WhatsApp: connected numbers, customer identity on a channel, idempotent inbound messages.

Revision ID: 0010
Revises: 0009
Create Date: 2026-11-22
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0010"
down_revision: str | None = "0009"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "whatsapp_accounts",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("tenant_id", sa.Uuid(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, unique=True),
        sa.Column("phone_number_id", sa.String(32), nullable=False, unique=True),
        sa.Column("waba_id", sa.String(32), nullable=True),
        sa.Column("display_phone_number", sa.String(40), nullable=True),
        sa.Column("verified_name", sa.String(200), nullable=True),
        sa.Column("token_encrypted", sa.Text(), nullable=False),
        sa.Column("connected_by", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("last_inbound_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_error", sa.String(500), nullable=True),
        sa.Column("last_error_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.add_column("conversations", sa.Column("external_user", sa.String(64), nullable=True))
    op.add_column("conversations", sa.Column("customer_name", sa.String(200), nullable=True))
    op.create_index("ix_conversations_external", "conversations", ["tenant_id", "channel", "external_user"])
    op.add_column("messages", sa.Column("external_id", sa.String(128), nullable=True))
    op.add_column("messages", sa.Column("delivery", sa.String(20), nullable=True))
    op.create_index("uq_messages_external", "messages", ["tenant_id", "external_id"], unique=True,
                    postgresql_where=sa.text("external_id IS NOT NULL"))


def downgrade() -> None:
    op.drop_index("uq_messages_external", table_name="messages")
    op.drop_column("messages", "delivery")
    op.drop_column("messages", "external_id")
    op.drop_index("ix_conversations_external", table_name="conversations")
    op.drop_column("conversations", "customer_name")
    op.drop_column("conversations", "external_user")
    op.drop_table("whatsapp_accounts")
