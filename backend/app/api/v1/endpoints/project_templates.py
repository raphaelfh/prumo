"""Project-scoped template management endpoints.

* ``POST /api/v1/projects/{project_id}/templates/clone`` — clone a global
  template (CHARMS, PROBAST, QUADAS-2, …) into the project. Idempotent on
  ``(project_id, global_template_id)``. Creates entity types, fields, and
  an active ``extraction_template_versions`` row in one transaction; may
  rebuild an empty legacy clone. Used by the extraction import dialog and
  by configuration flows that enable QA tools.
* ``PATCH /api/v1/projects/{project_id}/templates/{template_id}`` — toggle
  ``is_active`` (e.g. disable a QA tool in Configuration).
* ``POST /api/v1/projects/{project_id}/templates/{template_id}/republish-version``
  — publish the live section/field structure as a new active
  ``extraction_template_versions`` row. Since slice B-4 this is the
  explicit Publish button's endpoint: config edits (still PostgREST)
  only stamp the draft marker, and article forms — which render from
  the run's version snapshot — pick them up at Publish.
* ``POST /api/v1/projects/{project_id}/templates/{template_id}/discard-draft``
  — Publish's inverse (slice B-9c1): write the active version's snapshot
  back over the live rows and clear the marker. Partial by construction —
  nodes the review workflow already references are kept and reported.

* ``GET /api/v1/projects/{project_id}/templates/{template_id}/export`` —
  the template's LIVE structure as a ``prumo-template@1`` document.
* ``POST /api/v1/projects/{project_id}/templates/import`` — a NEW active
  project template from such a document (same response as clone).
* ``DELETE /api/v1/projects/{project_id}/templates/{template_id}`` —
  inactive, unreferenced templates only (typed 409s otherwise).

These are project-scoped. ``POST /api/v1/hitl/sessions`` is per-article run
lifecycle and is separate.
"""

from typing import Any
from uuid import UUID

from fastapi import APIRouter, Body, Depends, HTTPException, Request, status

from app.api.deps.security import require_project_manager, require_project_scope
from app.core.deps import DbSession
from app.schemas.common import ApiResponse
from app.schemas.hitl_session import (
    CloneTemplateRequest,
    CloneTemplateResponse,
    DiscardDraftRequest,
    DiscardDraftResponse,
    RepublishTemplateVersionRequest,
    RepublishTemplateVersionResponse,
    RestoreVersionResponse,
    TakeOverDraftLockResponse,
    TemplateActiveVersionRead,
    TemplateConfigDiffRead,
    TemplateConfigStatusRead,
    TemplateDeleteRefusalResponse,
    TemplateDeleteResponse,
    TemplateDiscardRefusalResponse,
    TemplateDraftLockRefusalResponse,
    TemplateInstructionRead,
    TemplateKind,
    TemplatePortableRefusalResponse,
    TemplatePublishRefusalResponse,
    TemplateVersionHistoryRead,
    UpdateTemplateActiveRequest,
    UpdateTemplateActiveResponse,
    UpdateTemplateInstructionRequest,
    UpdateTemplateInstructionResponse,
)
from app.schemas.template_portable import PortableTemplate
from app.services.project_template_active_service import (
    LastActiveExtractionTemplateError,
    ProjectTemplateNotFoundError,
    set_template_active,
)
from app.services.template_clone_service import (
    PendingConfigDraftError,
    TemplateCloneService,
    TemplateNotFoundError,
)
from app.services.template_delete_service import delete_template
from app.services.template_discard_service import discard_draft
from app.services.template_draft_lock_service import take_over_draft_lock
from app.services.template_instruction_service import (
    get_template_instruction,
    set_template_instruction,
)
from app.services.template_portable_service import (
    import_portable,
    parse_portable_document,
    to_portable,
)
from app.services.template_restore_version_service import (
    VersionNotFoundError,
    restore_version,
)
from app.services.template_version_read_service import (
    NoActiveTemplateVersionError,
    get_active_version_tree,
    get_template_config_diff,
    get_template_config_status,
    get_template_version_history,
)
from app.services.template_version_service import (
    PublishBlockedByMultiEntryError,
    TemplateVersionService,
)
from app.utils.rate_limiter import limiter

router = APIRouter()


