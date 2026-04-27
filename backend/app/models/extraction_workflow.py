"""Extraction HITL workflow models.

Five tables back the proposal -> review -> consensus -> published lifecycle:
- ExtractionProposalRecord: append-only AI/human/system proposals.
- ExtractionReviewerDecision: append-only per-reviewer accept/reject/edit.
- ExtractionReviewerState: materialized current state per (reviewer, run, item).
- ExtractionConsensusDecision: append-only consensus events.
- ExtractionPublishedState: canonical value with optimistic concurrency.

All five share the (run_id, instance_id, field_id) coordinate system that
identifies a single field on a single instance under a single Run.
"""

from datetime import datetime
from enum import Enum as PyEnum
from uuid import UUID

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import BaseModel, PostgreSQLEnumType


class ExtractionProposalSource(str, PyEnum):
    """Source of a proposal."""

    AI = "ai"
    HUMAN = "human"
    SYSTEM = "system"


class ExtractionReviewerDecisionType(str, PyEnum):
    """Reviewer decision type."""

    ACCEPT_PROPOSAL = "accept_proposal"
    REJECT = "reject"
    EDIT = "edit"


class ExtractionConsensusMode(str, PyEnum):
    """Consensus resolution mode."""

    SELECT_EXISTING = "select_existing"
    MANUAL_OVERRIDE = "manual_override"


class ExtractionProposalRecord(BaseModel):
    """Append-only proposal: AI/system/human proposes a value for an item."""

    __tablename__ = "extraction_proposal_records"

    run_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.extraction_runs.id", ondelete="CASCADE"),
        nullable=False,
    )
    instance_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.extraction_instances.id", ondelete="CASCADE"),
        nullable=False,
    )
    field_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.extraction_fields.id", ondelete="RESTRICT"),
        nullable=False,
    )
    source: Mapped[str] = mapped_column(
        PostgreSQLEnumType("extraction_proposal_source"),
        nullable=False,
    )
    source_user_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.profiles.id", ondelete="SET NULL"),
        nullable=True,
    )
    proposed_value: Mapped[dict] = mapped_column(JSONB, nullable=False)
    confidence_score: Mapped[float | None] = mapped_column(Numeric, nullable=True)
    rationale: Mapped[str | None] = mapped_column(Text, nullable=True)

    __table_args__ = (
        Index(
            "idx_extraction_proposal_records_run_item",
            "run_id",
            "instance_id",
            "field_id",
        ),
        CheckConstraint(
            "source <> 'human' OR source_user_id IS NOT NULL",
            name="human_has_user",
        ),
        {"schema": "public"},
    )

    def __repr__(self) -> str:
        return f"<ExtractionProposalRecord run={self.run_id} source={self.source}>"


class ExtractionReviewerDecision(BaseModel):
    """Append-only reviewer decision: accept_proposal / reject / edit."""

    __tablename__ = "extraction_reviewer_decisions"

    run_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.extraction_runs.id", ondelete="CASCADE"),
        nullable=False,
    )
    instance_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.extraction_instances.id", ondelete="CASCADE"),
        nullable=False,
    )
    field_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.extraction_fields.id", ondelete="RESTRICT"),
        nullable=False,
    )
    reviewer_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.profiles.id", ondelete="RESTRICT"),
        nullable=False,
    )
    decision: Mapped[str] = mapped_column(
        PostgreSQLEnumType("extraction_reviewer_decision"),
        nullable=False,
    )
    proposal_record_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.extraction_proposal_records.id", ondelete="SET NULL"),
        nullable=True,
    )
    value: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    rationale: Mapped[str | None] = mapped_column(Text, nullable=True)

    __table_args__ = (
        Index(
            "idx_extraction_reviewer_decisions_run_reviewer_item",
            "run_id",
            "reviewer_id",
            "instance_id",
            "field_id",
            "created_at",
        ),
        CheckConstraint(
            "decision <> 'accept_proposal' OR proposal_record_id IS NOT NULL",
            name="accept_has_proposal",
        ),
        CheckConstraint(
            "decision <> 'edit' OR value IS NOT NULL",
            name="edit_has_value",
        ),
        {"schema": "public"},
    )

    def __repr__(self) -> str:
        return f"<ExtractionReviewerDecision run={self.run_id} reviewer={self.reviewer_id} decision={self.decision}>"


