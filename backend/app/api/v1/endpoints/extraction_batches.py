"""AI batch runs over many articles (spec 2026-09-15 §7).

The batch runs server-side: POST writes it and kicks
``advance_extraction_batch``; GETs derive its state from items and attempts.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import JSONResponse

from app.api.deps.security import ensure_project_reviewer, get_current_user_sub
from app.api.v1.endpoints.section_extraction import _is_queue_available
from app.core.deps import DbSession
from app.core.logging import get_logger
from app.schemas.common import ApiResponse
from app.schemas.extraction_batch import (
    CreateExtractionBatchRequest,
    ExtractionBatchDetail,
    ExtractionBatchSummary,
)
from app.services.extraction_batch_service import (
    BatchNotFoundError,
    BatchScopeError,
    ExtractionBatchService,
)
from app.services.llm_engine_service import resolve_engine
from app.utils.rate_limiter import limiter
from app.worker.tasks.extraction_batch_tasks import advance_extraction_batch

router = APIRouter()
logger = get_logger(__name__)


def _trace_id(request: Request) -> str:
    return getattr(request.state, "trace_id", None) or str(uuid.uuid4())


def _queue_unavailable(trace_id: str) -> JSONResponse:
    return JSONResponse(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        content=ApiResponse.failure(
            code="SERVICE_UNAVAILABLE",
            message="Background extraction queue is unavailable. Please try again later.",
            trace_id=trace_id,
        ).model_dump(),
    )


def _kick(batch_id: UUID, *, reenqueue_stale: bool = False) -> None:
    try:
        if reenqueue_stale:
            advance_extraction_batch.delay(str(batch_id), True)
        else:
            advance_extraction_batch.delay(str(batch_id))
    except Exception:
        # The rows are committed: the batch reads stalled and Resume recovers it.
        logger.exception("extraction_batch.kick_failed", batch_id=str(batch_id))


async def _detail(db: DbSession, owner_id: UUID, batch_id: UUID) -> ExtractionBatchDetail:
    try:
        return await ExtractionBatchService(db).detail(owner_id, batch_id, now=datetime.now(UTC))
    except BatchNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Batch not found") from exc


@router.post("", response_model=None, status_code=status.HTTP_202_ACCEPTED)
@limiter.limit("5/minute")
async def start_extraction_batch(
    request: Request,
    payload: CreateExtractionBatchRequest,
    db: DbSession,
    current_user_sub: UUID = Depends(get_current_user_sub),
) -> JSONResponse | ApiResponse[ExtractionBatchDetail]:
    trace_id = _trace_id(request)
    await ensure_project_reviewer(db, payload.project_id, current_user_sub)  # G1
    await resolve_engine(db, payload.project_id, current_user_sub)  # G5: typed 409s
    if not _is_queue_available():
        return _queue_unavailable(trace_id)
    try:
        batch_id = await ExtractionBatchService(db).create(current_user_sub, payload)
    except BatchScopeError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    _kick(batch_id)
    detail = await _detail(db, current_user_sub, batch_id)
    return JSONResponse(
        status_code=status.HTTP_202_ACCEPTED,
        content=ApiResponse.success(detail, trace_id=trace_id).model_dump(mode="json"),
    )


@router.get("")
@limiter.limit("60/minute")
async def list_extraction_batches(
    request: Request,
    db: DbSession,
    project_id: UUID | None = Query(default=None),
    active: bool = Query(default=False),
    current_user_sub: UUID = Depends(get_current_user_sub),
) -> ApiResponse[list[ExtractionBatchSummary]]:
    summaries = await ExtractionBatchService(db).list_for_owner(
        current_user_sub, project_id=project_id, active_only=active, now=datetime.now(UTC)
    )
    return ApiResponse.success(summaries, trace_id=_trace_id(request))


@router.get("/{batch_id}")
@limiter.limit("60/minute")
async def get_extraction_batch(
    request: Request,
    batch_id: UUID,
    db: DbSession,
    current_user_sub: UUID = Depends(get_current_user_sub),
) -> ApiResponse[ExtractionBatchDetail]:
    return ApiResponse.success(
        await _detail(db, current_user_sub, batch_id), trace_id=_trace_id(request)
    )


@router.post("/{batch_id}/cancel")
@limiter.limit("20/minute")
async def cancel_extraction_batch(
    request: Request,
    batch_id: UUID,
    db: DbSession,
    current_user_sub: UUID = Depends(get_current_user_sub),
) -> ApiResponse[ExtractionBatchDetail]:
    try:
        await ExtractionBatchService(db).cancel(current_user_sub, batch_id, now=datetime.now(UTC))
    except BatchNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Batch not found") from exc
    return ApiResponse.success(
        await _detail(db, current_user_sub, batch_id), trace_id=_trace_id(request)
    )


@router.post("/{batch_id}/resume", response_model=None)
@limiter.limit("20/minute")
async def resume_extraction_batch(
    request: Request,
    batch_id: UUID,
    db: DbSession,
    current_user_sub: UUID = Depends(get_current_user_sub),
) -> JSONResponse | ApiResponse[ExtractionBatchDetail]:
    trace_id = _trace_id(request)
    detail = await _detail(db, current_user_sub, batch_id)
    if not _is_queue_available():
        return _queue_unavailable(trace_id)
    _kick(batch_id, reenqueue_stale=True)
    return ApiResponse.success(detail, trace_id=trace_id)
