"""User-scope connections and the registry read (§4), mounted at ``/me``.

Auth + service call + error mapping + envelope, nothing else. Every row
is bound to the caller inside the service's WHERE clause
(``owned_user_connection``): a foreign id is a 404, never a leak.
``ConnectionUnavailableError`` (AppError) propagates to the typed 409.

A duplicate surfaces as a ``ValueError`` raised from a failed flush, so
the session is unusable until it is rolled back — every 400 path rolls
back before it raises, or the caller's next request on the same session
dies with the previous one's error.
"""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, status

from app.api.deps.security import get_current_user_sub
from app.core.deps import DbSession
from app.core.net_guard import EndpointUrlError
from app.schemas.common import ApiResponse
from app.schemas.llm_connection import (
    LlmConnectionDeleteResult,
    LlmConnectionRead,
    LlmConnectionUpdateRequest,
    LlmConnectionVerifyResult,
    ProviderRead,
    UserConnectionCreateRequest,
)
from app.services.llm_connection_service import (
    ConnectionNotFoundError,
    LlmConnectionService,
    provider_reads,
)
from app.utils.rate_limiter import limiter

router = APIRouter()


def _trace_id(request: Request) -> str | None:
    return getattr(request.state, "trace_id", None)


@router.get("/providers", response_model=ApiResponse[list[ProviderRead]])
@limiter.limit("60/minute")
async def list_providers(
    request: Request, _user: UUID = Depends(get_current_user_sub)
) -> ApiResponse[list[ProviderRead]]:
    return ApiResponse.success(provider_reads(), trace_id=_trace_id(request))


@router.get("/connections", response_model=ApiResponse[list[LlmConnectionRead]])
@limiter.limit("60/minute")
async def list_my_connections(
    request: Request, db: DbSession, user_id: UUID = Depends(get_current_user_sub)
) -> ApiResponse[list[LlmConnectionRead]]:
    data = await LlmConnectionService(db).list_user(user_id)
    return ApiResponse.success(data, trace_id=_trace_id(request))


@router.post(
    "/connections",
    response_model=ApiResponse[LlmConnectionRead],
    status_code=status.HTTP_201_CREATED,
)
@limiter.limit("20/minute")
async def create_my_connection(
    body: UserConnectionCreateRequest,
    request: Request,
    db: DbSession,
    user_id: UUID = Depends(get_current_user_sub),
) -> ApiResponse[LlmConnectionRead]:
    try:
        data = await LlmConnectionService(db).create_user(user_id=user_id, payload=body)
    except (EndpointUrlError, ValueError) as e:  # sanitized URL reason / duplicate label
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from e
    await db.commit()
    return ApiResponse.success(data, trace_id=_trace_id(request))


@router.put("/connections/{connection_id}", response_model=ApiResponse[LlmConnectionRead])
@limiter.limit("20/minute")
async def update_my_connection(
    connection_id: UUID,
    body: LlmConnectionUpdateRequest,
    request: Request,
    db: DbSession,
    user_id: UUID = Depends(get_current_user_sub),
) -> ApiResponse[LlmConnectionRead]:
    try:
        data = await LlmConnectionService(db).update_user(
            user_id=user_id, connection_id=connection_id, payload=body
        )
    except ConnectionNotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e)) from e
    except (EndpointUrlError, ValueError) as e:
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from e
    await db.commit()
    return ApiResponse.success(data, trace_id=_trace_id(request))


@router.delete(
    "/connections/{connection_id}", response_model=ApiResponse[LlmConnectionDeleteResult]
)
@limiter.limit("20/minute")
async def delete_my_connection(
    connection_id: UUID,
    request: Request,
    db: DbSession,
    user_id: UUID = Depends(get_current_user_sub),
) -> ApiResponse[LlmConnectionDeleteResult]:
    try:
        data = await LlmConnectionService(db).delete_user(
            user_id=user_id, connection_id=connection_id
        )
    except ConnectionNotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e)) from e
    await db.commit()
    return ApiResponse.success(data, trace_id=_trace_id(request))


@router.post(
    "/connections/{connection_id}/verify", response_model=ApiResponse[LlmConnectionVerifyResult]
)
@limiter.limit("30/minute")
async def verify_my_connection(
    connection_id: UUID,
    request: Request,
    db: DbSession,
    user_id: UUID = Depends(get_current_user_sub),
) -> ApiResponse[LlmConnectionVerifyResult]:
    try:
        data = await LlmConnectionService(db).verify_user(
            user_id=user_id, connection_id=connection_id
        )
    except ConnectionNotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e)) from e
    except EndpointUrlError as e:  # the stored URL failed its re-vet
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from e
    await db.commit()
    return ApiResponse.success(data, trace_id=_trace_id(request))
