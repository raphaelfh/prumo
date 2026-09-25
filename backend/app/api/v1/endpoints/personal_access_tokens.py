"""Personal access token issuance, listing and revocation, mounted at ``/me``.

JWT-only routes: a PAT never mints a PAT (ADR 0020). Ownership is proven by
``pat_service.owned_token`` inside the service, never re-checked here — a
foreign or missing token id is a single 404, no existence oracle.
"""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, status

from app.api.deps.security import get_current_user_sub
from app.core.deps import DbSession
from app.schemas.common import ApiResponse
from app.schemas.personal_access_token import (
    PersonalAccessTokenCreated,
    PersonalAccessTokenCreateRequest,
    PersonalAccessTokenRead,
    PersonalAccessTokenRefusalResponse,
)
from app.services.pat_service import (
    TokenNotFoundError,
    create_token,
    list_tokens,
    revoke_token,
)
from app.utils.rate_limiter import limiter

router = APIRouter()


def _trace_id(request: Request) -> str | None:
    return getattr(request.state, "trace_id", None)


@router.post(
    "/tokens",
    response_model=ApiResponse[PersonalAccessTokenCreated],
    status_code=status.HTTP_201_CREATED,
    responses={
        401: {"description": "Missing or invalid Supabase session"},
        409: {
            "model": PersonalAccessTokenRefusalResponse,
            "description": "Refused: 10 active tokens is the limit",
        },
        422: {"description": "Invalid name, scope or expires_in_days"},
    },
)
@limiter.limit("20/minute")
async def create_my_token(
    body: PersonalAccessTokenCreateRequest,
    request: Request,
    db: DbSession,
    user_id: UUID = Depends(get_current_user_sub),
) -> ApiResponse[PersonalAccessTokenCreated]:
    # TokenLimitReachedError propagates: the AppError handler turns it into the typed 409.
    data = await create_token(db, user_id=user_id, payload=body)
    await db.commit()
    return ApiResponse.success(data, trace_id=_trace_id(request))


@router.get(
    "/tokens",
    response_model=ApiResponse[list[PersonalAccessTokenRead]],
    responses={401: {"description": "Missing or invalid Supabase session"}},
)
@limiter.limit("60/minute")
async def list_my_tokens(
    request: Request,
    db: DbSession,
    user_id: UUID = Depends(get_current_user_sub),
) -> ApiResponse[list[PersonalAccessTokenRead]]:
    data = await list_tokens(db, user_id=user_id)
    return ApiResponse.success(data, trace_id=_trace_id(request))


@router.delete(
    "/tokens/{token_id}",
    response_model=ApiResponse[PersonalAccessTokenRead],
    responses={
        401: {"description": "Missing or invalid Supabase session"},
        404: {"description": "Token not found"},
    },
)
@limiter.limit("20/minute")
async def revoke_my_token(
    token_id: UUID,
    request: Request,
    db: DbSession,
    user_id: UUID = Depends(get_current_user_sub),
) -> ApiResponse[PersonalAccessTokenRead]:
    try:
        data = await revoke_token(db, user_id=user_id, token_id=token_id)
    except TokenNotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Token not found") from e
    await db.commit()
    return ApiResponse.success(data, trace_id=_trace_id(request))
