"""Duplicate review (managers only): the candidate and resolved pairs, and the verdicts."""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, status

from app.api.deps.security import require_project_manager
from app.core.deps import DbSession
from app.schemas.common import ApiResponse
from app.schemas.duplicates import DuplicatesRead, DuplicateVerdictsCreate, DuplicateVerdictsResult
from app.services.article_read_service import ArticleNotFoundError
from app.services.duplicate_service import DuplicateService
from app.services.screening_config_service import ProjectNotFoundError
from app.utils.rate_limiter import limiter

router = APIRouter()


@router.get(
    "/projects/{project_id}/duplicates",
    responses={403: {"description": "Only project managers review duplicates"}},
    dependencies=[Depends(require_project_manager)],
)
@limiter.limit("60/minute")
async def get_duplicates(
    request: Request,
    project_id: UUID,
    db: DbSession,
) -> ApiResponse[DuplicatesRead]:
    """Open candidate pairs and resolved pairs, each side with its compare fields."""
    read = await DuplicateService(db).read(project_id)
    return ApiResponse.success(read, trace_id=getattr(request.state, "trace_id", None))


@router.post(
    "/projects/{project_id}/duplicates/verdicts",
    responses={
        404: {"description": "An article is not in this project"},
        409: {
            "description": "The record to remove has full-text or extraction work, "
            "or the record to keep was already removed"
        },
    },
)
@limiter.limit("10/minute")
async def post_duplicate_verdicts(
    request: Request,
    project_id: UUID,
    body: DuplicateVerdictsCreate,
    db: DbSession,
    user_sub: UUID = Depends(require_project_manager),
) -> ApiResponse[DuplicateVerdictsResult]:
    """Record a batch of rulings in order, in one transaction; a refusal writes nothing."""
    try:
        result = await DuplicateService(db).write_verdicts(project_id, user_sub, body.items)
    except ArticleNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Article not found"
        ) from exc
    except ProjectNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Project not found"
        ) from exc
    await db.commit()
    return ApiResponse.success(result, trace_id=getattr(request.state, "trace_id", None))
