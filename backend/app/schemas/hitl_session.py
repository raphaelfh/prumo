"""Schemas for the HITL session and project-template management endpoints."""

from datetime import datetime
from enum import StrEnum
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field, model_validator

# The diff vocabulary lives in app.domain rather than the diff engine: the
# wire model below references those enums rather than restating them, so the
# generated client's unions cannot drift from the engine's, and importing
# from app.domain (not app.services) means this schema module cannot form a
# package-level cycle with the six services that import this one.
from app.domain.template_change import (
    ChangeTier,
    ChangeVariant,
    DiffStatus,
    OpaqueValueState,
)

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


class TemplateChangeAck(BaseModel):
    """One destructive row the manager ticked, as ``(id, tier)`` (B-9b2b).

    The tier travels WITH the id on purpose. It is deliberately not part of
    the composite row id (``template_diff_read._row_id``), so an ack whose
    tier no longer matches the server's recomputed row reads as *absent*
    rather than as a match — which is exactly right, because a reviewer
    recording an answer can escalate a row to DESTRUCTIVE without anyone
    touching the template."""

    id: str = Field(max_length=200)
    """A composite row id — five ``:``-joined components, the longest a
    UUID. Bounded because it arrives from the client and is only ever
    compared against server-computed ids."""
    tier: ChangeTier


class RepublishTemplateVersionRequest(BaseModel):
    """What the Publish button submits (B-9b2b).

    A REQUIRED body even though every field is optional, matching
    ``DiscardDraftRequest``: the endpoint is the untrusted surface, and an
    optional body would let a bodyless POST skip the whole contract. With
    the fields defaulted, a bodyless POST is a 422 rather than a silent
    unchecked publish."""

    expected_fingerprint: str | None = Field(default=None, max_length=64)
    """The ``fingerprint`` from the diff the manager was looking at.

    Bounded to the exact width of a sha256 hex digest: it is only ever
    compared for equality against one, so anything longer is noise the
    server should refuse before it reaches the publish locks.

    Nullable rather than required because two of the three diff statuses
    carry none: a template that never published (``initial_version``) and
    one whose baseline predates the wide snapshot (``baseline_too_old``).
    The server refuses a ``None`` when its own under-lock recompute says
    ``available`` — that is the case where the client should have had one."""

    acknowledged: list[TemplateChangeAck] = Field(default_factory=list, max_length=500)
    """Every DESTRUCTIVE row the manager ticked. Checked against the diff
    the server recomputes under its locks, never against the client's view,
    so an empty list refuses rather than skipping the check."""

    note: str | None = Field(default=None, max_length=2000)
    """Optional prose recorded on the new version (History renders it).

    Recorded only when the publish actually spawns a version. A draft whose
    edits cancel out (A->B->A) still clears its marker, but has no new row
    for a note to land on, and rewriting the current row's note would
    attribute prose to a version someone else published. The response's
    ``changed=False`` is the signal that this happened — the sheet says so
    rather than swallowing what the manager typed."""


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


class TemplateVersionHistoryEntry(BaseModel):
    """One published version, as the History timeline renders it (B-9e).

    Carries no ``schema`` payload: the timeline shows WHAT happened and WHO
    did it, and shipping every snapshot would put the whole template
    structure on the wire once per version for a list nobody diffs inline.
    """

    version_id: UUID
    version: int
    is_active: bool
    published_at: datetime
    published_by: UUID
    published_by_name: str | None = None
    """Resolved display name, or ``None`` when the profile has none — a raw
    uuid must never reach the screen as a stand-in for a person."""
    note: str | None = None
    """Why this version was published, in the publisher's words (0052)."""
    pinned_run_count: int
    """Runs still pinned to this version. ``ExtractionRun.version_id`` is ON
    DELETE RESTRICT, so a non-zero count means the version is permanent —
    which is exactly what a manager needs to see before restoring an old
    shape over it."""


