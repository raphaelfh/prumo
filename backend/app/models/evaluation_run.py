"""Unified evaluation run and proposal models (skeleton)."""

from enum import Enum as PyEnum
from uuid import UUID

from sqlalchemy import ForeignKey, Numeric, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import BaseModel, PostgreSQLEnumType


class EvaluationRunStatus(str, PyEnum):
    """Execution status for evaluation runs."""

    PENDING = "pending"
    ACTIVE = "active"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class EvaluationRunStage(str, PyEnum):
    """Current stage in run lifecycle."""

    PROPOSAL = "proposal"
    REVIEW = "review"
    CONSENSUS = "consensus"
    FINALIZED = "finalized"


class EvaluationProposalSourceType(str, PyEnum):
    """Proposal origin source."""

    AI = "ai"
    HUMAN = "human"
    SYSTEM = "system"


class EvaluationRun(BaseModel):
    """Run context spanning proposal -> review -> consensus."""

    __tablename__ = "evaluation_runs"

    project_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.projects.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    schema_version_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.evaluation_schema_versions.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    name: Mapped[str] = mapped_column(String, nullable=False)
    status: Mapped[str] = mapped_column(
        PostgreSQLEnumType("evaluation_run_status"),
        default=EvaluationRunStatus.PENDING.value,
        nullable=False,
    )
    current_stage: Mapped[str] = mapped_column(
        PostgreSQLEnumType("evaluation_run_stage"),
        default=EvaluationRunStage.PROPOSAL.value,
        nullable=False,
    )
    started_by: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.profiles.id", ondelete="RESTRICT"),
        nullable=False,
    )
    failed_reason: Mapped[str | None] = mapped_column(Text, nullable=True)

    __table_args__ = ({"schema": "public"},)


class EvaluationRunTarget(BaseModel):
    """Target entities selected for a run."""

    __tablename__ = "evaluation_run_targets"

    run_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.evaluation_runs.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    target_id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False, index=True)
    target_type: Mapped[str] = mapped_column(String, nullable=False)

    __table_args__ = (
        UniqueConstraint("run_id", "target_id", name="evaluation_run_targets_run_id_target_id_key"),
        {"schema": "public"},
    )


class ProposalRecord(BaseModel):
    """Append-only proposal values generated for each target item."""

    __tablename__ = "proposal_records"

    project_id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False, index=True)
    run_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.evaluation_runs.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    target_id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False, index=True)
    item_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.evaluation_items.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    schema_version_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.evaluation_schema_versions.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    source_type: Mapped[str] = mapped_column(PostgreSQLEnumType("evaluation_proposal_source_type"), nullable=False)
    value_json: Mapped[dict] = mapped_column(JSONB, nullable=False)
    confidence: Mapped[float | None] = mapped_column(Numeric, nullable=True)
    created_by: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.profiles.id", ondelete="SET NULL"),
        nullable=True,
    )

    __table_args__ = ({"schema": "public"},)