@router.post(
    "/{project_id}/templates/clone",
    status_code=status.HTTP_201_CREATED,
)
async def clone_template_into_project(
    project_id: UUID,
    body: CloneTemplateRequest,
    request: Request,
    db: DbSession,
    current_user_sub: UUID = Depends(require_project_manager),
) -> ApiResponse[CloneTemplateResponse]:
    """Clone a global template into the project (idempotent).

    Restricted to project managers — cloning materializes new rows in
    ``project_extraction_templates`` and ``extraction_template_versions``,
    which is project-wide configuration, matching the PATCH endpoint below.
    """
    service = TemplateCloneService(db)
    try:
        result = await service.clone(
            project_id=project_id,
            global_template_id=body.global_template_id,
            user_id=current_user_sub,
            kind=TemplateKind(body.kind),
        )
    except TemplateNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except PendingConfigDraftError as e:
        # B-4: re-importing over a pending draft would silently publish
        # it via the drift heal — refuse; Publish (or factory-restore by
        # deleting everything) is the exit.
        raise HTTPException(status_code=409, detail=str(e)) from e
    except PublishBlockedByMultiEntryError as e:
        # B-8 review: the drift-heal republish inside clone re-checks the
        # many->one cardinality rule; refuse like the pending-draft case.
        #
        # B-9b0 D3: kept ON PURPOSE, even though ``republish-version`` now
        # lets this very error through typed. Clone has no client branching on
        # the code, so here it stays a flat ``HTTP_ERROR`` 409. The asymmetry
        # (same domain error, two renderings) is accepted, not an oversight —
        # don't "fix" it until the import dialog actually needs the labels.
        raise HTTPException(status_code=409, detail=str(e)) from e
    await db.commit()
    return ApiResponse.success(
        CloneTemplateResponse(
            project_template_id=result.project_template_id,
            version_id=result.version_id,
            entity_type_count=result.entity_type_count,
            field_count=result.field_count,
            created=result.created,
        ),
        trace_id=getattr(request.state, "trace_id", None),
    )


@router.patch(
    "/{project_id}/templates/{template_id}",
)
async def update_project_template_active(
    project_id: UUID,
    template_id: UUID,
    body: UpdateTemplateActiveRequest,
    request: Request,
    db: DbSession,
    _user_sub: UUID = Depends(require_project_manager),
) -> ApiResponse[UpdateTemplateActiveResponse]:
    """Toggle ``is_active`` on a project template.

    Disabling an extraction template that is the project's only active
    extraction template returns 400 — see service for the invariant.
    """
    try:
        result = await set_template_active(
            db,
            project_id=project_id,
            template_id=template_id,
            is_active=body.is_active,
        )
    except ProjectTemplateNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except LastActiveExtractionTemplateError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    await db.commit()
    return ApiResponse.success(
        result,
        trace_id=getattr(request.state, "trace_id", None),
    )


@router.get(
    "/{project_id}/templates/{template_id}/export",
    # The file IS the document: defaults omitted, file keys (``type``,
    # ``required``) not attribute names. ``ok`` is a required envelope field
    # so it survives exclude_defaults; ``error``/``trace_id`` drop when None.
    response_model_exclude_defaults=True,
    responses={status.HTTP_422_UNPROCESSABLE_CONTENT: {"model": TemplatePortableRefusalResponse}},
)
@limiter.limit("30/minute")
async def export_project_template(
    project_id: UUID,
    template_id: UUID,
    request: Request,
    db: DbSession,
    _user_sub: UUID = Depends(require_project_manager),
) -> ApiResponse[PortableTemplate]:
    """Export the template's LIVE structure as a ``prumo-template@1`` document.

    Extraction templates only (a QA id 404s). Reads no draft state and takes
    no locks — the pending-draft confirmation is the frontend's (it already
    holds ``config-status``). The frontend writes ``data`` to disk, never the
    envelope. ``TemplateExportInvalidError`` (legacy rows the format cannot
    carry) is an ``AppError`` and reaches ``app_error_handler`` typed.
    """
    try:
        doc = await to_portable(db, project_id=project_id, template_id=template_id)
    except ProjectTemplateNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    return ApiResponse.success(doc, trace_id=getattr(request.state, "trace_id", None))