class TemplateVersionHistoryRead(BaseModel):
    """The History card's read model — newest version first.

    An empty list is a real, renderable state (a template that never
    published), not an error."""

    project_template_id: UUID
    versions: list[TemplateVersionHistoryEntry] = Field(default_factory=list)


class RestoreVersionResponse(BaseModel):
    """What a Restore-vN staged (B-9e).

    ``changed`` is False when the version's shape already matched the live
    tree: the writer touched no rows, so no draft marker was stamped and
    Publish stays disabled. The sheet says so rather than claiming a
    restore that the UI cannot act on."""

    version: int
    changed: bool
    created_entity_types: int
    created_fields: int
    deleted_entity_types: int
    deleted_fields: int
    updated_entity_types: int
    updated_fields: int
    kept_count: int
    """Nodes the restore could NOT undo — they hold recorded work, so the
    staged tree keeps them regardless of the version's shape."""


class TakeOverDraftLockResponse(BaseModel):
    """Who was displaced by a take-over (B-9f), so the UI can say whose
    draft was taken. Both ``None`` when nobody held it."""

    previous_holder_id: str | None = None
    previous_holder_name: str | None = None


class TemplateDraftLockRefusalCode(StrEnum):
    """Why a config write was refused by the advisory editor lock (B-9f).

    Slice-local, like its two siblings: this is one surface's outcome, not
    part of the cross-cutting ``ApiErrorCode`` vocabulary."""

    DRAFT_LOCK_HELD = "DRAFT_LOCK_HELD"


class TemplateDraftLockRefusalDetails(BaseModel):
    """Who holds the draft, so "Take over" is not a blind click."""

    holder_id: str | None = None
    """A STRING: ``app_error_handler`` renders ``details`` through a bare
    JSONResponse, so a raw UUID would raise inside the handler and turn the
    refusal into a 500 (the B-9c1 precedent)."""
    holder_name: str | None = None
    """``None`` when the profile has no name, or when the draft is
    unattributed — never the raw id as a stand-in."""


class TemplateDraftLockRefusalError(BaseModel):
    code: TemplateDraftLockRefusalCode
    message: str
    details: TemplateDraftLockRefusalDetails | None = None


class TemplateDraftLockRefusalResponse(BaseModel):
    """The 409 body, declared so the generated client types the holder."""

    ok: bool = False
    error: TemplateDraftLockRefusalError
    trace_id: str | None = None


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
    PUBLISH_DIFF_DRIFTED = "PUBLISH_DIFF_DRIFTED"
    """The projection moved under the manager (B-9b2b). Recoverable by
    re-rendering the sheet — ``details.fingerprint`` carries the fresh value
    so the client needs no second round trip. Also returned when the client
    sent no fingerprint at all for a diff the server can compute: that is
    the same situation, a sheet the manager never saw."""
    PUBLISH_MISSING_ACKNOWLEDGEMENT = "PUBLISH_MISSING_ACKNOWLEDGEMENT"
    """A DESTRUCTIVE row was not ticked (B-9b2b). ``details.row_ids`` names
    every one, sorted by composite id, so the sheet marks them all in one
    pass instead of surfacing the next on each retry."""


class TemplatePublishRefusalDetails(BaseModel):
    """The ``error.details`` payload of a publish refusal (B-9b0 D2).

    EVERY offending section, ordered by ``sort_order`` — never a single
    ``section_label``: the un-ordered select behind it raised on the first
    heap row, so one name out of several was reported at random and the
    manager had to publish-read-fix-publish to find the rest.

    One model across all three codes rather than a discriminated union: the
    generated client already branches on ``code``, and three near-empty
    payload models would buy nothing but three more names."""

    section_labels: list[str] = Field(default_factory=list)
    row_ids: list[str] = Field(default_factory=list)
    """Every unacknowledged DESTRUCTIVE row, for
    ``PUBLISH_MISSING_ACKNOWLEDGEMENT``. Composite ids, not labels: the
    client keys its checkboxes by exactly these."""
    fingerprint: str | None = None
    """The server's freshly computed fingerprint, for
    ``PUBLISH_DIFF_DRIFTED`` — what the manager should have been looking
    at."""


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
    draft_holder_id: str | None = None
    """Who holds the advisory editor lock (B-9f), or ``None``.

    A string, matching the refusal payload. ``None`` while a draft is open
    means UNATTRIBUTED — a draft from before 0053, or a raw PostgREST
    write from before 0054 revoked that grant — and is claimable by the
    next writer, so the chip renders a nameless variant rather than
    inventing an owner."""
    draft_holder_name: str | None = None
    is_draft_holder: bool = False
    """Whether the CALLER holds it. Derived server-side so the chip never
    has to compare ids, and so "Take over" is offered only when there is
    someone to take over from."""


