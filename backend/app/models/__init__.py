"""Database models.

Every business-owned row carries `tenant_id`, so one business can never
read another business's data. All queries filter on it.
"""

import uuid
from datetime import date, datetime
from decimal import Decimal

from pgvector.sqlalchemy import Vector
from sqlalchemy import (
    JSON,
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.config import get_settings
from app.db.session import Base

EMBED_DIM = get_settings().embedding_dim


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Tenant(TimestampMixin, Base):
    """A business using Rehber."""

    __tablename__ = "tenants"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(200))
    slug: Mapped[str] = mapped_column(String(100), unique=True, index=True)
    default_language: Mapped[str] = mapped_column(String(5), default="en")
    settings: Mapped[dict] = mapped_column(JSON, default=dict)

    documents: Mapped[list["Document"]] = relationship(back_populates="tenant", cascade="all, delete-orphan")


class Document(TimestampMixin, Base):
    """An uploaded PDF, crawled web page or pasted text."""

    __tablename__ = "documents"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(500))
    source_type: Mapped[str] = mapped_column(String(20))  # "pdf" | "url" | "text"
    source_uri: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(20), default="pending")  # pending|processing|ready|failed
    error: Mapped[str | None] = mapped_column(Text)
    chunk_count: Mapped[int] = mapped_column(Integer, default=0)
    char_count: Mapped[int] = mapped_column(Integer, default=0)

    tenant: Mapped[Tenant] = relationship(back_populates="documents")
    chunks: Mapped[list["Chunk"]] = relationship(back_populates="document", cascade="all, delete-orphan")


class Chunk(Base):
    """A piece of a document plus its embedding vector, used for RAG search."""

    __tablename__ = "chunks"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    document_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("documents.id", ondelete="CASCADE"), index=True)
    position: Mapped[int] = mapped_column(Integer)
    content: Mapped[str] = mapped_column(Text)
    page: Mapped[int | None] = mapped_column(Integer)
    embedding: Mapped[list[float] | None] = mapped_column(Vector(EMBED_DIM))

    document: Mapped[Document] = relationship(back_populates="chunks")

    __table_args__ = (
        # Approximate nearest-neighbour index for fast cosine search
        Index(
            "ix_chunks_embedding_hnsw",
            "embedding",
            postgresql_using="hnsw",
            postgresql_with={"m": 16, "ef_construction": 64},
            postgresql_ops={"embedding": "vector_cosine_ops"},
        ),
    )


class Conversation(TimestampMixin, Base):
    """One chat session between a customer and a business's agent."""

    __tablename__ = "conversations"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    channel: Mapped[str] = mapped_column(String(20), default="playground")  # playground|widget|whatsapp
    title: Mapped[str | None] = mapped_column(String(200))
    status: Mapped[str] = mapped_column(String(20), default="open")  # open | handoff | resolved
    handoff_reason: Mapped[str | None] = mapped_column(Text)
    handoff_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    customer_contact: Mapped[str | None] = mapped_column(String(200))
    # An action proposed by the agent that waits for the customer's confirmation
    # in their next message (e.g. a booking). Enforced in code, not just the prompt.
    pending_action: Mapped[dict | None] = mapped_column(JSON)
    # Inbox: a team member can take over; while ai_paused the agent stays silent.
    ai_paused: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("false"))
    assigned_to: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    last_message_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)
    staff_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    messages: Mapped[list["Message"]] = relationship(
        back_populates="conversation", cascade="all, delete-orphan", order_by="Message.created_at"
    )


class Message(TimestampMixin, Base):
    """A user or assistant message. Assistant rows also record sources, cost and speed."""

    __tablename__ = "messages"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    conversation_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("conversations.id", ondelete="CASCADE"), index=True
    )
    role: Mapped[str] = mapped_column(String(20))  # user | assistant | staff
    author_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))  # staff replies
    content: Mapped[str] = mapped_column(Text)
    language: Mapped[str | None] = mapped_column(String(5))  # detected, e.g. "tr"
    sources: Mapped[list | None] = mapped_column(JSON)  # cited passages
    tool_calls: Mapped[list | None] = mapped_column(JSON)  # [{name, args, status, result}]
    model: Mapped[str | None] = mapped_column(String(100))
    prompt_tokens: Mapped[int | None] = mapped_column(Integer)
    completion_tokens: Mapped[int | None] = mapped_column(Integer)
    latency_ms: Mapped[int | None] = mapped_column(Integer)  # total time to full answer
    first_token_ms: Mapped[int | None] = mapped_column(Integer)  # time to first streamed word
    cost_usd: Mapped[Decimal | None] = mapped_column(Numeric(14, 8))  # estimated at list price when answered
    trace_id: Mapped[str | None] = mapped_column(String(64))  # Langfuse trace, when tracing is on

    conversation: Mapped[Conversation] = relationship(back_populates="messages")

    __table_args__ = (Index("ix_messages_tenant_created", "tenant_id", "created_at"),)


