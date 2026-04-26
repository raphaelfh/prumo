"""Unified evaluation run endpoints."""

import uuid
from uuid import UUID

from fastapi import APIRouter, Depends, Request

from app.api.deps.security import get_current_user_sub
from app.core.deps import DbSession
from app.schemas.common import ApiResponse
from app.schemas.evaluation_runs import (
    AsyncAcceptedData,
    CreateEvaluationRunRequest,
    EvaluationRunResponse,
)
from app.services.evaluation_proposal_service import EvaluationProposalService
from app.services.evaluation_run_service import EvaluationRunService
from app.utils.rate_limiter import limiter

router = APIRouter()


@router.post("", response_model=ApiResponse, status_code=201)
@limiter.limit("20/minute")
async def create_evaluation_run(
    request: Request,  # noqa: ARG001
    payload: CreateEvaluationRunRequest,
    db: DbSession,
    user_id: UUID = Depends(get_current_user_sub),
) -> ApiResponse:
    trace_id = str(uuid.uuid4())
    service = EvaluationRunService(db=db, user_id=user_id, trace_id=trace_id)
    run = await service.create_run(payload)
    return ApiResponse.success(EvaluationRunResponse.model_validate(run).model_dump(), trace_id=trace_id)


@router.get("/{run_id}", response_model=ApiResponse)
@limiter.limit("60/minute")
async def get_evaluation_run(
    request: Request,  # noqa: ARG001
    run_id: UUID,
    db: DbSession,
    user_id: UUID = Depends(get_current_user_sub),
) -> ApiResponse:
    trace_id = str(uuid.uuid4())
    service = EvaluationRunService(db=db, user_id=user_id, trace_id=trace_id)
    run = await service.get_run_or_404(run_id)
    return ApiResponse.success(EvaluationRunResponse.model_validate(run).model_dump(), trace_id=trace_id)


@router.post("/{run_id}/proposal-generation", response_model=ApiResponse, status_code=202)
@limiter.limit("20/minute")
async def trigger_proposal_generation(
    request: Request,  # noqa: ARG001
    run_id: UUID,
    db: DbSession,
    user_id: UUID = Depends(get_current_user_sub),
) -> ApiResponse:
    trace_id = str(uuid.uuid4())
    service = EvaluationProposalService(db=db, user_id=user_id, trace_id=trace_id)
    await service.kickoff_for_run(run_id)
    return ApiResponse.success(AsyncAcceptedData().model_dump(), trace_id=trace_id)
