"""Per-project AI agents policy endpoints.

GET is member-visible (``require_project_scope``); PUT is manager-only
(``require_project_manager``). Both guards answer 403 for a non-member and
for a project that does not exist. There is no other writer: no MCP tool
changes this policy.
"""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, status

from app.api.deps.security import require_project_manager, require_project_scope
from app.core.deps import DbSession
from app.schemas.ai_policy import AiPolicyRead, AiPolicyUpdateRequest
from app.schemas.common import ApiResponse
from app.services import ai_policy_service
from app.services.ai_policy_service import ProjectNotFoundError

router = APIRouter()


@router.get(
    "/{project_id}/ai-policy",
    response_model=ApiResponse[AiPolicyRead],
    responses={
        status.HTTP_403_FORBIDDEN: {"description": "Not a member of the project"},
        status.HTTP_404_NOT_FOUND: {"description": "The project row is missing"},
    },
)
async def read_ai_policy(
    project_id: UUID,
    request: Request,
    db: DbSession,
    _member: UUID = Depends(require_project_scope),
) -> ApiResponse[AiPolicyRead]:
    """The project's AI agents policy; an unset policy reads as the defaults."""
    trace_id = getattr(request.state, "trace_id", None)
    try:
        stored = await ai_policy_service.read(db, project_id)
    except ProjectNotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e)) from e
    return ApiResponse.success(AiPolicyRead(**stored.model_dump()), trace_id=trace_id)


@router.put(
    "/{project_id}/ai-policy",
    response_model=ApiResponse[AiPolicyRead],
    responses={
        status.HTTP_403_FORBIDDEN: {"description": "Not a manager of the project"},
        status.HTTP_404_NOT_FOUND: {"description": "The project row is missing"},
        status.HTTP_422_UNPROCESSABLE_CONTENT: {
            "description": "Unknown field, or a value out of bounds"
        },
    },
)
async def update_ai_policy(
    project_id: UUID,
    body: AiPolicyUpdateRequest,
    request: Request,
    db: DbSession,
    manager: UUID = Depends(require_project_manager),
) -> ApiResponse[AiPolicyRead]:
    """Replace the project's AI agents policy and return what was stored."""
    trace_id = getattr(request.state, "trace_id", None)
    try:
        stored = await ai_policy_service.set_for_project(
            db, project_id=project_id, update=body, user_id=manager
        )
    except ProjectNotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e)) from e
    await db.commit()
    return ApiResponse.success(AiPolicyRead(**stored.model_dump()), trace_id=trace_id)
