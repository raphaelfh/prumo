"""Endpoint for the per-kind manager-review-visibility project setting."""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, status

from app.api.deps.security import require_project_manager
from app.core.deps import DbSession
from app.schemas.common import ApiResponse
from app.schemas.manager_review_visibility import (
    ManagerReviewVisibilityPayload,
    ManagerReviewVisibilityRead,
)
from app.services.manager_review_visibility_service import (
    ManagerReviewVisibilityService,
    ProjectNotFoundError,
)

router = APIRouter()


@router.put("/{project_id}/manager-review-visibility")
async def set_manager_review_visibility(
    project_id: UUID,
    body: ManagerReviewVisibilityPayload,
    request: Request,
    db: DbSession,
    _manager: UUID = Depends(require_project_manager),
) -> ApiResponse[ManagerReviewVisibilityRead]:
    trace_id = getattr(request.state, "trace_id", None)
    try:
        merged = await ManagerReviewVisibilityService(db).set_for_project(
            project_id=project_id,
            kind=body.kind,
            value=body.managers_see_reviewers,
        )
    except ProjectNotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e)) from e
    await db.commit()
    return ApiResponse.success(ManagerReviewVisibilityRead(**merged), trace_id=trace_id)
