"""Persistent data model.

Every organization-owned row carries ``org_id`` and every query in the API layer is
scoped by it. Secrets are only ever stored encrypted in ``secrets.ciphertext``; other
tables hold a ``secret_id`` reference.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import (
    JSON,
    BigInteger,
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    LargeBinary,
    String,
    Text,
    TypeDecorator,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from sca.db import Base


def new_id() -> str:
    return uuid.uuid4().hex


def utcnow() -> datetime:
    return datetime.now(UTC)


class UTCDateTime(TypeDecorator):
    """Stores naive UTC, returns aware UTC (SQLite drops tzinfo)."""

    impl = DateTime
    cache_ok = True

    def process_bind_param(self, value, dialect):
        if value is None:
            return None
        if value.tzinfo is None:
            value = value.replace(tzinfo=UTC)
        return value.astimezone(UTC).replace(tzinfo=None)

    def process_result_value(self, value, dialect):
        if value is None:
            return None
        return value.replace(tzinfo=UTC)


def _pk() -> Mapped[str]:
    return mapped_column(String(32), primary_key=True, default=new_id)


def _created() -> Mapped[datetime]:
    return mapped_column(UTCDateTime, default=utcnow, nullable=False)


# ---------------------------------------------------------------------------
# Identity, tenancy, access
# ---------------------------------------------------------------------------


class Organization(Base):
    __tablename__ = "organizations"
    id: Mapped[str] = _pk()
    name: Mapped[str] = mapped_column(String(200))
    slug: Mapped[str] = mapped_column(String(100), unique=True)
    settings: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = _created()


class User(Base):
    __tablename__ = "users"
    id: Mapped[str] = _pk()
    email: Mapped[str] = mapped_column(String(320), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(200))
    password_hash: Mapped[str] = mapped_column(String(255))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    must_change_password: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = _created()
    last_login_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)


class Membership(Base):
    __tablename__ = "memberships"
    __table_args__ = (UniqueConstraint("org_id", "user_id"),)
    id: Mapped[str] = _pk()
    org_id: Mapped[str] = mapped_column(ForeignKey("organizations.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    role: Mapped[str] = mapped_column(String(32))
    created_at: Mapped[datetime] = _created()
    user: Mapped[User] = relationship(lazy="joined")


class Team(Base):
    __tablename__ = "teams"
    __table_args__ = (UniqueConstraint("org_id", "name"),)
    id: Mapped[str] = _pk()
    org_id: Mapped[str] = mapped_column(ForeignKey("organizations.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(120))
    description: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = _created()


class TeamMember(Base):
    __tablename__ = "team_members"
    __table_args__ = (UniqueConstraint("team_id", "user_id"),)
    id: Mapped[str] = _pk()
    team_id: Mapped[str] = mapped_column(ForeignKey("teams.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)


class AuthSession(Base):
    __tablename__ = "auth_sessions"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)  # sha256(token)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    org_id: Mapped[str] = mapped_column(ForeignKey("organizations.id", ondelete="CASCADE"))
    csrf_token: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[datetime] = _created()
    expires_at: Mapped[datetime] = mapped_column(UTCDateTime)
    last_seen_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    ip: Mapped[str] = mapped_column(String(64), default="")
    user_agent: Mapped[str] = mapped_column(String(300), default="")
    revoked: Mapped[bool] = mapped_column(Boolean, default=False)


class Secret(Base):
    """Encrypted credential. Plaintext never leaves the backend process."""

    __tablename__ = "secrets"
    __table_args__ = (UniqueConstraint("org_id", "name"),)
    id: Mapped[str] = _pk()
    org_id: Mapped[str] = mapped_column(ForeignKey("organizations.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(200))
    kind: Mapped[str] = mapped_column(String(40))  # provider | integration | webhook
    ciphertext: Mapped[bytes] = mapped_column(LargeBinary)
    fingerprint: Mapped[str] = mapped_column(String(16))  # sha256 prefix, safe to display
    created_by: Mapped[str | None] = mapped_column(String(32), nullable=True)
    created_at: Mapped[datetime] = _created()
    rotated_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)


# ---------------------------------------------------------------------------
# Model providers
# ---------------------------------------------------------------------------


class ModelProvider(Base):
    __tablename__ = "model_providers"
    __table_args__ = (UniqueConstraint("org_id", "name"),)
    id: Mapped[str] = _pk()
    org_id: Mapped[str] = mapped_column(ForeignKey("organizations.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(120))
    kind: Mapped[str] = mapped_column(String(40))  # experiential_labs | openai_compatible | openai | anthropic
    base_url: Mapped[str] = mapped_column(String(500), default="")
    secret_id: Mapped[str | None] = mapped_column(ForeignKey("secrets.id", ondelete="SET NULL"), nullable=True)
    default_model: Mapped[str] = mapped_column(String(200), default="")
    embedding_model: Mapped[str] = mapped_column(String(200), default="")
    status: Mapped[str] = mapped_column(String(32), default="untested")  # untested | ok | error
    last_tested_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    last_test_result: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    catalog: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)  # models + published pricing
    created_at: Mapped[datetime] = _created()


# ---------------------------------------------------------------------------
# Agents
# ---------------------------------------------------------------------------


class Agent(Base):
    __tablename__ = "agents"
    __table_args__ = (UniqueConstraint("org_id", "name"),)
    id: Mapped[str] = _pk()
    org_id: Mapped[str] = mapped_column(ForeignKey("organizations.id", ondelete="CASCADE"), index=True)
    team_id: Mapped[str | None] = mapped_column(ForeignKey("teams.id", ondelete="SET NULL"), nullable=True)
    owner_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    name: Mapped[str] = mapped_column(String(80))
    description: Mapped[str] = mapped_column(Text, default="")
    category: Mapped[str] = mapped_column(String(60), default="General")
    avatar: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)  # {icon, color}
    tags: Mapped[list[str]] = mapped_column(JSON, default=list)
    status: Mapped[str] = mapped_column(String(20), default="active")  # draft | active | disabled
    current_version: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[datetime] = _created()
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, onupdate=utcnow)


class AgentVersion(Base):
    """Immutable snapshot of an agent's configuration. Tasks pin a version."""

    __tablename__ = "agent_versions"
    __table_args__ = (UniqueConstraint("agent_id", "version"),)
    id: Mapped[str] = _pk()
    agent_id: Mapped[str] = mapped_column(ForeignKey("agents.id", ondelete="CASCADE"), index=True)
    version: Mapped[int] = mapped_column(Integer)
    config: Mapped[dict[str, Any]] = mapped_column(JSON)
    change_note: Mapped[str] = mapped_column(String(300), default="")
    created_by: Mapped[str] = mapped_column(String(32))
    created_at: Mapped[datetime] = _created()


