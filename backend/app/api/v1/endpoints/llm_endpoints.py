"""Project-scoped custom LLM endpoint management (§C2, B6).

Manager-only CRUD + verify over ``project_llm_endpoints``. Route bodies
are auth + service call + error mapping + envelope, nothing else — every
query and all key handling live in :class:`LlmEndpointService`.

Error contract:

- ``EndpointUrlError`` (a ``ValueError``) → 400; its ``str`` is already
  sanitized (reason class + host, never resolver/library text).
- ``EndpointNotFoundError`` → 404 (a cross-project id is a miss, BOLA).
- ``EndpointUnavailableError`` is an ``AppError`` and deliberately NOT
  caught: the registered handler serves its typed 409 envelope (the
  ``EngineRetiredError`` pattern).

DELETE returns 200 + ``ApiResponse[LlmEndpointDeleteResult]`` (plan
decision 15 — a 204 would break the envelope gate). Mutating routes
commit after the service call, mirroring the llm-engine PUT.
"""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, status

from app.api.deps.security import require_project_manager
from app.core.deps import DbSession
from app.core.net_guard import EndpointUrlError
from app.schemas.common import ApiResponse
from app.schemas.llm_endpoint import (
    LlmEndpointCreateRequest,
    LlmEndpointDeleteResult,
    LlmEndpointProbeResult,
    LlmEndpointRead,
    LlmEndpointUpdateRequest,
)
from app.services.llm_endpoint_service import (
    EndpointNotFoundError,
    LlmEndpointService,
    ProjectNotFoundError,
)
from app.utils.rate_limiter import limiter

router = APIRouter()


@router.get(
    "/{project_id}/llm-endpoints",
    response_model=ApiResponse[list[LlmEndpointRead]],
)
@limiter.limit("60/minute")
async def list_llm_endpoints(
    project_id: UUID,
    request: Request,
    db: DbSession,
    _manager: UUID = Depends(require_project_manager),
) -> ApiResponse[list[LlmEndpointRead]]:
    """Every endpoint of the project — the manager management surface."""
    trace_id = getattr(request.state, "trace_id", None)
    data = await LlmEndpointService(db).list_for_project(project_id)
    return ApiResponse.success(data, trace_id=trace_id)


@router.post(
    "/{project_id}/llm-endpoints",
    response_model=ApiResponse[LlmEndpointRead],
    status_code=status.HTTP_201_CREATED,
)
@limiter.limit("20/minute")
async def create_llm_endpoint(
    project_id: UUID,
    body: LlmEndpointCreateRequest,
    request: Request,
    db: DbSession,
    manager_id: UUID = Depends(require_project_manager),
) -> ApiResponse[LlmEndpointRead]:
    """Register an endpoint (URL vetted, key encrypted service-side)."""
    trace_id = getattr(request.state, "trace_id", None)
    try:
        data = await LlmEndpointService(db).create(
            project_id=project_id, created_by=manager_id, payload=body
        )
    except EndpointUrlError as e:  # sanitized by construction
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from e
    except ValueError as e:  # duplicate label pre-check
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from e
    await db.commit()
    return ApiResponse.success(data, trace_id=trace_id)


@router.put(
    "/{project_id}/llm-endpoints/{endpoint_id}",
    response_model=ApiResponse[LlmEndpointRead],
)
@limiter.limit("20/minute")
async def update_llm_endpoint(
    project_id: UUID,
    endpoint_id: UUID,
    body: LlmEndpointUpdateRequest,
    request: Request,
    db: DbSession,
    _manager: UUID = Depends(require_project_manager),
) -> ApiResponse[LlmEndpointRead]:
    """Full-replace update; ``api_key`` tri-state is applied service-side."""
    trace_id = getattr(request.state, "trace_id", None)
    try:
        data = await LlmEndpointService(db).update(
            project_id=project_id, endpoint_id=endpoint_id, payload=body
        )
    except EndpointNotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e)) from e
    except EndpointUrlError as e:  # sanitized by construction
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from e
    await db.commit()
    return ApiResponse.success(data, trace_id=trace_id)


@router.delete(
    "/{project_id}/llm-endpoints/{endpoint_id}",
    response_model=ApiResponse[LlmEndpointDeleteResult],
)
@limiter.limit("20/minute")
async def delete_llm_endpoint(
    project_id: UUID,
    endpoint_id: UUID,
    request: Request,
    db: DbSession,
    _manager: UUID = Depends(require_project_manager),
) -> ApiResponse[LlmEndpointDeleteResult]:
    """Delete the endpoint — 200 + typed result (decision 15, never 204).

    ``EndpointUnavailableError`` (the project engine still points here)
    propagates to the AppError handler's 409 envelope.
    """
    trace_id = getattr(request.state, "trace_id", None)
    try:
        data = await LlmEndpointService(db).delete(project_id=project_id, endpoint_id=endpoint_id)
    except (ProjectNotFoundError, EndpointNotFoundError) as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e)) from e
    await db.commit()
    return ApiResponse.success(data, trace_id=trace_id)


@router.post(
    "/{project_id}/llm-endpoints/{endpoint_id}/verify",
    response_model=ApiResponse[LlmEndpointProbeResult],
)
@limiter.limit("30/minute")
async def verify_llm_endpoint(
    project_id: UUID,
    endpoint_id: UUID,
    request: Request,
    db: DbSession,
    _manager: UUID = Depends(require_project_manager),
) -> ApiResponse[LlmEndpointProbeResult]:
    """Run the capabilities probe and persist its outcome (commit after the
    service call — the llm-engine PUT pattern).

    ``EndpointUnavailableError`` (stored key no longer decrypts) propagates
    to the AppError handler's 409 envelope.
    """
    trace_id = getattr(request.state, "trace_id", None)
    try:
        data = await LlmEndpointService(db).verify(project_id=project_id, endpoint_id=endpoint_id)
    except EndpointNotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e)) from e
    except EndpointUrlError as e:  # the stored URL failed its re-vet
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from e
    await db.commit()
    return ApiResponse.success(data, trace_id=trace_id)
