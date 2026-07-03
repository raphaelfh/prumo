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
  ``extraction_template_versions`` row. Called by the configuration UI after
  every section/field edit (the edits themselves go through PostgREST), so
  article forms — which render from the run's version snapshot — pick them up.

These are project-scoped. ``POST /api/v1/hitl/sessions`` is per-article run
lifecycle and is separate.
"""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, status

from app.api.deps.security import require_project_manager
from app.core.deps import DbSession
from app.schemas.common import ApiResponse
from app.schemas.hitl_session import (
    CloneTemplateRequest,
    CloneTemplateResponse,
    RepublishTemplateVersionResponse,
    TemplateKind,
    UpdateTemplateActiveRequest,
    UpdateTemplateActiveResponse,
)
from app.services.project_template_active_service import (
    LastActiveExtractionTemplateError,
    ProjectTemplateNotFoundError,
    set_template_active,
)
from app.services.template_clone_service import (
    TemplateCloneService,
    TemplateNotFoundError,
)
from app.services.template_version_service import TemplateVersionService

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
    return ApiResponse.success(
        result,
        trace_id=getattr(request.state, "trace_id", None),
    )


@router.post(
    "/{project_id}/templates/{template_id}/republish-version",
)
async def republish_template_version(
    project_id: UUID,
    template_id: UUID,
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
    """
    service = TemplateVersionService(db)
    try:
        result = await service.republish(
            project_id=project_id,
            project_template_id=template_id,
            user_id=current_user_sub,
        )
    except TemplateNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
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
