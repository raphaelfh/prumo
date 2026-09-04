"""Typed template-structure write endpoints (slice B-7).

Field and section writes for the config editor, replacing the frontend's
direct PostgREST writes on ``extraction_fields`` /
``extraction_entity_types``. Sibling of ``project_templates.py`` (same
``/projects`` prefix) — split out so neither module crowds the file-size
ceiling.

* ``POST   .../templates/{template_id}/fields`` — create a field (201).
* ``PATCH  .../templates/{template_id}/fields/{field_id}`` — partial update.
* ``DELETE .../templates/{template_id}/fields/{field_id}`` — delete.
* ``POST   .../templates/{template_id}/fields/{field_id}/move`` — re-parent
  onto another section of the SAME template (the cross-template hole).
* ``POST   .../templates/{template_id}/fields/reorder`` — atomic batch
  renumber (replaces the old N-independent-UPDATEs loop).
* ``POST   .../templates/{template_id}/sections`` — create a section (201);
  ``role``/``parent_entity_type_id`` are explicit, ``sort_order`` is
  server-computed; repeating groups carry ``entry_label`` (B-8).
* ``PATCH  .../templates/{template_id}/sections/{section_id}`` — partial
  update (label / entry_label / cardinality, role-gated in the service).
* ``DELETE .../templates/{template_id}/sections/{section_id}`` — delete.

All manager-gated (section/field editing is project-wide configuration)
with the full BOLA chain re-verified in the services (404, never 403).
Every write stamps the B-4 draft marker via the 0048 AFTER-row trigger —
nothing manual here — so edits stay drafts until the explicit Publish
(``republish-version``). B-7 discharges the recorded prod-promotion gate
for the B-4 Publish button (typed endpoints + the RLS tightening).
"""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.exc import DBAPIError

from app.api.deps.security import require_project_manager
from app.api.v1.endpoints._integrity import DEADLOCK_RETRY_DETAIL, is_deadlock
from app.core.deps import DbSession
from app.schemas.common import ApiResponse
from app.schemas.template_structure import (
    SectionCreateRequest,
    SectionDeleteResponse,
    SectionRead,
    SectionUpdateRequest,
    TemplateFieldCreateRequest,
    TemplateFieldDeleteResponse,
    TemplateFieldMoveRequest,
    TemplateFieldRead,
    TemplateFieldReorderRequest,
    TemplateFieldReorderResponse,
    TemplateFieldUpdateRequest,
)
from app.services.template_draft_lock_service import claim_draft_lock
from app.services.template_field_service import (
    CrossTemplateMoveError,
    DuplicateEntityKeyError,
    DuplicateFieldNameError,
    DuplicateReorderIdsError,
    EntityTypeNotFoundError,
    FieldInUseError,
    FieldNotFoundError,
    ProjectTemplateNotFoundError,
    create_field,
    delete_field,
    move_field,
    reorder_fields,
    update_field,
)
from app.services.template_section_service import (
    OneContainerError,
    SectionCardinalityInUseError,
    SectionCardinalityRoleError,
    SectionEntryLabelRoleError,
    SectionInUseError,
    SectionNotFoundError,
    SectionParentRoleError,
    create_section,
    delete_section,
    update_section,
)

router = APIRouter()


async def _claim_lock(db: DbSession, project_id: UUID, template_id: UUID, user_sub: UUID) -> None:
    """Claim the B-9f editor lock before a config write, or refuse.

    ONE copy for all 8 config-write endpoints — this block was pasted into
    each of them, which is how a 404 mapping went missing when the claim
    became project-scoped.

    The claim is itself an UPDATE on the template row, so it can lose a
    deadlock race exactly like the write it guards; a template outside the
    path project 404s here rather than reaching the lock at all.
    """
    try:
        await claim_draft_lock(db, project_id=project_id, template_id=template_id, user_id=user_sub)
    except ProjectTemplateNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except DBAPIError as e:
        if is_deadlock(e):
            raise HTTPException(status_code=409, detail=DEADLOCK_RETRY_DETAIL) from e
        raise


@router.post(
    "/{project_id}/templates/{template_id}/fields",
    status_code=status.HTTP_201_CREATED,
)
async def create_template_field(
    project_id: UUID,
    template_id: UUID,
    body: TemplateFieldCreateRequest,
    request: Request,
    db: DbSession,
    user_sub: UUID = Depends(require_project_manager),
) -> ApiResponse[TemplateFieldRead]:
    """Create a field in a section of the path template.

    The write stamps the B-4 draft marker via the 0048 trigger (nothing
    manual); the field reaches article forms at Publish.
    """
    await _claim_lock(db, project_id, template_id, user_sub)
    try:
        result = await create_field(
            db, project_id=project_id, template_id=template_id, payload=body
        )
    except (ProjectTemplateNotFoundError, EntityTypeNotFoundError) as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except DuplicateFieldNameError as e:
        raise HTTPException(status_code=409, detail=str(e)) from e
    except DBAPIError as e:
        if is_deadlock(e):
            raise HTTPException(status_code=409, detail=DEADLOCK_RETRY_DETAIL) from e
        raise
    await db.commit()
    return ApiResponse.success(
        result,
        trace_id=getattr(request.state, "trace_id", None),
    )


