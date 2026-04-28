"""Schemas for /v1/runs endpoints (extraction-centric HITL)."""

from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

# ----- Request schemas -----


class CreateRunRequest(BaseModel):
    project_id: UUID
    article_id: UUID
    project_template_id: UUID
    parameters: dict[str, Any] | None = None


class CreateProposalRequest(BaseModel):
    instance_id: UUID
    field_id: UUID
    source: str = Field(pattern="^(ai|human|system)$")
    proposed_value: dict[str, Any]
    source_user_id: UUID | None = None
    confidence_score: float | None = None
    rationale: str | None = None


class CreateDecisionRequest(BaseModel):
    instance_id: UUID
    field_id: UUID
    decision: str = Field(pattern="^(accept_proposal|reject|edit)$")
    proposal_record_id: UUID | None = None
    value: dict[str, Any] | None = None
    rationale: str | None = None


class CreateConsensusRequest(BaseModel):
    instance_id: UUID
    field_id: UUID
    mode: str = Field(pattern="^(select_existing|manual_override)$")
    selected_decision_id: UUID | None = None
    value: dict[str, Any] | None = None
    rationale: str | None = None


class AdvanceStageRequest(BaseModel):
    target_stage: str = Field(
        pattern="^(pending|proposal|review|consensus|finalized|cancelled)$",
    )


# ----- Response schemas -----


class ProposalRecordResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    run_id: UUID
    instance_id: UUID
    field_id: UUID
    source: str
    source_user_id: UUID | None
    proposed_value: dict[str, Any]
    confidence_score: float | None
    rationale: str | None
    created_at: datetime


class ReviewerDecisionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    run_id: UUID
    instance_id: UUID
    field_id: UUID
    reviewer_id: UUID
    decision: str
    proposal_record_id: UUID | None
    value: dict[str, Any] | None
    rationale: str | None
    created_at: datetime


class ConsensusDecisionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    run_id: UUID
    instance_id: UUID
    field_id: UUID
    consensus_user_id: UUID
    mode: str
    selected_decision_id: UUID | None
    value: dict[str, Any] | None
    rationale: str | None
    created_at: datetime


class PublishedStateResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    run_id: UUID
    instance_id: UUID
    field_id: UUID
    value: dict[str, Any]
    published_at: datetime
    published_by: UUID
    version: int


class ConsensusResultResponse(BaseModel):
    consensus: ConsensusDecisionResponse
    published: PublishedStateResponse


class RunSummaryResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    project_id: UUID
    article_id: UUID
    template_id: UUID
    kind: str
    version_id: UUID
    stage: str
    status: str
    hitl_config_snapshot: dict[str, Any]
    parameters: dict[str, Any]
    results: dict[str, Any]
    created_at: datetime
    created_by: UUID


class RunDetailResponse(BaseModel):
    run: RunSummaryResponse
    proposals: list[ProposalRecordResponse]
    decisions: list[ReviewerDecisionResponse]
    consensus_decisions: list[ConsensusDecisionResponse]
    published_states: list[PublishedStateResponse]


class RunReviewerProfile(BaseModel):
    """Display profile for a reviewer who participated in a run."""

    id: UUID
    full_name: str | None = None
    avatar_url: str | None = None


class RunReviewersResponse(BaseModel):
    """Lookup table {reviewer_id: profile} for the consensus UI.

    Built from the union of distinct reviewer ids appearing on
    ProposalRecord (source='human'), ReviewerDecision, and
    ConsensusDecision rows for the given run. The frontend uses it to
    render names + avatars instead of raw UUIDs in the consensus
    panel and the divergence indicators.
    """

    reviewers: list[RunReviewerProfile]
