"""Cost per answer, Langfuse trace id, failed-turn log, analytics index.

Revision ID: 0007
Revises: 0006
Create Date: 2026-11-18
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0007"
down_revision: str | None = "0006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("messages", sa.Column("cost_usd", sa.Numeric(14, 8), nullable=True))
    op.add_column("messages", sa.Column("trace_id", sa.String(64), nullable=True))
    op.create_index("ix_messages_tenant_created", "messages", ["tenant_id", "created_at"])
    # Earlier answers: estimate with the gpt-oss-120b list price ($0.15 / $0.60 per 1M tokens).
    op.execute(
        "UPDATE messages SET cost_usd = (coalesce(prompt_tokens,0) * 0.15 + coalesce(completion_tokens,0) * 0.60) / 1000000 "
        "WHERE role = 'assistant' AND model = 'openai/gpt-oss-120b'"
    )
    op.create_table(
        "agent_errors",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("tenant_id", sa.Uuid(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("conversation_id", sa.Uuid(), sa.ForeignKey("conversations.id", ondelete="SET NULL"), nullable=True),
        sa.Column("kind", sa.String(30), nullable=False),
        sa.Column("detail", sa.String(500), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_agent_errors_tenant_id", "agent_errors", ["tenant_id"])


def downgrade() -> None:
    op.drop_index("ix_agent_errors_tenant_id", table_name="agent_errors")
    op.drop_table("agent_errors")
    op.drop_index("ix_messages_tenant_created", table_name="messages")
    op.drop_column("messages", "trace_id")
    op.drop_column("messages", "cost_usd")
