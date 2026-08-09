"""Schemas for the HITL session and project-template management endpoints."""

from enum import StrEnum
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator

# The diff vocabulary lives in app.domain rather than the diff engine: the
# wire model below references those enums rather than restating them, so the
# generated client's unions cannot drift from the engine's, and importing
# from app.domain (not app.services) means this schema module cannot form a
# package-level cycle with the six services that import this one.
from app.domain.template_change import ChangeTier, ChangeVariant

# Re-export TemplateKind so endpoints can convert request.kind into the
# canonical enum value without importing directly from app.models.* —
# enforced by scripts/fitness/check_layered_arch.py.
from app.models.extraction_versioning import TemplateKind  # noqa: E402,F401
from app.schemas.extraction_run import RunViewEntityType, RunViewResponse


class OpenHITLSessionRequest(BaseModel):
    kind: Literal["extraction", "quality_assessment"]
    project_id: UUID
    article_id: UUID
    project_template_id: UUID | None = None
    global_template_id: UUID | None = None

    @model_validator(mode="after")
    def _require_one_template_pointer(self) -> "OpenHITLSessionRequest":
        if self.project_template_id is None and self.global_template_id is None:
            raise ValueError("Either project_template_id or global_template_id must be provided")
        return self


class OpenHITLSessionResponse(BaseModel):
    run_id: UUID
    kind: Literal["extraction", "quality_assessment"]
    project_template_id: UUID
    instances_by_entity_type: dict[str, str]
    # Embedded run-open view (both kinds). Lets the client render from a single
    # round-trip instead of session -> GET /runs/{id} -> values. Carries the
    # server-blinded reviewer decisions both surfaces feed into the shared
    # compare view (ADR 0012). Optional only for resilience if the view fails
    # to build.
    run_view: RunViewResponse | None = None


class CloneTemplateRequest(BaseModel):
    global_template_id: UUID
    kind: Literal["extraction", "quality_assessment"]


class CloneTemplateResponse(BaseModel):
    project_template_id: UUID
    version_id: UUID
    entity_type_count: int
    field_count: int
    created: bool


class RepublishTemplateVersionResponse(BaseModel):
    version_id: UUID
    version: int
    changed: bool
    repinned_run_count: int


class DiscardDraftRequest(BaseModel):
    acknowledge_orphans: bool = False
    """Confirms the caller saw the 409 listing the recorded values this
    Discard will orphan or re-interpret (B-9c1 D6). Never defaulted true:
    the first POST is the question, the second is the answer."""


class DiscardKeptNode(BaseModel):
    """One node Discard could NOT undo, and why (B-9c1 D4).

    Either deleting it would break a RESTRICT reference to real run data, or
    restoring it would collide with something that does — so the draft
    shrinks around it instead of failing wholesale."""

    node_id: UUID
    node_kind: Literal["entity_type", "field"]
    label: str
    reason: Literal["has_recorded_data", "related_to_kept_node", "name_taken_by_kept_node"]
    """``has_recorded_data`` — this node itself owns extraction instances or
    is referenced by the review workflow. ``related_to_kept_node`` — it is
    an ancestor or a subtree member of one that does, and deleting it would
    cascade that node away. ``name_taken_by_kept_node`` — a PUBLISHED field
    that stayed as the draft left it because a kept field holds its name in
    that section (the per-section unique index is immediate); rename the
    kept field and discard again to get it back."""


class DiscardDraftResponse(BaseModel):
    """What Discard actually undid (B-9c1 D11). No diff payload — B-9b owns
    that shape."""

    project_template_id: UUID
    draft_was_open: bool
    """Whether the marker was set when the request arrived. ``False`` is a
    real, supported case: a template whose live rows drifted from its
    published version with no marker (a lost republish) is repairable."""
    created_entity_types: int
    deleted_entity_types: int
    updated_entity_types: int
    created_fields: int
    deleted_fields: int
    updated_fields: int
    instruction_reset: bool
    kept: list[DiscardKeptNode]
    """Non-empty ⇒ the template is STILL in draft: the marker is only
    cleared when the live tree matches the published version exactly."""


