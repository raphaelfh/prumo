"""Delete a project (Settings → Advanced → Delete project).

Auth, gate order and envelope only — the delete lives in
``app.services.project_delete_service``. Same gates as ``PATCH .../details``:
a non-member and a missing project both get 404, a member who is not a
manager gets 403. The manager rule is the one the ``project_delete`` RLS
policy applied while the browser still deleted through PostgREST.
"""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, status

from app.api.deps.security import get_current_user_sub, is_project_manager, is_project_member
from app.core.deps import DbSession
from app.schemas.common import ApiResponse
from app.schemas.project_delete import ProjectDeleteRead
from app.services.project_delete_service import delete_project_row
from app.utils.rate_limiter import limiter

router = APIRouter()


@router.delete(
    "/{project_id}",
    response_model=ApiResponse[ProjectDeleteRead],
    responses={
        status.HTTP_403_FORBIDDEN: {"description": "A member who is not a project manager"},
        status.HTTP_404_NOT_FOUND: {
            "description": "Not a member of the project, or no such project"
        },
    },
)
@limiter.limit("10/minute")
async def delete_project(
    project_id: UUID,
    request: Request,
    db: DbSession,
    user_sub: UUID = Depends(get_current_user_sub),
) -> ApiResponse[ProjectDeleteRead]:
    """Delete the project and everything under it (the foreign keys cascade)."""
    if not await is_project_member(db, project_id, user_sub):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    if not await is_project_manager(db, project_id, user_sub):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Manager role required")
    await delete_project_row(db, project_id)
    await db.commit()
    return ApiResponse.success(
        ProjectDeleteRead(id=project_id), trace_id=getattr(request.state, "trace_id", None)
    )