# ---------------------------------------------------------------------------
# Execution
# ---------------------------------------------------------------------------


class ExecutionSession(Base):
    """A runtime conversation + workspace. Tasks can continue a session."""

    __tablename__ = "execution_sessions"
    id: Mapped[str] = _pk()
    org_id: Mapped[str] = mapped_column(ForeignKey("organizations.id", ondelete="CASCADE"), index=True)
    agent_id: Mapped[str] = mapped_column(ForeignKey("agents.id", ondelete="CASCADE"), index=True)
    conversation_id: Mapped[str] = mapped_column(String(64))
    runtime: Mapped[str] = mapped_column(String(20))
    workspace_path: Mapped[str] = mapped_column(String(500))
    status: Mapped[str] = mapped_column(String(20), default="active")  # active | closed
    title: Mapped[str] = mapped_column(String(200), default="")
    created_at: Mapped[datetime] = _created()
    last_active_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)


TASK_ACTIVE_STATES = ("queued", "running", "waiting_for_approval")
TASK_TERMINAL_STATES = ("completed", "failed", "cancelled", "timed_out")


class Task(Base):
    __tablename__ = "tasks"
    __table_args__ = (
        UniqueConstraint("org_id", "idempotency_key"),
        Index("ix_tasks_dispatch", "status", "scheduled_for", "priority"),
        Index("ix_tasks_agent_status", "agent_id", "status"),
    )
    id: Mapped[str] = _pk()
    org_id: Mapped[str] = mapped_column(ForeignKey("organizations.id", ondelete="CASCADE"), index=True)
    agent_id: Mapped[str] = mapped_column(ForeignKey("agents.id", ondelete="CASCADE"))
    agent_version: Mapped[int] = mapped_column(Integer)
    session_id: Mapped[str | None] = mapped_column(ForeignKey("execution_sessions.id", ondelete="SET NULL"), nullable=True)
    requested_by: Mapped[str | None] = mapped_column(String(32), nullable=True)  # user id
    requested_by_agent_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    title: Mapped[str] = mapped_column(String(200))
    instructions: Mapped[str] = mapped_column(Text)
    priority: Mapped[int] = mapped_column(Integer, default=5)  # 1 (low) .. 10 (high)
    status: Mapped[str] = mapped_column(String(32), default="queued", index=True)
    idempotency_key: Mapped[str | None] = mapped_column(String(200), nullable=True)
    parent_task_id: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)
    root_task_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    delegation_depth: Mapped[int] = mapped_column(Integer, default=0)
    schedule_id: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)
    attempt: Mapped[int] = mapped_column(Integer, default=0)
    max_retries: Mapped[int] = mapped_column(Integer, default=1)
    timeout_s: Mapped[int] = mapped_column(Integer, default=1800)
    scheduled_for: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    created_at: Mapped[datetime] = _created()
    started_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    result_summary: Mapped[str] = mapped_column(Text, default="")
    error: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    cancel_requested: Mapped[bool] = mapped_column(Boolean, default=False)
    lease_owner: Mapped[str | None] = mapped_column(String(80), nullable=True)
    lease_expires_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    trace_id: Mapped[str] = mapped_column(String(32), default=new_id)
    usage: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    inline: Mapped[bool] = mapped_column(Boolean, default=False)  # executed by a delegating parent


