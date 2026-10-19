"""AI batch runs over many articles (spec 2026-09-15 §7).

The batch runs server-side: POST writes it through the one start path,
commits, then kicks the dispatcher; GETs derive its state from items and
attempts.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import JSONResponse

from app.api.deps.security import ensure_project_reviewer, get_current_user_sub
from app.core.deps import DbSession
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
    QueueUnavailableError,
)
from app.utils.rate_limiter import limiter
from app.worker import queue_health
from app.worker.tasks.extraction_batch_tasks import kick_batch

router = APIRouter()


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


async def _detail(db: DbSession, owner_id: UUID, batch_id: UUID) -> ExtractionBatchDetail:
    try:
        return await ExtractionBatchService(db).detail(owner_id, batch_id, now=datetime.now(UTC))
    except BatchNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Batch not found") from exc


@router.post(
    "",
    response_model=ApiResponse[ExtractionBatchDetail],
    status_code=status.HTTP_202_ACCEPTED,
)
@limiter.limit("5/minute")
async def start_extraction_batch(
    request: Request,
    payload: CreateExtractionBatchRequest,
    db: DbSession,
    current_user_sub: UUID = Depends(get_current_user_sub),
) -> JSONResponse | ApiResponse[ExtractionBatchDetail]:
    trace_id = _trace_id(request)
    await ensure_project_reviewer(db, payload.project_id, current_user_sub)
    try:
        started = await ExtractionBatchService(db).start(current_user_sub, payload)
    except QueueUnavailableError:
        return _queue_unavailable(trace_id)
    except BatchScopeError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    await db.commit()
    kick_batch(started.batch_id)
    detail = await _detail(db, current_user_sub, started.batch_id)
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
    await db.commit()
    return ApiResponse.success(
        await _detail(db, current_user_sub, batch_id), trace_id=_trace_id(request)
    )


@router.post("/{batch_id}/resume", response_model=ApiResponse[ExtractionBatchDetail])
@limiter.limit("20/minute")
async def resume_extraction_batch(
    request: Request,
    batch_id: UUID,
    db: DbSession,
    current_user_sub: UUID = Depends(get_current_user_sub),
) -> JSONResponse | ApiResponse[ExtractionBatchDetail]:
    trace_id = _trace_id(request)
    detail = await _detail(db, current_user_sub, batch_id)
    if not queue_health.is_queue_available():
        return _queue_unavailable(trace_id)
    kick_batch(batch_id, reenqueue_stale=True)
    return ApiResponse.success(detail, trace_id=trace_id)
