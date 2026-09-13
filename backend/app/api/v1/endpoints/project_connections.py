"""Project-scope connections (§4): a project's shared hosted-provider keys.

Manager-only CRUD + verify, gated by ``require_project_manager`` (the
dependency face of ``public.is_project_manager``) — membership is the
router's job, never re-implemented here. Every fetch is project-scoped
inside the service (``owned_project_connection``): a cross-project id is
a 404. Host-bearing providers are refused by
``ProjectConnectionCreateRequest`` (422) — a host is user-owned.
``ConnectionUnavailableError`` propagates to the AppError handler's
typed 409.

A duplicate surfaces as a ``ValueError`` raised from a failed flush, so
the session is unusable until it is rolled back — every 400 path rolls
back before it raises.
"""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, status

from app.api.deps.security import require_project_manager
from app.core.deps import DbSession
from app.core.net_guard import EndpointUrlError
from app.schemas.common import ApiResponse
from app.schemas.llm_connection import (
    LlmConnectionDeleteResult,
    LlmConnectionRead,
    LlmConnectionUpdateRequest,
    LlmConnectionVerifyResult,
    ProjectConnectionCreateRequest,
)
from app.services.llm_connection_service import ConnectionNotFoundError, LlmConnectionService
from app.utils.rate_limiter import limiter

router = APIRouter()


def _trace_id(request: Request) -> str | None:
    return getattr(request.state, "trace_id", None)


@router.get("/{project_id}/connections", response_model=ApiResponse[list[LlmConnectionRead]])
@limiter.limit("60/minute")
async def list_project_connections(
    project_id: UUID,
    request: Request,
    db: DbSession,
    _manager: UUID = Depends(require_project_manager),
) -> ApiResponse[list[LlmConnectionRead]]:
    data = await LlmConnectionService(db).list_project(project_id)
    return ApiResponse.success(data, trace_id=_trace_id(request))


@router.post(
    "/{project_id}/connections",
    response_model=ApiResponse[LlmConnectionRead],
    status_code=status.HTTP_201_CREATED,
)
@limiter.limit("20/minute")
async def create_project_connection(
    project_id: UUID,
    body: ProjectConnectionCreateRequest,
    request: Request,
    db: DbSession,
    manager_id: UUID = Depends(require_project_manager),
) -> ApiResponse[LlmConnectionRead]:
    try:
        data = await LlmConnectionService(db).create_project(
            project_id=project_id, created_by=manager_id, payload=body
        )
    except (EndpointUrlError, ValueError) as e:  # sanitized URL reason / duplicate label
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from e
    await db.commit()
    return ApiResponse.success(data, trace_id=_trace_id(request))


@router.put(
    "/{project_id}/connections/{connection_id}", response_model=ApiResponse[LlmConnectionRead]
)
@limiter.limit("20/minute")
async def update_project_connection(
    project_id: UUID,
    connection_id: UUID,
    body: LlmConnectionUpdateRequest,
    request: Request,
    db: DbSession,
    _manager: UUID = Depends(require_project_manager),
) -> ApiResponse[LlmConnectionRead]:
    try:
        data = await LlmConnectionService(db).update_project(
            project_id=project_id, connection_id=connection_id, payload=body
        )
    except ConnectionNotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e)) from e
    except (EndpointUrlError, ValueError) as e:
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from e
    await db.commit()
    return ApiResponse.success(data, trace_id=_trace_id(request))


@router.delete(
    "/{project_id}/connections/{connection_id}",
    response_model=ApiResponse[LlmConnectionDeleteResult],
)
@limiter.limit("20/minute")
async def delete_project_connection(
    project_id: UUID,
    connection_id: UUID,
    request: Request,
    db: DbSession,
    _manager: UUID = Depends(require_project_manager),
) -> ApiResponse[LlmConnectionDeleteResult]:
    try:
        data = await LlmConnectionService(db).delete_project(
            project_id=project_id, connection_id=connection_id
        )
    except ConnectionNotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e)) from e
    await db.commit()
    return ApiResponse.success(data, trace_id=_trace_id(request))


@router.post(
    "/{project_id}/connections/{connection_id}/verify",
    response_model=ApiResponse[LlmConnectionVerifyResult],
)
@limiter.limit("30/minute")
async def verify_project_connection(
    project_id: UUID,
    connection_id: UUID,
    request: Request,
    db: DbSession,
    _manager: UUID = Depends(require_project_manager),
) -> ApiResponse[LlmConnectionVerifyResult]:
    try:
        data = await LlmConnectionService(db).verify_project(
            project_id=project_id, connection_id=connection_id
        )
    except ConnectionNotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e)) from e
    except EndpointUrlError as e:  # the stored URL failed its re-vet
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from e
    await db.commit()
    return ApiResponse.success(data, trace_id=_trace_id(request))
