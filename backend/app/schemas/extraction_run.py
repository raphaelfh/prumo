"""Schemas for /v1/runs endpoints (extraction-centric HITL)."""

from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

# ----- Request schemas -----


def _reject_client_verification(field_name: str, v: dict[str, Any] | None) -> dict[str, Any] | None:
    # The Verified-mode verdict is server-written provenance (the
    # ``source_user_id`` precedent): a client-sent copy is a loud 422,
    # never a silently-stored forgery. Guarded on BOTH remaining write bags
    # (decision / consensus) so the key cannot be smuggled into the agreement
    # mechanism from any side; the proposal bag went with the /proposals route
    # (ADR-0019). Known residual: a reviewer can
    # still UPDATE a stored row's value bag directly via PostgREST under the
    # baseline RLS policies — tracked as a follow-up; this gate covers the
    # API surface.
    if v is not None and "verification" in v:
        raise ValueError(
            f"{field_name}.verification is server-written provenance and cannot be client-supplied"
        )
    return v


class CreateRunRequest(BaseModel):
    project_id: UUID
    article_id: UUID
    project_template_id: UUID
    parameters: dict[str, Any] | None = None


class CreateDecisionRequest(BaseModel):
    instance_id: UUID
    field_id: UUID
    decision: str = Field(pattern="^(accept_proposal|reject|edit)$")
    proposal_record_id: UUID | None = None
    value: dict[str, Any] | None = None
    rationale: str | None = None

    @field_validator("value")
    @classmethod
    def _reject_server_owned_verification(cls, v: dict[str, Any] | None) -> dict[str, Any] | None:
        return _reject_client_verification("value", v)


class CreateConsensusRequest(BaseModel):
    instance_id: UUID
    field_id: UUID
    mode: str = Field(pattern="^(select_existing|manual_override)$")
    selected_decision_id: UUID | None = None
    value: dict[str, Any] | None = None
    rationale: str | None = None

    @field_validator("value")
    @classmethod
    def _reject_server_owned_verification(cls, v: dict[str, Any] | None) -> dict[str, Any] | None:
        return _reject_client_verification("value", v)


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
    default of 1). ``reviewers_ready`` is blind-gated (ADR-0012): it carries only
    the caller's own entry unless the caller is unblinded — the counts stay
    aggregate."""

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
    # ADR-0016 disposition flags; default False for pre-0038 snapshots.
    allows_not_applicable: bool = False
    allows_not_evaluated: bool = False
    # 0062, and the default is deliberately the OTHER way: a pre-0062 snapshot
    # carries no key and the marker was universal in that era, so absent means
    # available. False here would retro-disable it on every frozen snapshot.
    allows_no_information: bool = True


class RunViewEntityType(BaseModel):
    """An entity type in the frozen template snapshot, with its fields embedded.
    ``role`` drives the study/model partition; the tree hierarchy is conveyed by
    ``parent_entity_type_id`` (flat array, ordered by ``sort_order``)."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    label: str
    description: str | None = None
    # Group entry noun (B-8); pre-B-8 snapshots lack the key -> None and
    # consumers fall back to "model".
    entry_label: str | None = None
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


class RunViewDerivedInput(BaseModel):
    """One input feeding a derived judgment, as the rule consumed it.

    ``value`` is the display value: the judgment for a ``worst_domain`` row,
    the reviewer's RAW answer ("PN", a marker label) for a ``signaling_worst``
    row, None when unjudged/unanswered — which is exactly why the derived
    value shows a dash, so the client can name the blocking input instead of
    leaving the reviewer to hunt for it. ``contribution`` is uniformly the
    Low/High/Unclear the rule consumed from this row (None when it
    contributed nothing) — clients highlight and color by it with zero
    answer-mapping knowledge.

    ``state`` is set on a row that contributed nothing, and is the complement
    of ``contribution`` (never both). On a collapse-group row it is
    ``"unreported"`` when the study did not report that performance type — a
    legitimate outcome, not a gap — and ``"in-progress"`` when the group is
    only half-answered. A group has no stored answer, so ``value`` is always
    None there and this is the only thing telling the two apart: render them
    with different copy and tone, or a complete assessment looks unfinished.

    ``"out-of-scope"`` is the third value and the only one a PLAIN row carries:
    the template's scope rules took that section out of play for this study
    type, so there is nothing to answer and nothing to chase. It outranks the
    other two — render it as "Not applicable", never as unfinished work.
    """

    label: str
    value: str | None = None
    contribution: str | None = None
    state: str | None = None


class RunViewDerivedJudgment(BaseModel):
    """One computed judgment (never stored, never entered).

    Present only for templates whose ``schema`` JSONB declares a
    ``derived_judgments`` spec. Entries WITH ``target_field_id`` are
    RECOMMENDATIONS: the derived default for the assessor-owned stored field
    the ids point at (resolved against the run's frozen tree; None when the
    spec coordinate does not resolve). Entries without one are computed
    OVERALLS, whose paired Step-4 narrative field is ``summary_field_id``.
    ``value`` is None when the inputs are incomplete — the client renders
    that as an em dash, never as the most favourable judgment.

    ``rationale_required`` is True when the STORED judgment at
    ``target_field_id`` overrides ``value`` and ``rationale_field_id`` is
    still empty — the same rule, from the same code, that refuses the
    finalize (``DivergenceRationaleError``). It is computed over whatever
    value set the caller derived from, so on the reviewer's form it means
    "your answer owes an explanation" and at consensus "this run cannot
    finalize yet". The client must never recompute it: a second
    implementation is how the screen and the refusal come to disagree.
    """

    id: str
    label: str
    value: str | None = None
    rationale_required: bool = False
    inputs: list[RunViewDerivedInput] = Field(default_factory=list)
    target_entity_type_id: UUID | None = None
    target_field_id: UUID | None = None
    rationale_field_id: UUID | None = None
    summary_field_id: UUID | None = None


class RunViewResponse(RunDetailResponse):
    """``RunDetailResponse`` (run + blind-filtered workflow rows) plus the three
    pieces the run-open form needs server-side: the frozen entity_types tree,
    the caller's current_values, and the instances for the run's
    (article_id, template_id) scope."""

    entity_types: list[RunViewEntityType]
    current_values: list[RunViewCurrentValue]
    instances: list[RunViewInstance]
    # Per-reviewer "ready" hint (advisory; see RunReadyStateResponse).
    # reviewers_ready is blind-gated on peers_revealed: a blind caller gets
    # only their own entry (enough for the Mark-ready self-check), never peer
    # ids; the counts stay aggregate.
    ready_count: int = 0
    reviewer_count: int = 0
    reviewers_ready: list[UUID] = Field(default_factory=list)
    # Computed overalls (worst-domain over the domain judgments). Empty for
    # templates that declare no derivation spec — i.e. everything except
    # PROBAST+AI today.
    derived_judgments: list[RunViewDerivedJudgment] = Field(default_factory=list)
    # The template-level instruction this run is PINNED to — read through the
    # same helper the AI prompts call, so the screen can never show a text the
    # model did not get. Kind-neutral (extraction runs carry the pin too);
    # None when the pinned version declares none.
    general_instructions: str | None = None
    # The project's review question this run is PINNED to. Its sibling above
    # exists so the screen can never show a text the model did not get — and
    # both blocks reach every prompt, so shipping only one of them would make
    # this response lie by omission. None when no AI call has run yet, or when
    # the review says nothing.
    review_context: str | None = None


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
