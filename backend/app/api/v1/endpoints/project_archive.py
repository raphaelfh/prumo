"""Archive / restore a project.

Auth + error mapping + envelope, nothing else — the write lives in
``app.services.project_archive``.

``require_project_manager`` matches the manager-only ``project_update`` RLS
policy that governs the column, and answers 403 both for a non-manager and for
a project that does not exist, so the route is not an existence oracle. The
404 branch below is therefore unreachable through HTTP today; it is kept
because the service is also called directly (tests, and any future caller that
is already scoped), and swallowing a missing row would return a success
envelope describing a write that did not happen.
"""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, status

from app.api.deps.security import require_project_manager
from app.core.deps import DbSession
from app.schemas.common import ApiResponse
from app.schemas.project_archive import ProjectArchiveRead, ProjectArchiveUpdate
from app.services.project_archive import ProjectNotFoundError, set_project_archived
from app.utils.rate_limiter import limiter

router = APIRouter()


@router.patch("/{project_id}/archive", response_model=ApiResponse[ProjectArchiveRead])
@limiter.limit("30/minute")
async def set_archived(
    project_id: UUID,
    body: ProjectArchiveUpdate,
    request: Request,
    db: DbSession,
    _manager: UUID = Depends(require_project_manager),
) -> ApiResponse[ProjectArchiveRead]:
    """Archive (`archived=true`) or restore, returning the row as stored."""
    trace_id = getattr(request.state, "trace_id", None)
    try:
        data = await set_project_archived(db, project_id, archived=body.archived)
    except ProjectNotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e)) from e
    await db.commit()
    return ApiResponse.success(ProjectArchiveRead(**data), trace_id=trace_id)
