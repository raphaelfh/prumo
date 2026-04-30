"""Project-scoped template management endpoints.

Two thin endpoints over ``project_extraction_templates`` rows:

* ``POST /api/v1/projects/{project_id}/templates/clone`` — enable a global
  template (PROBAST, QUADAS-2, ...) for the project. Idempotent on
  ``(project_id, global_template_id)``.
* ``PATCH /api/v1/projects/{project_id}/templates/{template_id}`` — flip
  the ``is_active`` flag. The Configuration UI uses this to disable a QA
  tool the user no longer wants to run.

Both are distinct from ``POST /api/v1/hitl/sessions``, which is per-article.
The Configuration tab needs to manage the project-level "which tools are
enabled" list before any session is opened.
"""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select

from app.api.deps.security import get_current_user_sub
from app.core.deps import DbSession
from app.models.extraction import (
    ProjectExtractionTemplate,
    TemplateKind,
)
from app.schemas.common import ApiResponse
from app.schemas.hitl_session import (
    CloneTemplateRequest,
    CloneTemplateResponse,
    UpdateTemplateActiveRequest,
    UpdateTemplateActiveResponse,
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
    """Clone a global template into the project (idempotent).

    Used by the Configuration UI to enable a tool. For QA, the project can
    have several rows enabled at once (PROBAST + QUADAS-2). For extraction,
    the workflow today is one custom template per project, but the endpoint
    accepts both kinds — the policy lives in the UI.
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
    current_user_sub: UUID = Depends(get_current_user_sub),  # noqa: ARG001
) -> ApiResponse[UpdateTemplateActiveResponse]:
    """Toggle ``is_active`` on a project template.

    Disabling an extraction template that is the project's only active
    extraction template returns 400 — the extraction workflow assumes a
    single active template at all times. QA has no such constraint:
    disabling the last QA template just means the project chose not to run
    any QA tool at the moment.
    """
    tpl = await db.get(ProjectExtractionTemplate, template_id)
    if tpl is None or tpl.project_id != project_id:
        raise HTTPException(status_code=404, detail="Project template not found")

    if tpl.kind == TemplateKind.EXTRACTION.value and body.is_active is False:
        siblings_stmt = select(ProjectExtractionTemplate).where(
            ProjectExtractionTemplate.project_id == project_id,
            ProjectExtractionTemplate.kind == TemplateKind.EXTRACTION.value,
            ProjectExtractionTemplate.is_active.is_(True),
            ProjectExtractionTemplate.id != template_id,
        )
        other_active = (await db.execute(siblings_stmt)).scalars().first()
        if other_active is None:
            raise HTTPException(
                status_code=400,
                detail=(
                    "Cannot disable the only active extraction template for "
                    "this project; import another extraction template first."
                ),
            )

    tpl.is_active = body.is_active
    await db.flush()
    await db.commit()
    return ApiResponse.success(
        UpdateTemplateActiveResponse(
            project_template_id=tpl.id,
            is_active=tpl.is_active,
        ),
        trace_id=getattr(request.state, "trace_id", None),
    )
