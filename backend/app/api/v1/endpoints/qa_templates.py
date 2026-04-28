"""Endpoints for cloning QA templates and opening assessment sessions."""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, status

from app.api.deps.security import get_current_user_sub
from app.core.deps import DbSession
from app.schemas.common import ApiResponse
from app.schemas.qa_template import (
    CloneQaTemplateRequest,
    CloneQaTemplateResponse,
    OpenQaAssessmentRequest,
    OpenQaAssessmentResponse,
)
from app.services.qa_assessment_session_service import QaAssessmentSessionService
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


qa_router = APIRouter()


@qa_router.post(
    "/qa-assessments",
    status_code=status.HTTP_201_CREATED,
)
async def open_qa_assessment(
    body: OpenQaAssessmentRequest,
    request: Request,
    db: DbSession,
    current_user_sub: UUID = Depends(get_current_user_sub),
) -> ApiResponse[OpenQaAssessmentResponse]:
    """Open or resume a Quality-Assessment session for an article.

    Sets up the full session in one call: clones the global QA template
    into the project (idempotent), ensures one instance per domain for
    the article, and parks a Run in the PROPOSAL stage so the UI can
    immediately record human proposals. Re-calling reuses the existing
    in-flight Run instead of forking a new one.
    """
    service = QaAssessmentSessionService(db)
    try:
        session = await service.open(
            project_id=body.project_id,
            article_id=body.article_id,
            global_template_id=body.global_template_id,
            user_id=current_user_sub,
        )
    except QaTemplateNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    await db.commit()
    return ApiResponse.success(
        OpenQaAssessmentResponse(
            run_id=session.run_id,
            project_template_id=session.project_template_id,
            instances_by_entity_type=session.instances_by_entity_type,
        ),
        trace_id=getattr(request.state, "trace_id", None),
    )