class TaskEvent(Base):
    __tablename__ = "task_events"
    __table_args__ = (Index("ix_task_events_task", "task_id", "id"),)
    id: Mapped[int] = mapped_column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True, autoincrement=True)
    org_id: Mapped[str] = mapped_column(String(32), index=True)
    task_id: Mapped[str] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"))
    agent_id: Mapped[str] = mapped_column(String(32), index=True)
    ts: Mapped[datetime] = _created()
    type: Mapped[str] = mapped_column(String(40))
    summary: Mapped[str] = mapped_column(Text, default="")
    data: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)


class Delegation(Base):
    __tablename__ = "delegations"
    id: Mapped[str] = _pk()
    org_id: Mapped[str] = mapped_column(String(32), index=True)
    parent_task_id: Mapped[str] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"), index=True)
    child_task_id: Mapped[str] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"))
    from_agent_id: Mapped[str] = mapped_column(String(32))
    to_agent_id: Mapped[str] = mapped_column(String(32))
    objective: Mapped[str] = mapped_column(Text)
    input_refs: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    permissions: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    depth: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(32), default="queued")
    result_ref: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = _created()


class Artifact(Base):
    __tablename__ = "artifacts"
    __table_args__ = (UniqueConstraint("task_id", "path"),)
    id: Mapped[str] = _pk()
    org_id: Mapped[str] = mapped_column(String(32), index=True)
    task_id: Mapped[str] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"), index=True)
    agent_id: Mapped[str] = mapped_column(String(32), index=True)
    session_id: Mapped[str] = mapped_column(String(32))
    path: Mapped[str] = mapped_column(String(500))  # relative to session workspace
    size: Mapped[int] = mapped_column(BigInteger)
    sha256: Mapped[str] = mapped_column(String(64))
    mime: Mapped[str] = mapped_column(String(120), default="application/octet-stream")
    created_at: Mapped[datetime] = _created()


class UsageRecord(Base):
    __tablename__ = "usage_records"
    id: Mapped[str] = _pk()
    org_id: Mapped[str] = mapped_column(String(32), index=True)
    agent_id: Mapped[str] = mapped_column(String(32), index=True)
    task_id: Mapped[str] = mapped_column(String(32), index=True)
    user_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    provider_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    model: Mapped[str] = mapped_column(String(200))
    prompt_tokens: Mapped[int] = mapped_column(Integer, default=0)
    completion_tokens: Mapped[int] = mapped_column(Integer, default=0)
    cache_read_tokens: Mapped[int] = mapped_column(Integer, default=0)
    llm_requests: Mapped[int] = mapped_column(Integer, default=0)
    tool_calls: Mapped[int] = mapped_column(Integer, default=0)
    cost_usd: Mapped[float | None] = mapped_column(Float, nullable=True)
    cost_source: Mapped[str] = mapped_column(String(32), default="unknown")  # estimated | unknown
    created_at: Mapped[datetime] = _created()