@router.post(
    "/{project_id}/templates/import",
    status_code=status.HTTP_201_CREATED,
    responses={status.HTTP_422_UNPROCESSABLE_CONTENT: {"model": TemplatePortableRefusalResponse}},
)
@limiter.limit("10/minute")
async def import_project_template(
    project_id: UUID,
    request: Request,
    db: DbSession,
    body: dict[str, Any] = Body(...),
    current_user_sub: UUID = Depends(require_project_manager),
) -> ApiResponse[CloneTemplateResponse]:
    """Import a ``prumo-template@1`` document as a NEW active project template.

    The body is deliberately untyped at the HTTP layer: there is no
    ``RequestValidationError`` handler, so a typed body would yield FastAPI's
    un-enveloped 422 — parsing in the service is what turns a bad file into
    the typed ``TemplatePortableRefusalCode`` 422s (declared above so the
    contract still reaches schema.d.ts; the document's own schema is the
    export response's ``PortableTemplate`` component). Same response shape
    as the catalogue clone. A concurrent activation race is a 409 CONFLICT.
    """
    doc = parse_portable_document(body)
    result = await import_portable(db, project_id=project_id, doc=doc, user_id=current_user_sub)
    await db.commit()
    return ApiResponse.success(result, trace_id=getattr(request.state, "trace_id", None))


@router.delete(
    "/{project_id}/templates/{template_id}",
    responses={status.HTTP_409_CONFLICT: {"model": TemplateDeleteRefusalResponse}},
)
@limiter.limit("10/minute")
async def delete_project_template(
    project_id: UUID,
    template_id: UUID,
    request: Request,
    db: DbSession,
    _user_sub: UUID = Depends(require_project_manager),
) -> ApiResponse[TemplateDeleteResponse]:
    """Delete an INACTIVE, unreferenced project template (spec §5.7).

    ``TemplateActiveError`` / ``TemplateInUseError`` are ``AppError``s and
    reach ``app_error_handler`` typed (``TemplateDeleteRefusalCode``).
    """
    try:
        result = await delete_template(db, project_id=project_id, template_id=template_id)
    except ProjectTemplateNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    await db.commit()
    return ApiResponse.success(result, trace_id=getattr(request.state, "trace_id", None))


@router.get(
    "/{project_id}/templates/{template_id}/llm-instruction",
)
async def get_template_llm_instruction(
    project_id: UUID,
    template_id: UUID,
    request: Request,
    db: DbSession,
    _user_sub: UUID = Depends(require_project_manager),
) -> ApiResponse[TemplateInstructionRead]:
    """Current general AI instruction + the origin global's default.

    Manager-gated like the sibling endpoints — the Configuration tab is
    the only consumer.
    """
    try:
        result = await get_template_instruction(db, project_id=project_id, template_id=template_id)
    except ProjectTemplateNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    return ApiResponse.success(
        result,
        trace_id=getattr(request.state, "trace_id", None),
    )


@router.put(
    "/{project_id}/templates/{template_id}/llm-instruction",
)
async def update_template_llm_instruction(
    project_id: UUID,
    template_id: UUID,
    body: UpdateTemplateInstructionRequest,
    request: Request,
    db: DbSession,
    _user_sub: UUID = Depends(require_project_manager),
) -> ApiResponse[UpdateTemplateInstructionResponse]:
    """Stage the instruction as a draft edit (slice B-4).

    Whitespace-only normalizes to NULL (nothing injected). Nothing
    republishes here — the text reaches snapshots, prompts and
    editable-stage runs when the manager presses Publish
    (``republish-version``).
    """
    try:
        result = await set_template_instruction(
            db,
            project_id=project_id,
            template_id=template_id,
            llm_template_instruction=body.llm_template_instruction,
        )
    except ProjectTemplateNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    await db.commit()
    return ApiResponse.success(
        result,
        trace_id=getattr(request.state, "trace_id", None),
    )


