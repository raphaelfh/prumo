"""Append-only AI usage ledger: one row per model call.

Backend-only table: RLS deny-all, no PostgREST read path. Usage outlives the
owner, run, attempt and batch it names (``ON DELETE SET NULL``); a project
delete takes its usage with it. ``total_tokens`` is computed by the database.
"""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from sqlalchemy import CheckConstraint, Computed, DateTime, ForeignKey, Index, Integer, Text, func
from sqlalchemy import text as sql_text
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, UUIDMixin


class AiUsageLedger(Base, UUIDMixin):
    """One metered model call: tokens, outcome, provider request id. Never updated."""

    __tablename__ = "ai_usage_ledger"

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    project_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("public.projects.id", ondelete="CASCADE"), nullable=False
    )
    owner_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("public.profiles.id", ondelete="SET NULL")
    )
    run_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("public.extraction_runs.id", ondelete="SET NULL")
    )
    attempt_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("public.extraction_attempts.id", ondelete="SET NULL")
    )
    batch_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("public.extraction_batches.id", ondelete="SET NULL")
    )
    agent_token_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("public.personal_access_tokens.id", ondelete="SET NULL")
    )
    provider: Mapped[str] = mapped_column(Text, nullable=False)
    model: Mapped[str] = mapped_column(Text, nullable=False)
    # NULL: an env-default call made before credentials resolve has no scope.
    key_scope: Mapped[str | None] = mapped_column(Text)
    pass_kind: Mapped[str] = mapped_column(Text, nullable=False)
    prompt_version: Mapped[str] = mapped_column(Text, nullable=False)
    prompt_tokens: Mapped[int] = mapped_column(Integer, nullable=False)
    completion_tokens: Mapped[int] = mapped_column(Integer, nullable=False)
    total_tokens: Mapped[int] = mapped_column(
        Integer, Computed("prompt_tokens + completion_tokens", persisted=True)
    )
    outcome: Mapped[str] = mapped_column(Text, nullable=False)
    request_id: Mapped[str | None] = mapped_column(Text)

    __table_args__ = (
        # SHORT names: the "ck" convention expands them to ck_ai_usage_ledger_<name>.
        CheckConstraint(
            "key_scope IS NULL OR key_scope IN ('user_byok', 'project_shared', 'global_service')",
            name="key_scope",
        ),
        CheckConstraint(
            "pass_kind IN ('extract', 'identify', 'verify', 'entailment')", name="pass_kind"
        ),
        CheckConstraint("outcome IN ('ok', 'failed')", name="outcome"),
        CheckConstraint("prompt_tokens >= 0", name="prompt_tokens_nonneg"),
        CheckConstraint("completion_tokens >= 0", name="completion_tokens_nonneg"),
        Index("ix_ai_usage_ledger_project_created", "project_id", "created_at"),
        Index("ix_ai_usage_ledger_owner_created", "owner_id", "created_at"),
        Index(
            "ix_ai_usage_ledger_run_id", "run_id", postgresql_where=sql_text("run_id IS NOT NULL")
        ),
        Index(
            "ix_ai_usage_ledger_attempt_id",
            "attempt_id",
            postgresql_where=sql_text("attempt_id IS NOT NULL"),
        ),
        Index(
            "ix_ai_usage_ledger_batch_id",
            "batch_id",
            postgresql_where=sql_text("batch_id IS NOT NULL"),
        ),
        Index(
            "ix_ai_usage_ledger_agent_token_id",
            "agent_token_id",
            postgresql_where=sql_text("agent_token_id IS NOT NULL"),
        ),
        {"schema": "public"},
    )
