"""Duplicate review: the candidate and resolved pairs of a project (managers only)."""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, Request

from app.api.deps.security import require_project_manager
from app.core.deps import DbSession
from app.schemas.common import ApiResponse
from app.schemas.duplicates import DuplicatesRead
from app.services.duplicate_service import DuplicateService
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