class ExtractionReviewerState(BaseModel):
    """Materialized current decision per (reviewer, run, item) - upsert-maintained."""

    __tablename__ = "extraction_reviewer_states"

    run_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.extraction_runs.id", ondelete="CASCADE"),
        nullable=False,
    )
    reviewer_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.profiles.id", ondelete="RESTRICT"),
        nullable=False,
    )
    instance_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.extraction_instances.id", ondelete="CASCADE"),
        nullable=False,
    )
    field_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.extraction_fields.id", ondelete="RESTRICT"),
        nullable=False,
    )
    current_decision_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.extraction_reviewer_decisions.id", ondelete="RESTRICT"),
        nullable=False,
    )
    last_updated: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    __table_args__ = (
        UniqueConstraint(
            "run_id",
            "reviewer_id",
            "instance_id",
            "field_id",
            name="uq_extraction_reviewer_states_run_reviewer_item",
        ),
        {"schema": "public"},
    )

    def __repr__(self) -> str:
        return f"<ExtractionReviewerState run={self.run_id} reviewer={self.reviewer_id}>"


class ExtractionConsensusDecision(BaseModel):
    """Append-only consensus event: select_existing or manual_override."""

    __tablename__ = "extraction_consensus_decisions"

    run_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.extraction_runs.id", ondelete="CASCADE"),
        nullable=False,
    )
    instance_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.extraction_instances.id", ondelete="CASCADE"),
        nullable=False,
    )
    field_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.extraction_fields.id", ondelete="RESTRICT"),
        nullable=False,
    )
    consensus_user_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.profiles.id", ondelete="RESTRICT"),
        nullable=False,
    )
    mode: Mapped[str] = mapped_column(
        PostgreSQLEnumType("extraction_consensus_mode"),
        nullable=False,
    )
    selected_decision_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.extraction_reviewer_decisions.id", ondelete="SET NULL"),
        nullable=True,
    )
    value: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    rationale: Mapped[str | None] = mapped_column(Text, nullable=True)

    __table_args__ = (
        Index(
            "idx_extraction_consensus_decisions_run_item",
            "run_id",
            "instance_id",
            "field_id",
        ),
        CheckConstraint(
            "mode <> 'select_existing' OR selected_decision_id IS NOT NULL",
            name="select_existing_has_decision",
        ),
        CheckConstraint(
            "mode <> 'manual_override' OR (value IS NOT NULL AND rationale IS NOT NULL)",
            name="manual_override_complete",
        ),
        {"schema": "public"},
    )

    def __repr__(self) -> str:
        return f"<ExtractionConsensusDecision run={self.run_id} mode={self.mode}>"


class ExtractionPublishedState(BaseModel):
    """Canonical value per (run, instance, field) with optimistic concurrency."""

    __tablename__ = "extraction_published_states"

    run_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.extraction_runs.id", ondelete="CASCADE"),
        nullable=False,
    )
    instance_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.extraction_instances.id", ondelete="CASCADE"),
        nullable=False,
    )
    field_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.extraction_fields.id", ondelete="RESTRICT"),
        nullable=False,
    )
    value: Mapped[dict] = mapped_column(JSONB, nullable=False)
    published_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    published_by: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.profiles.id", ondelete="RESTRICT"),
        nullable=False,
    )
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)

    __table_args__ = (
        UniqueConstraint(
            "run_id",
            "instance_id",
            "field_id",
            name="uq_extraction_published_states_run_item",
        ),
        {"schema": "public"},
    )

    def __repr__(self) -> str:
        return f"<ExtractionPublishedState run={self.run_id} v={self.version}>"
