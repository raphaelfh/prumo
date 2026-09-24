"""Edit a project's descriptive columns (the Settings page save).

Auth, gate order and envelope only — the write lives in
``app.services.project_details_service``. A non-member and a missing project
both get 404 (``public.is_project_member`` is false for both, so the route is
no existence oracle); a member who is not a manager gets 403. Not
``require_project_manager``, which answers 403 for all three. The manager rule
is the one the ``project_update`` RLS policy applied while the browser still
wrote this table through PostgREST.
"""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, status

from app.api.deps.security import get_current_user_sub, is_project_manager, is_project_member
from app.core.deps import DbSession
from app.schemas.common import ApiResponse
from app.schemas.project_details import (
    ProjectDetailsRead,
    ProjectDetailsRefusalResponse,
    ProjectDetailsUpdate,
)
from app.services.project_details_service import update_details
from app.utils.rate_limiter import limiter

router = APIRouter()


@router.patch(
    "/{project_id}/details",
    response_model=ApiResponse[ProjectDetailsRead],
    responses={
        status.HTTP_403_FORBIDDEN: {"description": "A member who is not a project manager"},
        status.HTTP_404_NOT_FOUND: {
            "description": "Not a member of the project, or no such project"
        },
        status.HTTP_409_CONFLICT: {
            "model": ProjectDetailsRefusalResponse,
            "description": "Refused: a field changed since the caller read it",
        },
        status.HTTP_422_UNPROCESSABLE_CONTENT: {
            "description": "Unknown or invalid field, or expected does not cover fields"
        },
    },
)
@limiter.limit("30/minute")
async def update_project_details(
    project_id: UUID,
    body: ProjectDetailsUpdate,
    request: Request,
    db: DbSession,
    user_sub: UUID = Depends(get_current_user_sub),
) -> ApiResponse[ProjectDetailsRead]:
    """Write the changed descriptive columns if every `expected` value is still current."""
    if not await is_project_member(db, project_id, user_sub):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    if not await is_project_manager(db, project_id, user_sub):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Manager role required")
    change = await update_details(
        db, project_id=project_id, fields=body.fields, expected=body.expected
    )
    await db.commit()
    return ApiResponse.success(change.details, trace_id=getattr(request.state, "trace_id", None))
