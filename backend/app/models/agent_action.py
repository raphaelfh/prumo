"""Append-only MCP write audit (spec §6.1).

Backend-only table: RLS deny-all, no PostgREST read path. ``created_at``
is the DB's ``now()``, never Python, so an applied row that opens a draft
carries exactly ``config_draft_since``.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, Text, func, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, UUIDMixin


class AgentAction(Base, UUIDMixin):
    """One MCP write: applied, or refused by a domain rule. Never updated."""

    __tablename__ = "agent_actions"

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    token_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("public.personal_access_tokens.id", ondelete="SET NULL")
    )
    user_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("public.profiles.id", ondelete="SET NULL")
    )
    project_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("public.projects.id", ondelete="CASCADE"), nullable=False
    )
    template_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.project_extraction_templates.id", ondelete="SET NULL"),
    )
    tool: Mapped[str] = mapped_column(Text, nullable=False)
    input: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    before: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    after: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    outcome: Mapped[str] = mapped_column(Text, nullable=False)
    error_code: Mapped[str | None] = mapped_column(Text)

    __table_args__ = (
        # SHORT names: the "ck" convention expands them to ck_agent_actions_<name>.
        CheckConstraint("octet_length(input::text) <= 65536", name="input_size_check"),
        CheckConstraint("outcome IN ('applied', 'refused')", name="outcome_check"),
        CheckConstraint("(outcome = 'applied') = (error_code IS NULL)", name="error_code_check"),
        Index(
            "ix_agent_actions_template_applied",
            "template_id",
            "created_at",
            postgresql_where=text("outcome = 'applied'"),
        ),
        # FK indexes: project/token/profile deletes cascade or SET NULL into this table.
        Index("ix_agent_actions_project_id", "project_id"),
        Index("ix_agent_actions_token_id", "token_id"),
        Index("ix_agent_actions_user_id", "user_id"),
        {"schema": "public"},
    )
