"""Unified evaluation schema version endpoints."""

import uuid
from uuid import UUID

from fastapi import APIRouter, Depends, Request

from app.api.deps.security import get_current_user_sub
from app.core.deps import DbSession
from app.schemas.common import ApiResponse
from app.schemas.evaluation_schema_versions import (
    CreateEvaluationSchemaVersionRequest,
    EvaluationSchemaVersionResponse,
)
from app.services.evaluation_schema_version_service import EvaluationSchemaVersionService
from app.utils.rate_limiter import limiter

router = APIRouter()


@router.post("/evaluation-schema-versions", response_model=ApiResponse, status_code=201)
@limiter.limit("20/minute")
async def create_schema_version(
    request: Request,  # noqa: ARG001
    payload: CreateEvaluationSchemaVersionRequest,
    db: DbSession,
    user_id: UUID = Depends(get_current_user_sub),
) -> ApiResponse:
    trace_id = str(uuid.uuid4())
    service = EvaluationSchemaVersionService(db=db, user_id=user_id, trace_id=trace_id)
    version = await service.create_draft(payload.schema_id)
    return ApiResponse.success(EvaluationSchemaVersionResponse.model_validate(version).model_dump(), trace_id=trace_id)


@router.post("/evaluation-schema-versions/{version_id}/publish", response_model=ApiResponse)
@limiter.limit("20/minute")
async def publish_schema_version(
    request: Request,  # noqa: ARG001
    version_id: UUID,
    db: DbSession,
    user_id: UUID = Depends(get_current_user_sub),
) -> ApiResponse:
    trace_id = str(uuid.uuid4())
    service = EvaluationSchemaVersionService(db=db, user_id=user_id, trace_id=trace_id)
    version = await service.publish(version_id)
    return ApiResponse.success(EvaluationSchemaVersionResponse.model_validate(version).model_dump(), trace_id=trace_id)
