"""Unified evaluation consensus endpoints."""

import uuid
from uuid import UUID

from fastapi import APIRouter, Depends, Request

from app.api.deps.security import get_current_user_sub
from app.core.deps import DbSession, SupabaseClient
from app.schemas.common import ApiResponse
from app.schemas.evaluation_consensus import (
    CreateConsensusDecisionRequest,
    CreateEvidenceUploadRequest,
    PublishedStateResponse,
)
from app.services.evaluation_consensus_service import EvaluationConsensusService
from app.services.evaluation_evidence_service import EvaluationEvidenceService
from app.utils.rate_limiter import limiter

router = APIRouter()


@router.post("/consensus-decisions", response_model=ApiResponse, status_code=201)
@limiter.limit("30/minute")
async def create_consensus_decision(
    request: Request,  # noqa: ARG001
    payload: CreateConsensusDecisionRequest,
    db: DbSession,
    user_id: UUID = Depends(get_current_user_sub),
) -> ApiResponse:
    trace_id = str(uuid.uuid4())
    service = EvaluationConsensusService(db=db, user_id=user_id, trace_id=trace_id)
    published = await service.publish(payload)
    return ApiResponse.success(PublishedStateResponse.model_validate(published).model_dump(), trace_id=trace_id)


@router.post("/evidence-attachments/presign", response_model=ApiResponse)
@limiter.limit("60/minute")
async def create_evidence_upload_url(
    request: Request,  # noqa: ARG001
    payload: CreateEvidenceUploadRequest,
    db: DbSession,
    supabase: SupabaseClient,
    user_id: UUID = Depends(get_current_user_sub),
) -> ApiResponse:
    trace_id = str(uuid.uuid4())
    service = EvaluationEvidenceService(db=db, user_id=user_id, trace_id=trace_id, supabase=supabase)
    response = await service.create_upload_url(payload)
    return ApiResponse.success(response.model_dump(mode="json"), trace_id=trace_id)
