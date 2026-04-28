"""Endpoints for cloning Quality-Assessment templates into projects."""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, status

from app.api.deps.security import get_current_user_sub
from app.core.deps import DbSession
from app.schemas.common import ApiResponse
from app.schemas.qa_template import CloneQaTemplateRequest, CloneQaTemplateResponse
from app.services.qa_template_clone_service import (
    QaTemplateCloneService,
    QaTemplateNotFoundError,
)

router = APIRouter()


@router.post(
    "/{project_id}/qa-templates",
    status_code=status.HTTP_201_CREATED,
)
async def clone_qa_template(
    project_id: UUID,
    body: CloneQaTemplateRequest,
    request: Request,
    db: DbSession,
    current_user_sub: UUID = Depends(get_current_user_sub),
) -> ApiResponse[CloneQaTemplateResponse]:
    """Clone a global QA template (PROBAST, QUADAS-2, …) into the project.

    Idempotent on ``(project_id, global_template_id)``: the second call
    returns the existing clone, distinguishable via ``created=false``.
    """
    service = QaTemplateCloneService(db)
    try:
        result = await service.clone(
            project_id=project_id,
            global_template_id=body.global_template_id,
            user_id=current_user_sub,
        )
    except QaTemplateNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    await db.commit()
    return ApiResponse.success(
        CloneQaTemplateResponse(
            project_template_id=result.project_template_id,
            version_id=result.version_id,
            entity_type_count=result.entity_type_count,
            field_count=result.field_count,
            created=result.created,
        ),
        trace_id=getattr(request.state, "trace_id", None),
    )