class TemplateDiscardRefusalCode(StrEnum):
    """Why ``POST .../discard-draft`` returned 409 (B-9c2 D1).

    Deliberately NOT part of :class:`app.schemas.common.ApiErrorCode`: that
    enum is the cross-cutting vocabulary every client branches on, and these
    five are one endpoint's private outcomes. Same call as
    ``ExtractionErrorCode`` — slice-local codes stay slice-local, so the
    global contract does not grow a member per feature.

    The split that matters to the caller: ``ORPHAN_ACK_REQUIRED`` is a
    *question* (re-post with ``acknowledge_orphans``), the other four are
    refusals no retry of the same request can satisfy.
    """

    ORPHAN_ACK_REQUIRED = "ORPHAN_ACK_REQUIRED"
    NARROW_BASELINE = "NARROW_BASELINE"
    CARDINALITY_DOWNGRADE_BLOCKED = "CARDINALITY_DOWNGRADE_BLOCKED"
    CONTAINER_SWAP_UNSUPPORTED = "CONTAINER_SWAP_UNSUPPORTED"
    DISCARD_RACED = "DISCARD_RACED"


class TemplateDiscardRefusalOrphan(BaseModel):
    """One field whose recorded answers the Discard would strand."""

    node_id: str | None
    """The field id as a STRING: ``app_error_handler`` renders ``details``
    through a bare ``JSONResponse``, so a raw ``UUID`` would raise inside
    the handler and turn the refusal into a 500."""
    label: str
    """Section → field, already human-readable — no id reaches the screen."""


class TemplateDiscardRefusalDetails(BaseModel):
    """The ``error.details`` payload of an ``ORPHAN_ACK_REQUIRED`` refusal.

    One entry per FIELD: ``allowed_values`` is diffed per option code, so a
    field losing two recorded options is two changes and one orphan."""

    orphans: list[TemplateDiscardRefusalOrphan] = Field(default_factory=list)


class TemplateDiscardRefusalError(BaseModel):
    code: TemplateDiscardRefusalCode
    message: str
    details: TemplateDiscardRefusalDetails | None = None


class TemplateDiscardRefusalResponse(BaseModel):
    """The 409 body, declared so the payload reaches ``schema.d.ts`` typed.

    Documents what ``app_error_handler`` actually writes — ``details`` under
    ``error``, never a ``data`` slot. Without this the generated client sees
    ``ErrorDetail.details: dict[str, Any] | None`` and types the orphan list
    as ``unknown``."""

    ok: bool = False
    error: TemplateDiscardRefusalError
    trace_id: str | None = None


class TemplatePublishRefusalCode(StrEnum):
    """Why ``POST .../republish-version`` returned 409 (B-9b0 D1).

    Deliberately NOT part of :class:`app.schemas.common.ApiErrorCode`, for
    the same reason as :class:`TemplateDiscardRefusalCode`: that enum is the
    cross-cutting vocabulary every client branches on, and this is one
    endpoint's private outcome. Slice-local codes stay slice-local so the
    global contract does not grow a member per feature.

    One member today, and an enum rather than a bare literal so the
    generated client already branches on a closed set — Publish has exactly
    one refusal that can reach it (``PendingConfigDraftError`` fires only
    under ``fail_if_pending_draft``, which only the clone service passes).
    """

    PUBLISH_BLOCKED_BY_MULTI_ENTRY = "PUBLISH_BLOCKED_BY_MULTI_ENTRY"


class TemplatePublishRefusalDetails(BaseModel):
    """The ``error.details`` payload of a publish refusal (B-9b0 D2).

    EVERY offending section, ordered by ``sort_order`` — never a single
    ``section_label``: the un-ordered select behind it raised on the first
    heap row, so one name out of several was reported at random and the
    manager had to publish-read-fix-publish to find the rest."""

    section_labels: list[str] = Field(default_factory=list)


class TemplatePublishRefusalError(BaseModel):
    code: TemplatePublishRefusalCode
    message: str
    details: TemplatePublishRefusalDetails | None = None


class TemplatePublishRefusalResponse(BaseModel):
    """The 409 body, declared so the payload reaches ``schema.d.ts`` typed.

    Documents what ``app_error_handler`` actually writes — ``details`` under
    ``error``, never a ``data`` slot, so this is NOT an ``ApiResponse[T]``.
    Without it the generated client sees ``ErrorDetail.details:
    dict[str, Any] | None`` and types the labels as ``unknown``."""

    ok: bool = False
    error: TemplatePublishRefusalError
    trace_id: str | None = None


class UpdateTemplateActiveRequest(BaseModel):
    is_active: bool


class UpdateTemplateActiveResponse(BaseModel):
    project_template_id: UUID
    is_active: bool


class TemplateInstructionRead(BaseModel):
    project_template_id: UUID
    llm_template_instruction: str | None
    default_instruction: str | None
    """The origin global template's instruction (None for custom templates)."""


class UpdateTemplateInstructionRequest(BaseModel):
    llm_template_instruction: str | None = Field(default=None, max_length=4000)