@router.patch(
    "/{project_id}/templates/{template_id}/fields/{field_id}",
)
async def update_template_field(
    project_id: UUID,
    template_id: UUID,
    field_id: UUID,
    body: TemplateFieldUpdateRequest,
    request: Request,
    db: DbSession,
    user_sub: UUID = Depends(require_project_manager),
) -> ApiResponse[TemplateFieldRead]:
    """Partial field update — only explicitly-set keys are applied.

    Relocation is the move endpoint's job (the schema rejects a smuggled
    ``entity_type_id``). Stamps the B-4 draft marker via the 0048 trigger.
    """
    await _claim_lock(db, project_id, template_id, user_sub)
    try:
        result = await update_field(
            db,
            project_id=project_id,
            template_id=template_id,
            field_id=field_id,
            payload=body,
        )
    except (ProjectTemplateNotFoundError, FieldNotFoundError) as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except DuplicateFieldNameError as e:
        raise HTTPException(status_code=409, detail=str(e)) from e
    except DuplicateEntityKeyError as e:
        # 409, matching the name-collision sibling: another row already
        # holds the section's one identity slot, and the caller can retry
        # after clearing it.
        raise HTTPException(status_code=409, detail=str(e)) from e
    except DBAPIError as e:
        if is_deadlock(e):
            raise HTTPException(status_code=409, detail=DEADLOCK_RETRY_DETAIL) from e
        raise
    await db.commit()
    return ApiResponse.success(
        result,
        trace_id=getattr(request.state, "trace_id", None),
    )


@router.delete(
    "/{project_id}/templates/{template_id}/fields/{field_id}",
)
async def delete_template_field(
    project_id: UUID,
    template_id: UUID,
    field_id: UUID,
    request: Request,
    db: DbSession,
    user_sub: UUID = Depends(require_project_manager),
) -> ApiResponse[TemplateFieldDeleteResponse]:
    """Delete a field; recorded extraction work (RESTRICT FKs) is a 409.

    Stamps the B-4 draft marker via the 0048 trigger (nothing manual).
    """
    await _claim_lock(db, project_id, template_id, user_sub)
    try:
        result = await delete_field(
            db, project_id=project_id, template_id=template_id, field_id=field_id
        )
    except (ProjectTemplateNotFoundError, FieldNotFoundError) as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except FieldInUseError as e:
        raise HTTPException(status_code=409, detail=str(e)) from e
    except DBAPIError as e:
        if is_deadlock(e):
            raise HTTPException(status_code=409, detail=DEADLOCK_RETRY_DETAIL) from e
        raise
    await db.commit()
    return ApiResponse.success(
        result,
        trace_id=getattr(request.state, "trace_id", None),
    )


@router.post(
    "/{project_id}/templates/{template_id}/fields/{field_id}/move",
)
async def move_template_field(
    project_id: UUID,
    template_id: UUID,
    field_id: UUID,
    body: TemplateFieldMoveRequest,
    request: Request,
    db: DbSession,
    user_sub: UUID = Depends(require_project_manager),
) -> ApiResponse[TemplateFieldRead]:
    """Move a field onto another section of the SAME template.

    A destination outside the path template is a 422 (deterministic, no
    retry can succeed) — the cross-template hole this slice closes.
    Stamps the B-4 draft marker via the 0048 trigger.
    """
    await _claim_lock(db, project_id, template_id, user_sub)
    try:
        result = await move_field(
            db,
            project_id=project_id,
            template_id=template_id,
            field_id=field_id,
            payload=body,
        )
    except (ProjectTemplateNotFoundError, FieldNotFoundError) as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except DuplicateFieldNameError as e:
        raise HTTPException(status_code=409, detail=str(e)) from e
    except CrossTemplateMoveError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e
    except DBAPIError as e:
        if is_deadlock(e):
            raise HTTPException(status_code=409, detail=DEADLOCK_RETRY_DETAIL) from e
        raise
    await db.commit()
    return ApiResponse.success(
        result,
        trace_id=getattr(request.state, "trace_id", None),
    )


