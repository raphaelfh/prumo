"""Per-project AI review-context endpoints (the PICOT editor's contract).

Auth + error mapping + envelope, nothing else — the read model and the write
both live in ``project_ai_context``.

GET is member-visible via ``require_project_scope``, the true member-of-path
dependency (never ``Depends(ensure_project_member)``, whose bare ``user_sub``
param would materialise as a client-supplied query parameter). It exposes only
this project's own review question, which ``project_select`` already grants
every member on the row itself — and deliberately NOT the whole
``projects.settings`` blob, which carries the ``managers_see_reviewers``
blind-review control.

PUT is ``require_project_manager``, matching the manager-only ``project_update``
RLS policy that governs the column. Both guards return 403 for a non-member AND
for a project that does not exist, so neither is an existence oracle.
"""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, status

from app.api.deps.security import require_project_manager, require_project_scope
from app.core.deps import DbSession
from app.schemas.common import ApiResponse
from app.schemas.project_ai_context import ProjectAiContextRead, ProjectAiContextUpdate
from app.services.project_ai_context import (
    ProjectNotFoundError,
    get_ai_context,
    set_ai_context,
)
from app.utils.rate_limiter import limiter

router = APIRouter()


@router.get("/{project_id}/ai-context", response_model=ApiResponse[ProjectAiContextRead])
@limiter.limit("60/minute")
async def read_ai_context(
    project_id: UUID,
    request: Request,
    db: DbSession,
    _viewer: UUID = Depends(require_project_scope),
) -> ApiResponse[ProjectAiContextRead]:
    """The stored PICOTS, the labels the prompt will use, the switch, the preview."""
    trace_id = getattr(request.state, "trace_id", None)
    try:
        data = await get_ai_context(db, project_id)
    except ProjectNotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e)) from e
    return ApiResponse.success(ProjectAiContextRead(**data), trace_id=trace_id)


@router.put("/{project_id}/ai-context", response_model=ApiResponse[ProjectAiContextRead])
@limiter.limit("30/minute")
async def update_ai_context(
    project_id: UUID,
    body: ProjectAiContextUpdate,
    request: Request,
    db: DbSession,
    _manager: UUID = Depends(require_project_manager),
) -> ApiResponse[ProjectAiContextRead]:
    """Persist the review question and/or its switch, and return the new preview.

    Returning the re-read model (rather than echoing the request) is what makes
    the preview trustworthy: it is rendered from what was actually stored.
    """
    trace_id = getattr(request.state, "trace_id", None)
    try:
        data = await set_ai_context(
            db,
            project_id,
            picots=body.picots.model_dump() if body.picots is not None else None,
            picots_enabled=body.picots_enabled,
        )
    except ProjectNotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e)) from e
    await db.commit()
    return ApiResponse.success(ProjectAiContextRead(**data), trace_id=trace_id)
