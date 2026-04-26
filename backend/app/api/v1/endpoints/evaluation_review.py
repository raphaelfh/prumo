"""Unified evaluation review endpoints."""

import uuid
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request

from app.api.deps.security import get_current_user_sub
from app.core.deps import DbSession
from app.schemas.common import ApiResponse
from app.schemas.evaluation_review import (
    CreateReviewerDecisionRequest,
    ReviewQueueResponse,
    ReviewerDecisionResponse,
)
from app.services.evaluation_review_service import EvaluationReviewService
from app.utils.rate_limiter import limiter

router = APIRouter()


@router.get("/review-queue", response_model=ApiResponse)
@limiter.limit("60/minute")
async def get_review_queue(
    request: Request,  # noqa: ARG001
    db: DbSession,
    user_id: UUID = Depends(get_current_user_sub),
    run_id: UUID | None = Query(default=None, alias="runId"),
    status: str | None = Query(default=None),
) -> ApiResponse:
    trace_id = str(uuid.uuid4())
    service = EvaluationReviewService(db=db, user_id=user_id, trace_id=trace_id)
    items = await service.list_review_queue(run_id=run_id, status=status)
    return ApiResponse.success(ReviewQueueResponse(items=items).model_dump(), trace_id=trace_id)


@router.post("/reviewer-decisions", response_model=ApiResponse, status_code=201)
@limiter.limit("40/minute")
async def create_reviewer_decision(
    request: Request,  # noqa: ARG001
    payload: CreateReviewerDecisionRequest,
    db: DbSession,
    user_id: UUID = Depends(get_current_user_sub),
) -> ApiResponse:
    trace_id = str(uuid.uuid4())
    service = EvaluationReviewService(db=db, user_id=user_id, trace_id=trace_id)
    decision = await service.submit_decision(payload)
    return ApiResponse.success(ReviewerDecisionResponse.model_validate(decision).model_dump(), trace_id=trace_id)