@router.post(
    "/{project_id}/templates/{template_id}/fields/reorder",
)
async def reorder_template_fields(
    project_id: UUID,
    template_id: UUID,
    body: TemplateFieldReorderRequest,
    request: Request,
    db: DbSession,
    user_sub: UUID = Depends(require_project_manager),
) -> ApiResponse[TemplateFieldReorderResponse]:
    """Atomic batch renumber (multi-section batches are legal).

    Every id must belong to a section of this template; the batch fully
    applies or fully fails. Stamps the B-4 draft marker via the 0048
    trigger.
    """
    await _claim_lock(db, project_id, template_id, user_sub)
    try:
        result = await reorder_fields(
            db, project_id=project_id, template_id=template_id, payload=body
        )
    except (ProjectTemplateNotFoundError, FieldNotFoundError) as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except DuplicateReorderIdsError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e
    except DBAPIError as e:
        if is_deadlock(e):
            raise HTTPException(status_code=409, detail=DEADLOCK_RETRY_DETAIL) from e
        raise
    await db.commit()
    return ApiResponse.success(
        result,
        trace_id=getattr(request.state, "trace_id", None),
    )


@router.post(
    "/{project_id}/templates/{template_id}/sections",
    status_code=status.HTTP_201_CREATED,
)
async def create_template_section(
    project_id: UUID,
    template_id: UUID,
    body: SectionCreateRequest,
    request: Request,
    db: DbSession,
    user_sub: UUID = Depends(require_project_manager),
) -> ApiResponse[SectionRead]:
    """Create a section; ``sort_order`` is server-computed (max+1).

    ``role`` and ``parent_entity_type_id`` are explicit parameters — a
    model_section's parent must be the template's model_container (400);
    a second model_container is a 409. Stamps the B-4 draft marker via
    the 0048 trigger (nothing manual).
    """
    await _claim_lock(db, project_id, template_id, user_sub)
    try:
        result = await create_section(
            db, project_id=project_id, template_id=template_id, payload=body
        )
    except (ProjectTemplateNotFoundError, SectionNotFoundError) as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except SectionParentRoleError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except OneContainerError as e:
        raise HTTPException(status_code=409, detail=str(e)) from e
    except DBAPIError as e:
        if is_deadlock(e):
            raise HTTPException(status_code=409, detail=DEADLOCK_RETRY_DETAIL) from e
        raise
    await db.commit()
    return ApiResponse.success(
        result,
        trace_id=getattr(request.state, "trace_id", None),
    )


@router.patch(
    "/{project_id}/templates/{template_id}/sections/{section_id}",
)
async def update_template_section(
    project_id: UUID,
    template_id: UUID,
    section_id: UUID,
    body: SectionUpdateRequest,
    request: Request,
    db: DbSession,
    user_sub: UUID = Depends(require_project_manager),
) -> ApiResponse[SectionRead]:
    """Partial section update: label, entry_label, cardinality, description (B-8).

    Role rules are 422s (entry_label only on a repeating section;
    cardinality only on a per-model section); many -> one with a parent
    instance holding 2+ entries is a 409. ``description`` is the section's
    AI instruction; a blank one clears it. A real change stamps the B-4
    draft marker via the 0048 trigger; an all-no-op update skips the
    write (no stamp).
    """
    await _claim_lock(db, project_id, template_id, user_sub)
    try:
        result = await update_section(
            db,
            project_id=project_id,
            template_id=template_id,
            section_id=section_id,
            payload=body,
        )
    except (ProjectTemplateNotFoundError, SectionNotFoundError) as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except (SectionEntryLabelRoleError, SectionCardinalityRoleError) as e:
        raise HTTPException(status_code=422, detail=str(e)) from e
    except SectionCardinalityInUseError as e:
        raise HTTPException(status_code=409, detail=str(e)) from e
    except DBAPIError as e:
        if is_deadlock(e):
            raise HTTPException(status_code=409, detail=DEADLOCK_RETRY_DETAIL) from e
        raise
    await db.commit()
    return ApiResponse.success(
        result,
        trace_id=getattr(request.state, "trace_id", None),
    )


@router.delete(
    "/{project_id}/templates/{template_id}/sections/{section_id}",
)
async def delete_template_section(
    project_id: UUID,
    template_id: UUID,
    section_id: UUID,
    request: Request,
    db: DbSession,
    user_sub: UUID = Depends(require_project_manager),
) -> ApiResponse[SectionDeleteResponse]:
    """Delete a section (the DB cascades fields and child sections).

    Extracted data anywhere under it (RESTRICT FK) is a 409. Stamps the
    B-4 draft marker via the 0048 trigger (nothing manual).
    """
    await _claim_lock(db, project_id, template_id, user_sub)
    try:
        result = await delete_section(
            db, project_id=project_id, template_id=template_id, section_id=section_id
        )
    except (ProjectTemplateNotFoundError, SectionNotFoundError) as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except SectionInUseError as e:
        raise HTTPException(status_code=409, detail=str(e)) from e
    except DBAPIError as e:
        if is_deadlock(e):
            raise HTTPException(status_code=409, detail=DEADLOCK_RETRY_DETAIL) from e
        raise
    await db.commit()
    return ApiResponse.success(
        result,
        trace_id=getattr(request.state, "trace_id", None),
    )