@router.post(
    "/{project_id}/templates/{template_id}/republish-version",
    # B-9b0 D1: the 409 body is a contract, not prose. Declared so the
    # generated client types ``error.details.section_labels`` instead of the
    # ``unknown`` that ``ErrorDetail.details: dict[str, Any]`` produces.
    responses={status.HTTP_409_CONFLICT: {"model": TemplatePublishRefusalResponse}},
)
# B-9b2b made a refused publish expensive: the contract re-check builds the
# whole snapshot and unions the five workflow tables WHILE holding the
# per-article advisory locks that also gate session-open and run creation.
# A manager looping deliberately-stale fingerprints would stall reviewers,
# so this joins the sibling write endpoints behind a limit.
@limiter.limit("10/minute")
async def republish_template_version(
    project_id: UUID,
    template_id: UUID,
    body: RepublishTemplateVersionRequest,
    request: Request,
    db: DbSession,
    current_user_sub: UUID = Depends(require_project_manager),
) -> ApiResponse[RepublishTemplateVersionResponse]:
    """Publish the live template structure as a new active version.

    Idempotent when nothing changed (returns the current active version
    without spawning rows). Runs still in an editable stage
    (``pending``/``extract``) are re-pinned to the new version so open
    article forms render the edit; runs from ``consensus`` on keep the
    version they were assessed under. Manager-gated like the sibling
    endpoints — section/field editing is project-wide configuration.

    The single 409 (B-9b0 D1) is the publish-time re-check of the many->one
    cardinality rule: ``error.code`` is a ``TemplatePublishRefusalCode`` and
    ``error.details.section_labels`` names EVERY offending section, ordered
    by ``sort_order``, so the Publish button composes its own sentence
    instead of echoing English prose — and the manager fixes all of them in
    one pass rather than rediscovering the next on each retry.
    """
    service = TemplateVersionService(db)
    try:
        result = await service.republish(
            project_id=project_id,
            project_template_id=template_id,
            user_id=current_user_sub,
            # Always True here, never inferred from what the body carried:
            # this is the untrusted surface, and the service defaults the
            # flag off only so the clone/restore callers stay unchanged.
            enforce_publish_contract=True,
            expected_fingerprint=body.expected_fingerprint,
            acknowledged=body.acknowledged,
            note=body.note,
        )
    except TemplateNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    # The publish-time many->one re-check (TOCTOU vs reviewers on the old
    # 'many' snapshot) raises ``PublishBlockedByMultiEntryError``, an
    # ``AppError`` since B-9b0 D1, and is deliberately NOT caught:
    # ``app_error_handler`` renders its ``TemplatePublishRefusalCode`` and the
    # offending section labels, both of which ``HTTPException(409, str(e))``
    # collapsed onto ``HTTP_ERROR`` with no ``details`` at all.
    # ``PendingConfigDraftError`` cannot reach here — ``republish`` raises it
    # only under ``fail_if_pending_draft=True``, passed from exactly one place
    # (``template_clone_service``), never from this endpoint.
    await db.commit()
    return ApiResponse.success(
        RepublishTemplateVersionResponse(
            version_id=result.version_id,
            version=result.version,
            changed=result.changed,
            repinned_run_count=result.repinned_run_count,
        ),
        trace_id=getattr(request.state, "trace_id", None),
    )


