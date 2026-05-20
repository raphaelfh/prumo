"""Project-scoped template management endpoints.

* ``POST /api/v1/projects/{project_id}/templates/clone`` — clone a global
  template (CHARMS, PROBAST, QUADAS-2, …) into the project. Idempotent on
  ``(project_id, global_template_id)``. Creates entity types, fields, and
  an active ``extraction_template_versions`` row in one transaction; may
  rebuild an empty legacy clone. Used by the extraction import dialog and
  by configuration flows that enable QA tools.
* ``PATCH /api/v1/projects/{project_id}/templates/{template_id}`` — toggle
  ``is_active`` (e.g. disable a QA tool in Configuration).

These are project-scoped. ``POST /api/v1/hitl/sessions`` is per-article run
lifecycle and is separate.
"""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, status

from app.api.deps.security import get_current_user_sub, require_project_manager
from app.core.deps import DbSession
from app.schemas.common import ApiResponse
from app.schemas.hitl_session import (
    CloneTemplateRequest,
    CloneTemplateResponse,
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
    current_user_sub: UUID = Depends(get_current_user_sub),
) -> ApiResponse[CloneTemplateResponse]:
    """Clone a global template into the project (idempotent)."""
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
