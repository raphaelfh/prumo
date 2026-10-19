"""The OAuth consent routes, mounted at ``/oauth`` (ADR 0022).

JWT-only: the signed-in consent page reads a pending authorization request
and records the user's decision. The request id is a uuid4 capability; the
user binds to it only at decision time, from the JWT. Always mounted, so the
OpenAPI schema does not depend on the environment: with OAuth off, both
routes answer 404. The global handler maps the service's refusals (404
unknown/expired, 409 already decided).
"""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, Request

from app.api.deps.security import get_current_user_sub
from app.core.config import settings
from app.core.deps import DbSession
from app.schemas.common import ApiResponse
from app.schemas.mcp_oauth import (
    OAuthConsentDecisionRead,
    OAuthConsentDecisionRequest,
    OAuthConsentRefusalResponse,
    OAuthConsentRequestRead,
)
from app.services.mcp_oauth_service import (
    ConsentRequestNotFoundError,
    decide_request,
    get_consent_request,
)
from app.utils.rate_limiter import limiter

router = APIRouter()


def _trace_id(request: Request) -> str | None:
    return getattr(request.state, "trace_id", None)


@router.get(
    "/requests/{request_id}",
    response_model=ApiResponse[OAuthConsentRequestRead],
    dependencies=[Depends(get_current_user_sub)],
    responses={
        401: {"description": "Missing or invalid Supabase session"},
        404: {"description": "Unknown or expired request, or OAuth is off"},
        409: {
            "model": OAuthConsentRefusalResponse,
            "description": "Refused: the request was already answered",
        },
        422: {"description": "Malformed request id"},
        429: {"description": "Too many requests"},
    },
)
@limiter.limit("60/minute")
async def read_consent_request(
    request_id: UUID,
    request: Request,
    db: DbSession,
) -> ApiResponse[OAuthConsentRequestRead]:
    if not settings.oauth_enabled:
        raise ConsentRequestNotFoundError()
    data = await get_consent_request(db, request_id=request_id)
    return ApiResponse.success(data, trace_id=_trace_id(request))


@router.post(
    "/requests/{request_id}/decision",
    response_model=ApiResponse[OAuthConsentDecisionRead],
    responses={
        401: {"description": "Missing or invalid Supabase session"},
        404: {"description": "Unknown or expired request, or OAuth is off"},
        409: {
            "model": OAuthConsentRefusalResponse,
            "description": "Refused: the request was already answered",
        },
        422: {"description": "Malformed request id or body"},
        429: {"description": "Too many requests"},
    },
)
@limiter.limit("20/minute")
async def decide_consent_request(
    request_id: UUID,
    body: OAuthConsentDecisionRequest,
    request: Request,
    db: DbSession,
    user_id: UUID = Depends(get_current_user_sub),
) -> ApiResponse[OAuthConsentDecisionRead]:
    if not settings.oauth_enabled:
        raise ConsentRequestNotFoundError()
    redirect_url = await decide_request(
        db,
        request_id=request_id,
        user_id=user_id,
        approve=body.approve,
        write=body.write,
        ai_run=body.ai_run,
    )
    await db.commit()
    return ApiResponse.success(
        OAuthConsentDecisionRead(redirect_url=redirect_url), trace_id=_trace_id(request)
    )