class UpdateTemplateInstructionResponse(BaseModel):
    """B-4: the PUT stages a draft edit — no version fields (nothing
    republishes until the explicit Publish)."""

    project_template_id: UUID
    llm_template_instruction: str | None


class TemplateConfigStatusRead(BaseModel):
    """Draft/publish status for the Configuration tab (slice B-4).

    ``has_pending_changes`` mirrors the trigger-stamped
    ``config_draft_since``; ``active_version`` is None only for a
    template that never published (legacy shapes)."""

    project_template_id: UUID
    has_pending_changes: bool
    active_version: int | None
    pending_change_count: int | None = None
    """How many changes the open draft carries (B-9a), or None when that
    is unknowable: no draft, no published baseline, or a pre-0026 narrow
    snapshot. ``0`` is a real value — a marker-set-but-identical tree
    (A→B→A) still needs a Publish to clear the marker.

    Shares ``discard_available``'s restorability gate since B-9c2 D2, so
    ``discard_available and has_pending_changes`` ⇒ this is an int."""
    discard_available: bool = False
    """Whether ``POST .../discard-draft`` can run at all (B-9c1 D12), so the
    button is disabled with the right tooltip instead of discovering the
    refusal by clicking. False without a published baseline, and false for a
    pre-0026 narrow one (restoring it would wipe columns project-wide)."""


class TemplateDiffUnavailableReason(StrEnum):
    """Why a config diff could not be computed (slice B-9b2a D9).

    One member, and an enum rather than a bare literal so the generated
    client already branches on a closed set. The OTHER unavailable shape —
    a template that never published — is named by ``initial_version``
    instead, because the sheet renders it as its own first-publish state
    rather than as a failure to compare."""

    BASELINE_TOO_OLD = "baseline_too_old"


class TemplateChangeRowRead(BaseModel):
    """One diff row on the wire — the read model's ``TemplateChangeRow``.

    Mirrors ``app.services.template_diff_read.TemplateChangeRow`` field for
    field (``from_attributes`` copies it straight across). Nothing here is
    typed ``Any``: the baseline side of a diff is raw stored JSONB, and an
    opaque value is summarized server-side rather than shipped."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    """``kind:node_kind:node_id:attribute:option_code`` — content-derived and
    stable across runs, so a client can key rows by it."""
    variant: ChangeVariant
    tier: ChangeTier
    label_path: list[str]
    attribute: str | None = None
    before: str | bool | None = None
    after: str | bool | None = None
    reorder_count: int | None = None
    affects_recorded_data: bool = False
    """Whether this row touches work a human or the AI already recorded.
    Field-derived: a section answers from the fields it owns, and a REMOVED
    node is always false (every workflow ``field_id`` FK is RESTRICT, so the
    delete would have been refused)."""


class TemplateConfigDiffBuckets(BaseModel):
    """The rows grouped by severity tier — one field per ``ChangeTier``.

    Named fields rather than a map keyed by the enum, so the generated
    client gets four exhaustive keys instead of an open ``Record``. A unit
    test pins the field names to the enum's values, because a client that
    buckets by ``row.tier`` has to find a bucket under that exact name."""

    additive: list[TemplateChangeRowRead] = Field(default_factory=list)
    cosmetic: list[TemplateChangeRowRead] = Field(default_factory=list)
    semantic: list[TemplateChangeRowRead] = Field(default_factory=list)
    destructive: list[TemplateChangeRowRead] = Field(default_factory=list)


class TemplateConfigDiffRead(BaseModel):
    """What the open draft would publish (slice B-9b2a).

    Three shapes, all HTTP 200 — an un-diffable template is a state the
    sheet explains, not an error:

    * ``diff_available`` — the ordinary computed diff;
    * ``initial_version`` — nothing published yet, so there is no baseline
      to compare against and every node is new by definition;
    * ``unavailable_reason`` — a baseline the diff engine cannot be trusted
      with (see :class:`TemplateDiffUnavailableReason`).

    ``diff_available is False`` therefore implies exactly one of
    ``initial_version`` or ``unavailable_reason``, and the buckets are
    empty: a shape that cannot diff must not ship rows."""

    project_template_id: UUID
    diff_available: bool
    unavailable_reason: TemplateDiffUnavailableReason | None = None
    initial_version: bool = False
    changes: TemplateConfigDiffBuckets = Field(default_factory=TemplateConfigDiffBuckets)


class TemplateActiveVersionRead(BaseModel):
    """The template's ACTIVE version tree — what the worklist/dashboard
    progress and exports render from (B-3a). Never an empty stand-in for a
    missing active version: that case is a typed 404."""

    version_id: UUID
    version: int
    entity_types: list[RunViewEntityType]