class PlatformToken(Base):
    """Per-execution bearer token for the platform MCP server."""

    __tablename__ = "platform_tokens"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)  # sha256(token)
    org_id: Mapped[str] = mapped_column(String(32))
    task_id: Mapped[str] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"), index=True)
    agent_id: Mapped[str] = mapped_column(String(32))
    expires_at: Mapped[datetime] = mapped_column(UTCDateTime)
    revoked: Mapped[bool] = mapped_column(Boolean, default=False)


# ---------------------------------------------------------------------------
# Approvals
# ---------------------------------------------------------------------------


class ApprovalRequest(Base):
    __tablename__ = "approval_requests"
    id: Mapped[str] = _pk()
    org_id: Mapped[str] = mapped_column(String(32), index=True)
    task_id: Mapped[str] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"), index=True)
    agent_id: Mapped[str] = mapped_column(String(32), index=True)
    kind: Mapped[str] = mapped_column(String(40))  # tool_action | integration_call
    summary: Mapped[str] = mapped_column(Text)
    details: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    status: Mapped[str] = mapped_column(String(20), default="pending", index=True)
    requested_at: Mapped[datetime] = _created()
    expires_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    decided_by: Mapped[str | None] = mapped_column(String(32), nullable=True)
    decided_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    decision_note: Mapped[str] = mapped_column(Text, default="")


# ---------------------------------------------------------------------------
# Integrations
# ---------------------------------------------------------------------------