@router.post(
    "/{project_id}/templates/{template_id}/discard-draft",
    # B-9c2 D1: the 409 body is a contract, not prose. Declared so the
    # generated client types ``error.details.orphans`` instead of the
    # ``unknown`` that ``ErrorDetail.details: dict[str, Any]`` produces.
    responses={status.HTTP_409_CONFLICT: {"model": TemplateDiscardRefusalResponse}},
)
async def discard_template_draft(
    project_id: UUID,
    template_id: UUID,
    body: DiscardDraftRequest,
    request: Request,
    db: DbSession,
    current_user_sub: UUID = Depends(require_project_manager),
) -> ApiResponse[DiscardDraftResponse]:
    """Throw the unpublished config draft away, back to the active version.

    Partial by design (B-9c1 D4): a draft-added section that already owns
    extraction instances — or a draft-added field the review workflow
    references — cannot be deleted, so it is KEPT and reported in
    ``kept`` while the rest of the draft is undone. A PUBLISHED field whose
    per-section name a kept field took over is reported the same way
    (``name_taken_by_kept_node``): it stays as the draft left it, because
    ``uq_extraction_fields_entity_type_name`` is immediate and restoring it
    would abort the request instead of shrinking the draft. The draft marker
    survives whenever anything was kept.

    Refuses (409) when restoring would corrupt rather than merely fail: a
    ``many`` -> ``one`` cardinality downgrade under a multi-entry parent, a
    replaced model container, a pre-0026 "narrow" baseline (B-9x), and
    destructive changes to fields already holding values unless
    ``acknowledge_orphans`` is set. 404 when the template is foreign or has
    never published.

    Every 409 carries a ``TemplateDiscardRefusalCode`` in ``error.code``
    (B-9c2 D1) — only ``ORPHAN_ACK_REQUIRED`` is re-postable, and only it
    carries ``error.details.orphans``, the fields whose recorded answers
    the caller is being asked to strand.

    Known gap: a wide-but-older baseline that predates a column
    (``allows_not_applicable``, #462) normalizes the absent key to the
    column default rather than "leave alone", so a restore rewrites those
    flags — and ``diff_snapshots`` reports ``total == 0`` while it happens.
    Only whole-era (narrow) baselines are detectable here.
    """
    try:
        result = await discard_draft(
            db,
            project_id=project_id,
            template_id=template_id,
            user_id=current_user_sub,
            acknowledge_orphans=body.acknowledge_orphans,
        )
    except (ProjectTemplateNotFoundError, NoActiveTemplateVersionError) as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    # The five 409 refusals are ``AppError`` subclasses (B-9c2 D1) and are
    # deliberately NOT caught: ``app_error_handler`` renders each one with
    # its own ``TemplateDiscardRefusalCode`` and, for the orphan question,
    # the fields it is about. Catching them here to re-raise
    # ``HTTPException`` is what collapsed all five onto ``HTTP_ERROR`` with
    # no ``details`` (precedent for letting them through:
    # ``ExportColumnLimitError``).
    await db.commit()
    return ApiResponse.success(
        result,
        trace_id=getattr(request.state, "trace_id", None),
    )


@router.get(
    "/{project_id}/templates/{template_id}/config-status",
)
async def get_template_config_status_endpoint(
    project_id: UUID,
    template_id: UUID,
    request: Request,
    db: DbSession,
    user_sub: UUID = Depends(require_project_manager),
) -> ApiResponse[TemplateConfigStatusRead]:
    """Draft/publish status for the Configuration tab's chip (B-4).

    Manager-gated like the sibling config endpoints — the Configuration
    tab is the only consumer. A template that never published renders as
    ``active_version = null`` (a status, not an error).
    """
    try:
        result = await get_template_config_status(
            db, project_id=project_id, template_id=template_id, viewer_id=user_sub
        )
    except ProjectTemplateNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    return ApiResponse.success(
        result,
        trace_id=getattr(request.state, "trace_id", None),
    )


@router.get(
    "/{project_id}/templates/{template_id}/config-diff",
)
async def get_template_config_diff_endpoint(
    project_id: UUID,
    template_id: UUID,
    request: Request,
    db: DbSession,
    _user_sub: UUID = Depends(require_project_manager),
) -> ApiResponse[TemplateConfigDiffRead]:
    """What the open draft would publish, for the Publish sheet (B-9b2a).

    Manager-gated like the sibling config endpoints. A template that never
    published, and one whose baseline predates the wide snapshot builder,
    are both 200 with empty buckets and a flag saying why — never a 404 and
    never a fabricated change list. 404 is reserved for a foreign or missing
    template, exactly as ``config-status`` does it.

    Read-only, and takes no locks: a row that moves under it is a re-fetch,
    not a corruption. Nothing here acknowledges or publishes anything.
    """
    try:
        result = await get_template_config_diff(db, project_id=project_id, template_id=template_id)
    except ProjectTemplateNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    return ApiResponse.success(
        result,
        trace_id=getattr(request.state, "trace_id", None),
    )


@router.get(
    "/{project_id}/templates/{template_id}/active-version",
)
async def get_template_active_version(
    project_id: UUID,
    template_id: UUID,
    request: Request,
    db: DbSession,
    _user_sub: UUID = Depends(require_project_scope),
) -> ApiResponse[TemplateActiveVersionRead]:
    """The ACTIVE version tree the worklist/dashboard render from (B-3a).

    Member-gated (reviewers see the worklist). A template with no active
    version is a typed 404 — never an empty tree, which progress math
    would read as fully complete.
    """
    try:
        result = await get_active_version_tree(db, project_id=project_id, template_id=template_id)
    except (ProjectTemplateNotFoundError, NoActiveTemplateVersionError) as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    return ApiResponse.success(
        result,
        trace_id=getattr(request.state, "trace_id", None),
    )


