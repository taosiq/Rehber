"""Agent tools: appointments, orders, hand-off fields, tool calls on messages.

Revision ID: 0004
Revises: 0003
Create Date: 2026-11-18
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0004"
down_revision: str | None = "0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("conversations", sa.Column("status", sa.String(20), nullable=False, server_default="open"))
    op.add_column("conversations", sa.Column("handoff_reason", sa.Text()))
    op.add_column("conversations", sa.Column("handoff_at", sa.DateTime(timezone=True)))
    op.add_column("conversations", sa.Column("customer_contact", sa.String(200)))
    op.add_column("messages", sa.Column("tool_calls", sa.JSON()))

    op.create_table(
        "appointments",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("tenant_id", sa.Uuid(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("conversation_id", sa.Uuid(), sa.ForeignKey("conversations.id", ondelete="SET NULL")),
        sa.Column("code", sa.String(12), nullable=False),
        sa.Column("customer_name", sa.String(200), nullable=False),
        sa.Column("customer_contact", sa.String(200), nullable=False),
        sa.Column("service", sa.String(200), nullable=False),
        sa.Column("start_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("end_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="confirmed"),
        sa.Column("notes", sa.Text()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_appointments_tenant_id", "appointments", ["tenant_id"])
    op.create_index(
        "uq_appointments_slot",
        "appointments",
        ["tenant_id", "start_at"],
        unique=True,
        postgresql_where=sa.text("status = 'confirmed'"),
    )

    op.create_table(
        "orders",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("tenant_id", sa.Uuid(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("order_number", sa.String(50), nullable=False),
        sa.Column("customer_email", sa.String(200)),
        sa.Column("customer_phone", sa.String(50)),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("items", sa.JSON(), nullable=False),
        sa.Column("total", sa.Numeric(10, 2), nullable=False),
        sa.Column("currency", sa.String(3), nullable=False, server_default="TRY"),
        sa.Column("carrier", sa.String(100)),
        sa.Column("tracking_number", sa.String(100)),
        sa.Column("estimated_delivery", sa.Date()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("tenant_id", "order_number", name="uq_orders_number"),
    )
    op.create_index("ix_orders_tenant_id", "orders", ["tenant_id"])


def downgrade() -> None:
    op.drop_table("orders")
    op.drop_table("appointments")
    op.drop_column("messages", "tool_calls")
    for col in ("customer_contact", "handoff_at", "handoff_reason", "status"):
        op.drop_column("conversations", col)