class AgentError(TimestampMixin, Base):
    """A turn that failed (AI quota, network, bug). Counted in the reliability numbers."""

    __tablename__ = "agent_errors"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    conversation_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("conversations.id", ondelete="SET NULL"))
    kind: Mapped[str] = mapped_column(String(30))  # rate_limit | connection | config | other
    detail: Mapped[str] = mapped_column(String(500))


class Appointment(TimestampMixin, Base):
    """A booking made by the agent (or later, by staff)."""

    __tablename__ = "appointments"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    conversation_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("conversations.id", ondelete="SET NULL"))
    code: Mapped[str] = mapped_column(String(12))  # shown to the customer, e.g. "RB-7K2Q"
    customer_name: Mapped[str] = mapped_column(String(200))
    customer_contact: Mapped[str] = mapped_column(String(200))
    service: Mapped[str] = mapped_column(String(200))
    start_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    end_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    status: Mapped[str] = mapped_column(String(20), default="confirmed")  # confirmed | cancelled
    notes: Mapped[str | None] = mapped_column(Text)

    __table_args__ = (
        # Database-level guard against double-booking the same start time.
        Index(
            "uq_appointments_slot",
            "tenant_id",
            "start_at",
            unique=True,
            postgresql_where=text("status = 'confirmed'"),
        ),
    )


class Order(TimestampMixin, Base):
    """A customer order, synced from the business's shop system (or demo data)."""

    __tablename__ = "orders"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    order_number: Mapped[str] = mapped_column(String(50))
    customer_email: Mapped[str | None] = mapped_column(String(200))
    customer_phone: Mapped[str | None] = mapped_column(String(50))
    status: Mapped[str] = mapped_column(String(20))  # processing|shipped|delivered|cancelled|returned
    items: Mapped[list] = mapped_column(JSON, default=list)  # [{name, qty}]
    total: Mapped[Decimal] = mapped_column(Numeric(10, 2))
    currency: Mapped[str] = mapped_column(String(3), default="TRY")
    carrier: Mapped[str | None] = mapped_column(String(100))
    tracking_number: Mapped[str | None] = mapped_column(String(100))
    estimated_delivery: Mapped[date | None] = mapped_column(Date)

    __table_args__ = (UniqueConstraint("tenant_id", "order_number", name="uq_orders_number"),)


# ---------------------------------------------------------------- auth

ROLES = {"member": 1, "admin": 2, "owner": 3}  # higher = more permissions


class User(TimestampMixin, Base):
    """A dashboard user (business owner or staff)."""

    __tablename__ = "users"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    email: Mapped[str] = mapped_column(String(320), unique=True, index=True)  # stored lower-case
    name: Mapped[str] = mapped_column(String(200))
    password_hash: Mapped[str] = mapped_column(String(255))
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Membership(TimestampMixin, Base):
    """Which users can access which business, and with what role."""

    __tablename__ = "memberships"
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("tenants.id", ondelete="CASCADE"), primary_key=True, index=True
    )
    role: Mapped[str] = mapped_column(String(20), default="owner")  # owner | admin | member


class AuthSession(TimestampMixin, Base):
    """A logged-in browser. Only the SHA-256 of the cookie token is stored."""

    __tablename__ = "auth_sessions"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    csrf_token: Mapped[str] = mapped_column(String(64))  # sent back in X-CSRF-Token on changes
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    ip: Mapped[str | None] = mapped_column(String(64))
    user_agent: Mapped[str | None] = mapped_column(String(300))


class ApiKey(TimestampMixin, Base):
    """Keys for the website widget (publishable) and server integrations (secret)."""

    __tablename__ = "api_keys"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(100))
    kind: Mapped[str] = mapped_column(String(20))  # publishable | secret
    prefix: Mapped[str] = mapped_column(String(16))  # first characters, shown to identify the key
    key_hash: Mapped[str] = mapped_column(String(64), unique=True)
    allowed_origins: Mapped[list] = mapped_column(JSON, default=list)  # publishable only
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Invitation(TimestampMixin, Base):
    """An invite link to join a business. Only the SHA-256 of the link token is stored."""

    __tablename__ = "invitations"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    email: Mapped[str] = mapped_column(String(320))  # lower-case; only this account can accept
    role: Mapped[str] = mapped_column(String(20))  # admin | member
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    invited_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    accepted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
