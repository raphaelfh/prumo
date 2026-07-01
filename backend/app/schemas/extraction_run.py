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
        pattern="^(pending|extract|consensus|finalized|cancelled)$",
    )


class MarkReadyRequest(BaseModel):
    """Toggle the caller's per-reviewer "I'm done extracting" flag for a run."""

    ready: bool = True


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


class RunReadyStateResponse(BaseModel):
    """The "N/M reviewers ready" hint. Advisory only — readiness gates nothing.

    ``reviewer_count`` is ``max(hitl_config reviewer_count, ready_count)`` so the
    hint never reads "N of M" with N > M (the configured count is often the inert
    default of 1)."""

    ready_count: int
    reviewer_count: int
    reviewers_ready: list[UUID]


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


class ApproveFinalizeResponse(BaseModel):
    """Result of POST /runs/{id}/approve-finalize: the finalized run + how many
    coords the approve-all step published."""

    run: RunSummaryResponse
    published_count: int


class RunDetailResponse(BaseModel):
    run: RunSummaryResponse
    proposals: list[ProposalRecordResponse]
    decisions: list[ReviewerDecisionResponse]
    consensus_decisions: list[ConsensusDecisionResponse]
    published_states: list[PublishedStateResponse]
    # Effective unblind for this caller on this run: can_see_peers OR finalized
    # OR (consensus AND arbitrator). The client shows the compare/evaluate-all
    # surface from this rather than re-deriving visibility. Set by
    # get_run_with_workflow_history from the same `unblinded` local that drives
    # the row filter, so it cannot drift from the actual filtering.
    peers_revealed: bool = False


class RunViewField(BaseModel):
    """A field in the frozen template snapshot, widened to every column the
    run-open form renders from. Sourced from the version snapshot (or the live
    table when the snapshot is a pre-0026 narrow one)."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    label: str
    description: str | None = None
    field_type: str
    is_required: bool
    validation_schema: Any | None = None
    allowed_values: Any | None = None
    unit: str | None = None
    allowed_units: Any | None = None
    sort_order: int
    llm_description: str | None = None
    allow_other: bool = False
    other_label: str | None = None
    other_placeholder: str | None = None
    # ADR-0016 opt-in disposition flags; default False for pre-0038 snapshots.
    allows_not_applicable: bool = False
    allows_not_evaluated: bool = False


class RunViewEntityType(BaseModel):
    """An entity type in the frozen template snapshot, with its fields embedded.
    ``role`` drives the study/model partition; the tree hierarchy is conveyed by
    ``parent_entity_type_id`` (flat array, ordered by ``sort_order``)."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    label: str
    description: str | None = None
    parent_entity_type_id: UUID | None = None
    cardinality: str
    role: str
    sort_order: int
    is_required: bool
    fields: list[RunViewField]


class RunViewCurrentValue(BaseModel):
    """The caller's current value for one (instance, field) coordinate, resolved
    server-side for review/consensus/finalized. ``value`` is the raw jsonb
    envelope (``{value, unit}`` or scalar) — the client unwraps it exactly as it
    did for ``loadValuesForUser``. Empty list for proposal/pending/cancelled."""

    instance_id: UUID
    field_id: UUID
    value: dict[str, Any] | None
    decision: str


class RunViewInstance(BaseModel):
    """A single extraction instance, sourced from extraction_instances and scoped
    to the run's (article_id, template_id) pair. The ``metadata`` ORM column maps
    to ``metadata_`` on the ORM object; ``validation_alias`` ensures
    ``model_validate(orm_obj)`` reads the right attribute while the JSON output
    key stays ``metadata``."""

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    id: UUID
    entity_type_id: UUID
    parent_instance_id: UUID | None
    label: str
    sort_order: int
    metadata: dict[str, Any] = Field(validation_alias="metadata_")
    project_id: UUID
    article_id: UUID | None
    template_id: UUID
    created_by: UUID
    created_at: datetime
    updated_at: datetime


class RunViewResponse(RunDetailResponse):
    """``RunDetailResponse`` (run + blind-filtered workflow rows) plus the three
    pieces the run-open form needs server-side: the frozen entity_types tree,
    the caller's current_values, and the instances for the run's
    (article_id, template_id) scope."""

    entity_types: list[RunViewEntityType]
    current_values: list[RunViewCurrentValue]
    instances: list[RunViewInstance]
    # Per-reviewer "ready" hint (advisory; see RunReadyStateResponse).
    ready_count: int = 0
    reviewer_count: int = 0
    reviewers_ready: list[UUID] = Field(default_factory=list)


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


# ----- Article-scoped run-resolution schemas -----


class ArticleRunRef(BaseModel):
    """Per-article run reference returned by POST /articles/form-runs.

    ``run_id`` is None when the article has no matching run.
    """

    article_id: UUID
    run_id: UUID | None


class FormRunsRequest(BaseModel):
    """Request body for POST /api/v1/articles/form-runs.

    Resolves the latest relevant run for each article_id in the batch.
    ``project_id`` is used for BOLA enforcement.
    """

    article_ids: list[UUID]
    template_id: UUID
    project_id: UUID