@router.get("/{project_id}/templates/{template_id}/versions")
async def get_template_version_history_endpoint(
    project_id: UUID,
    template_id: UUID,
    request: Request,
    db: DbSession,
    _: UUID = Depends(require_project_manager),
) -> ApiResponse[TemplateVersionHistoryRead]:
    """The History timeline for a template's published versions (B-9e).

    Manager-gated like the rest of the configuration surface — this reads
    who changed the template and why, which is not reviewer-facing. The
    sibling ``active-version`` route is the one exception, member-gated
    because the worklist renders from it.

    An empty list is a 200: a template that never published has no
    timeline yet, which the card explains rather than treating as an error.
    """
    try:
        history = await get_template_version_history(
            db, project_id=project_id, template_id=template_id
        )
    except ProjectTemplateNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    return ApiResponse.success(history, trace_id=getattr(request.state, "trace_id", None))


@router.post("/{project_id}/templates/{template_id}/versions/{version_id}/restore")
async def restore_template_version(
    project_id: UUID,
    template_id: UUID,
    version_id: UUID,
    request: Request,
    db: DbSession,
    current_user_sub: UUID = Depends(require_project_manager),
) -> ApiResponse[RestoreVersionResponse]:
    """Stage an older version's shape as the current draft (B-9e).

    Does NOT rewrite history: the live tree is reconciled to that version
    and the draft marker is left stamped, so the manager reviews it through
    the ordinary Publish sheet — per-item acks and all — and it lands as
    v_max+1.

    404 covers both an unknown version and one belonging to another
    template: distinguishing them would confirm a foreign id exists.
    """
    try:
        result = await restore_version(
            db,
            project_id=project_id,
            template_id=template_id,
            version_id=version_id,
            user_id=current_user_sub,
        )
    except ProjectTemplateNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except VersionNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    # NarrowBaselineError is an AppError and reaches app_error_handler with
    # its typed code, exactly as it does on the discard path.
    await db.commit()
    return ApiResponse.success(
        RestoreVersionResponse(
            version=result.version,
            changed=result.changed,
            created_entity_types=result.created_entity_types,
            created_fields=result.created_fields,
            deleted_entity_types=result.deleted_entity_types,
            deleted_fields=result.deleted_fields,
            updated_entity_types=result.updated_entity_types,
            updated_fields=result.updated_fields,
            kept_count=result.kept_count,
        ),
        trace_id=getattr(request.state, "trace_id", None),
    )


@router.post(
    "/{project_id}/templates/{template_id}/draft-lock/take-over",
    responses={status.HTTP_409_CONFLICT: {"model": TemplateDraftLockRefusalResponse}},
)
async def take_over_draft_lock_endpoint(
    project_id: UUID,
    template_id: UUID,
    request: Request,
    db: DbSession,
    current_user_sub: UUID = Depends(require_project_manager),
) -> ApiResponse[TakeOverDraftLockResponse]:
    """Seize the advisory editor lock on this template's draft (B-9f).

    Unconditional by design. The lock exists so two managers do not
    silently overwrite each other, not to make a template unusable when
    someone shuts their laptop — so the release valve is a human clicking
    Take over, never a timer guessing whether the holder is still there.

    Nothing is lost: there is exactly ONE draft, so everything the previous
    holder wrote is already in it. They learn at their next write, which
    refuses with the new holder named.
    """
    try:
        result = await take_over_draft_lock(
            db,
            project_id=project_id,
            template_id=template_id,
            user_id=current_user_sub,
        )
    except TemplateNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    await db.commit()
    return ApiResponse.success(
        TakeOverDraftLockResponse(
            previous_holder_id=str(result.previous_holder_id)
            if result.previous_holder_id is not None
            else None,
            previous_holder_name=result.previous_holder_name,
        ),
        trace_id=getattr(request.state, "trace_id", None),
    )