class Integration(Base):
    __tablename__ = "integrations"
    __table_args__ = (UniqueConstraint("org_id", "name"),)
    id: Mapped[str] = _pk()
    org_id: Mapped[str] = mapped_column(ForeignKey("organizations.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(80))
    description: Mapped[str] = mapped_column(Text, default="")
    type: Mapped[str] = mapped_column(String(20))  # http | mcp
    # business_api | developer_tools | database | communication | documents | other
    category: Mapped[str] = mapped_column(String(40), default="business_api", server_default="business_api")
    config: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    secret_id: Mapped[str | None] = mapped_column(ForeignKey("secrets.id", ondelete="SET NULL"), nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="proposed")  # proposed | active | disabled
    health: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    last_success_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    created_by: Mapped[str] = mapped_column(String(32))
    approved_by: Mapped[str | None] = mapped_column(String(32), nullable=True)
    created_at: Mapped[datetime] = _created()
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, onupdate=utcnow)


class OAuthState(Base):
    """A pending OAuth authorization. ``id`` is the SHA-256 of the state value sent to the vendor,
    so the raw state never sits in the database; the PKCE verifier is stored encrypted."""

    __tablename__ = "oauth_states"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    org_id: Mapped[str] = mapped_column(ForeignKey("organizations.id", ondelete="CASCADE"), index=True)
    integration_id: Mapped[str] = mapped_column(ForeignKey("integrations.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[str] = mapped_column(String(32))
    verifier: Mapped[bytes] = mapped_column(LargeBinary)
    redirect_uri: Mapped[str] = mapped_column(String(500))
    created_at: Mapped[datetime] = _created()
    expires_at: Mapped[datetime] = mapped_column(UTCDateTime)
    used_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)


# ---------------------------------------------------------------------------
# Knowledge
# ---------------------------------------------------------------------------


class KnowledgeSource(Base):
    __tablename__ = "knowledge_sources"
    __table_args__ = (UniqueConstraint("org_id", "name"),)
    id: Mapped[str] = _pk()
    org_id: Mapped[str] = mapped_column(ForeignKey("organizations.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(120))
    description: Mapped[str] = mapped_column(Text, default="")
    category: Mapped[str] = mapped_column(String(60), default="Documents")
    department: Mapped[str] = mapped_column(String(80), default="")
    created_by: Mapped[str] = mapped_column(String(32))
    created_at: Mapped[datetime] = _created()


class Document(Base):
    __tablename__ = "documents"
    id: Mapped[str] = _pk()
    org_id: Mapped[str] = mapped_column(String(32), index=True)
    source_id: Mapped[str] = mapped_column(ForeignKey("knowledge_sources.id", ondelete="CASCADE"), index=True)
    filename: Mapped[str] = mapped_column(String(300))
    mime: Mapped[str] = mapped_column(String(120))
    size: Mapped[int] = mapped_column(BigInteger)
    sha256: Mapped[str] = mapped_column(String(64))
    storage_path: Mapped[str] = mapped_column(String(500))
    status: Mapped[str] = mapped_column(String(20), default="pending")  # pending | processing | indexed | failed
    error: Mapped[str] = mapped_column(Text, default="")
    chunk_count: Mapped[int] = mapped_column(Integer, default=0)
    embedded: Mapped[bool] = mapped_column(Boolean, default=False)
    uploaded_by: Mapped[str] = mapped_column(String(32))
    created_at: Mapped[datetime] = _created()
    indexed_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)


class DocumentChunk(Base):
    __tablename__ = "document_chunks"
    id: Mapped[str] = _pk()
    org_id: Mapped[str] = mapped_column(String(32), index=True)
    source_id: Mapped[str] = mapped_column(String(32), index=True)
    document_id: Mapped[str] = mapped_column(ForeignKey("documents.id", ondelete="CASCADE"), index=True)
    ordinal: Mapped[int] = mapped_column(Integer)
    text: Mapped[str] = mapped_column(Text)
    embedding: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)  # float32 LE


class IngestionJob(Base):
    __tablename__ = "ingestion_jobs"
    id: Mapped[str] = _pk()
    org_id: Mapped[str] = mapped_column(String(32), index=True)
    document_id: Mapped[str] = mapped_column(ForeignKey("documents.id", ondelete="CASCADE"), index=True)
    status: Mapped[str] = mapped_column(String(20), default="queued")
    detail: Mapped[str] = mapped_column(Text, default="")
    started_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    created_at: Mapped[datetime] = _created()


# ---------------------------------------------------------------------------
# Scheduling
# ---------------------------------------------------------------------------


class Schedule(Base):
    __tablename__ = "schedules"
    id: Mapped[str] = _pk()
    org_id: Mapped[str] = mapped_column(ForeignKey("organizations.id", ondelete="CASCADE"), index=True)
    agent_id: Mapped[str] = mapped_column(ForeignKey("agents.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(120))
    instructions: Mapped[str] = mapped_column(Text)
    kind: Mapped[str] = mapped_column(String(20))  # once | cron | webhook
    cron: Mapped[str] = mapped_column(String(120), default="")
    timezone: Mapped[str] = mapped_column(String(64), default="UTC")
    run_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    missed_policy: Mapped[str] = mapped_column(String(20), default="run_once")  # run_once | skip
    next_run_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True, index=True)
    last_run_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    webhook_secret_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    created_by: Mapped[str] = mapped_column(String(32))
    created_at: Mapped[datetime] = _created()


class WebhookDelivery(Base):
    __tablename__ = "webhook_deliveries"
    __table_args__ = (UniqueConstraint("schedule_id", "event_id"),)
    id: Mapped[str] = _pk()
    schedule_id: Mapped[str] = mapped_column(ForeignKey("schedules.id", ondelete="CASCADE"))
    event_id: Mapped[str] = mapped_column(String(200))
    task_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    received_at: Mapped[datetime] = _created()


# ---------------------------------------------------------------------------
# Audit
# ---------------------------------------------------------------------------


class AuditEvent(Base):
    """Append-only, hash-chained audit trail (per organization)."""

    __tablename__ = "audit_events"
    __table_args__ = (Index("ix_audit_org_id", "org_id", "id"),)
    id: Mapped[int] = mapped_column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True, autoincrement=True)
    org_id: Mapped[str] = mapped_column(String(32))
    ts: Mapped[datetime] = _created()
    actor_type: Mapped[str] = mapped_column(String(20))  # user | agent | system
    actor_id: Mapped[str] = mapped_column(String(32), default="")
    action: Mapped[str] = mapped_column(String(80), index=True)
    target_type: Mapped[str] = mapped_column(String(40), default="")
    target_id: Mapped[str] = mapped_column(String(64), default="")
    ip: Mapped[str] = mapped_column(String(64), default="")
    details: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    prev_hash: Mapped[str] = mapped_column(String(64), default="")
    hash: Mapped[str] = mapped_column(String(64), default="")
