"""Title/abstract screening: enrollment, reviewer decisions, arbitrations.

Backend-only tables (RLS deny-all, no PostgREST read path): blind review needs
the API to decide what each reviewer sees. Decisions and arbitrations are
append-only; the current one is the latest row per coordinate.
"""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy import text as sql_text
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, UUIDMixin

SCREENING_PHASE = "title_abstract"

# SHORT CHECK names: the "ck" convention expands them to ck_<table>_<name>.
_DECISION_CHECK = "decision IN ('include', 'exclude', 'maybe')"
_REASON_CHECK = "exclusion_reason IS NULL OR decision = 'exclude'"


class ScreeningAssignment(Base, UUIDMixin):
    """One article enrolled in one screening phase of its project."""

    __tablename__ = "screening_assignments"

    project_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("public.projects.id", ondelete="CASCADE"), nullable=False
    )
    article_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("public.articles.id", ondelete="CASCADE"), nullable=False
    )
    phase: Mapped[str] = mapped_column(
        Text, nullable=False, default=SCREENING_PHASE, server_default=SCREENING_PHASE
    )
    enrolled_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    enrolled_by: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("public.profiles.id", ondelete="SET NULL")
    )

    __table_args__ = (
        CheckConstraint("phase IN ('title_abstract')", name="phase"),
        UniqueConstraint(
            "project_id", "article_id", "phase", name="uq_screening_assignments_article_phase"
        ),
        Index("ix_screening_assignments_article_id", "article_id"),
        Index(
            "ix_screening_assignments_enrolled_by",
            "enrolled_by",
            postgresql_where=sql_text("enrolled_by IS NOT NULL"),
        ),
        {"schema": "public"},
    )


class ScreeningDecision(Base, UUIDMixin):
    """One reviewer's decision on one assignment. Never updated."""

    __tablename__ = "screening_decisions"

    assignment_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.screening_assignments.id", ondelete="CASCADE"),
        nullable=False,
    )
    reviewer_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("public.profiles.id", ondelete="RESTRICT"), nullable=False
    )
    decision: Mapped[str] = mapped_column(Text, nullable=False)
    exclusion_reason: Mapped[str | None] = mapped_column(Text)
    rationale: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    __table_args__ = (
        CheckConstraint(_DECISION_CHECK, name="decision"),
        CheckConstraint(_REASON_CHECK, name="reason_on_exclude"),
        # Target of the arbitrations' composite FK: a selection stays in its assignment.
        UniqueConstraint("assignment_id", "id", name="uq_screening_decisions_assignment_id_id"),
        Index("ix_screening_decisions_reviewer_id", "reviewer_id"),
        {"schema": "public"},
    )


Index(
    "ix_screening_decisions_current",
    ScreeningDecision.assignment_id,
    ScreeningDecision.reviewer_id,
    ScreeningDecision.created_at.desc(),
    ScreeningDecision.id.desc(),
)


class ScreeningArbitration(Base, UUIDMixin):
    """One arbitrator's ruling on one assignment. Never updated."""

    __tablename__ = "screening_arbitrations"

    assignment_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.screening_assignments.id", ondelete="CASCADE"),
        nullable=False,
    )
    decision: Mapped[str] = mapped_column(Text, nullable=False)
    exclusion_reason: Mapped[str | None] = mapped_column(Text)
    selected_decision_id: Mapped[UUID | None] = mapped_column(PG_UUID(as_uuid=True))
    rationale: Mapped[str | None] = mapped_column(Text)
    decided_by: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("public.profiles.id", ondelete="RESTRICT"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    __table_args__ = (
        CheckConstraint(_DECISION_CHECK, name="decision"),
        CheckConstraint(_REASON_CHECK, name="reason_on_exclude"),
        ForeignKeyConstraint(
            ["assignment_id", "selected_decision_id"],
            ["public.screening_decisions.assignment_id", "public.screening_decisions.id"],
            name="fk_screening_arbitrations_selected_decision_match",
            # Never SET NULL: a composite SET NULL would null the NOT NULL
            # assignment_id too (the 0024 bug). Deferred NO ACTION lets the
            # assignment cascade remove decision and ruling in one statement.
            deferrable=True,
            initially="DEFERRED",
        ),
        Index(
            "ix_screening_arbitrations_selected_decision",
            "assignment_id",
            "selected_decision_id",
            postgresql_where=sql_text("selected_decision_id IS NOT NULL"),
        ),
        Index("ix_screening_arbitrations_decided_by", "decided_by"),
        {"schema": "public"},
    )


Index(
    "ix_screening_arbitrations_current",
    ScreeningArbitration.assignment_id,
    ScreeningArbitration.created_at.desc(),
    ScreeningArbitration.id.desc(),
)