class TemplateChangeRowRead(BaseModel):
    """One diff row on the wire, built by ``app.services.template_diff_read``.

    Nothing here is typed ``Any``: the baseline side of a diff is raw stored
    JSONB, and an opaque value is summarized server-side rather than
    shipped."""

    id: str
    """``kind:node_kind:node_id:attribute:option_code`` — content-derived and
    stable across runs, so a client can key rows by it."""
    variant: ChangeVariant
    """The row's discriminator (D1) — tells the client which shape it got."""
    tier: ChangeTier
    label_path: list[str]
    """Section → field labels for display; empty for the template instruction."""
    attribute: str | None = None
    """The changed key, or ``None`` for a row with no single attribute (a
    section add/remove, a field move, or a reorder)."""
    before: str | bool | None = None
    """The prior display value. ``None`` for an added row or a reorder."""
    after: str | bool | None = None
    """The new display value. ``None`` for a removed row or a reorder."""
    before_opaque_state: OpaqueValueState | None = None
    """Set instead of ``before`` when the prior value is an opaque blob or id
    with no listable content — the copy layer renders the word (D3). ``None``
    means the value slot carries the answer, absent value included."""
    after_opaque_state: OpaqueValueState | None = None
    """The ``after`` side of :attr:`before_opaque_state`."""
    reorder_count: int | None = None
    """Sibling count for a reorder row, pulled out of the engine's overloaded
    ``after``. ``None`` for every other row.

    The two reorder variants count **different populations** and the copy
    layer must not write one sentence for both: a section's count
    (``ENTITY_TYPE_FIELDS_REORDERED``) EXCLUDES fields added in the same diff
    — the engine's ``after_seq`` keeps only ids that also existed under the
    same parent in the baseline (``template_diff._diff_field_order``). A
    field's option count (``FIELD_OPTIONS_REORDERED``) INCLUDES options added
    in the same diff — the engine reports ``len(new)`` over the full new
    option list (``template_diff._diff_options``)."""
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

    ``status`` names which of :class:`~app.domain.template_change.DiffStatus`'s
    three shapes this is; all three are HTTP 200, because an un-diffable
    template is a state the sheet explains rather than an error. Only
    ``available`` carries rows — the other two leave the buckets at their
    empty default."""

    project_template_id: UUID
    status: DiffStatus
    changes: TemplateConfigDiffBuckets = Field(default_factory=TemplateConfigDiffBuckets)
    fingerprint: str | None = None
    """What the client is looking at, hashed (B-9b2b).

    Sent back on Publish so the server can refuse when the projection moved
    under the manager — a concurrent publish, or a reviewer recording an
    answer that escalates a tier without touching the template. ``None`` for
    the two non-``available`` statuses: they carry no rows, so there is
    nothing to acknowledge and nothing to drift.

    Opaque to the client: it is produced and compared server-side only
    (``template_diff_read.fingerprint``), never re-derived on the wire."""


class TemplateActiveVersionRead(BaseModel):
    """The template's ACTIVE version tree — what the worklist/dashboard
    progress and exports render from (B-3a). Never an empty stand-in for a
    missing active version: that case is a typed 404."""

    version_id: UUID
    version: int
    entity_types: list[RunViewEntityType]
