"""Unified evaluation review/consensus/evidence models (skeleton)."""

from enum import Enum as PyEnum
from uuid import UUID

from sqlalchemy import ForeignKey, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import BaseModel, PostgreSQLEnumType


class ReviewerDecisionType(str, PyEnum):
    """Reviewer decision actions."""

    ACCEPT = "accept"
    REJECT = "reject"
    EDIT = "edit"


class ConsensusDecisionMode(str, PyEnum):
    """Modes allowed when publishing consensus."""

    SELECT_EXISTING = "select_existing"
    MANUAL_OVERRIDE = "manual_override"


class PublishedStateStatus(str, PyEnum):
    """Published state lifecycle."""

    PUBLISHED = "published"
    SUPERSEDED = "superseded"


class EvidenceEntityType(str, PyEnum):
    """Entities that may receive evidence attachments."""

    PROPOSAL = "proposal"
    REVIEWER_DECISION = "reviewer_decision"
    CONSENSUS_DECISION = "consensus_decision"
    PUBLISHED_STATE = "published_state"


class ReviewerDecisionRecord(BaseModel):
    """Append-only reviewer decision history."""

    __tablename__ = "reviewer_decision_records"

    project_id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False, index=True)
    run_id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False, index=True)
    target_id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False, index=True)
    item_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.evaluation_items.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    schema_version_id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False, index=True)
    reviewer_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.profiles.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    proposal_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.proposal_records.id", ondelete="SET NULL"),
        nullable=True,
    )
    decision: Mapped[str] = mapped_column(PostgreSQLEnumType("reviewer_decision_type"), nullable=False)
    edited_value_json: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    rationale: Mapped[str | None] = mapped_column(Text, nullable=True)

    __table_args__ = ({"schema": "public"},)


class ReviewerState(BaseModel):
    """Materialized latest state for each reviewer/target/item."""

    __tablename__ = "reviewer_states"

    project_id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False, index=True)
    reviewer_id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False, index=True)
    target_id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False, index=True)
    item_id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False, index=True)
    schema_version_id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False, index=True)
    latest_decision_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.reviewer_decision_records.id", ondelete="CASCADE"),
        nullable=False,
    )
    latest_decision: Mapped[str] = mapped_column(PostgreSQLEnumType("reviewer_decision_type"), nullable=False)

    __table_args__ = (
        UniqueConstraint(
            "reviewer_id",
            "target_id",
            "item_id",
            "schema_version_id",
            name="reviewer_states_reviewer_id_target_id_item_id_schema_version_id_key",
        ),
        {"schema": "public"},
    )


class ConsensusDecisionRecord(BaseModel):
    """Auditable consensus publication events."""

    __tablename__ = "consensus_decision_records"

    project_id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False, index=True)
    target_id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False, index=True)
    item_id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False, index=True)
    schema_version_id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False, index=True)
    run_id: Mapped[UUID | None] = mapped_column(PG_UUID(as_uuid=True), nullable=True, index=True)
    decision_maker_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.profiles.id", ondelete="RESTRICT"),
        nullable=False,
    )
    mode: Mapped[str] = mapped_column(PostgreSQLEnumType("consensus_decision_mode"), nullable=False)
    selected_reviewer_decision_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.reviewer_decision_records.id", ondelete="SET NULL"),
        nullable=True,
    )
    override_value_json: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    override_justification: Mapped[str | None] = mapped_column(Text, nullable=True)

    __table_args__ = ({"schema": "public"},)


class PublishedState(BaseModel):
    """Authoritative published state consumed downstream."""

    __tablename__ = "published_states"

    project_id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False, index=True)
    target_id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False, index=True)
    item_id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False, index=True)
    schema_version_id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False, index=True)
    latest_consensus_decision_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.consensus_decision_records.id", ondelete="CASCADE"),
        nullable=False,
    )
    published_value_json: Mapped[dict] = mapped_column(JSONB, nullable=False)
    published_status: Mapped[str] = mapped_column(
        PostgreSQLEnumType("published_state_status"),
        default=PublishedStateStatus.PUBLISHED.value,
        nullable=False,
    )

    __table_args__ = (
        UniqueConstraint(
            "project_id",
            "target_id",
            "item_id",
            "schema_version_id",
            name="published_states_project_id_target_id_item_id_schema_version_id_key",
        ),
        {"schema": "public"},
    )


class EvidenceRecord(BaseModel):
    """Metadata for uploaded evidence files."""

    __tablename__ = "evidence_records"

    project_id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False, index=True)
    entity_type: Mapped[str] = mapped_column(PostgreSQLEnumType("evidence_entity_type"), nullable=False)
    entity_id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False, index=True)
    storage_path: Mapped[str] = mapped_column(String, nullable=False)
    filename: Mapped[str] = mapped_column(String, nullable=False)
    mime_type: Mapped[str] = mapped_column(String, nullable=False)
    size_bytes: Mapped[int] = mapped_column(nullable=False)
    uploaded_by: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.profiles.id", ondelete="RESTRICT"),
        nullable=False,
    )

    __table_args__ = ({"schema": "public"},)
