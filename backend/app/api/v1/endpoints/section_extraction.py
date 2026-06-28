"""Section Extraction Endpoint.

Async endpoint for AI-assisted section extraction. Dispatches work to
the ``run_section_extraction_task`` Celery task and returns 202+job_id.
A companion GET endpoint lets callers poll for the result.

Pattern mirrors ``extraction_export.py`` (queue guard, Redis owner record,
AsyncResult state mapping).
"""

from __future__ import annotations

import contextlib
import uuid
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import JSONResponse
from redis import Redis

from app.api.deps.security import ensure_project_member, get_current_user_sub
from app.core.deps import CurrentUser, DbSession
from app.core.logging import get_logger
from app.schemas.common import ApiResponse
from app.schemas.extraction import (
    ExtractionErrorCode,
    ExtractionJobResult,
    ExtractionJobStartedResponse,
    ExtractionJobStatusResponse,
    SectionExtractionRequest,
)
from app.services.extraction_run_read_service import RunNotFoundError, get_run_or_raise
from app.utils.rate_limiter import limiter
from app.worker.celery_app import REDIS_URL
from app.worker.tasks.extraction_tasks import run_section_extraction_task

router = APIRouter()
logger = get_logger(__name__)

#: Redis owner-record TTL (matches Celery result_expires).
_SECTION_JOB_OWNER_KEY_PREFIX = "section_extraction_owner:"
_SECTION_JOB_OWNER_TTL_SECONDS = 3600


# ----------------------------------------------------------------------
# Redis helpers
# ----------------------------------------------------------------------


def _is_queue_available() -> bool:
    try:
        Redis.from_url(
            REDIS_URL,
            socket_connect_timeout=0.25,
            socket_timeout=0.25,
        ).ping()
        return True
    except Exception:
        return False


def _remember_job_owner(job_id: str, user_id: str) -> None:
    with contextlib.suppress(Exception):
        Redis.from_url(
            REDIS_URL,
            socket_connect_timeout=0.5,
            socket_timeout=0.5,
        ).set(
            f"{_SECTION_JOB_OWNER_KEY_PREFIX}{job_id}",
            user_id,
            ex=_SECTION_JOB_OWNER_TTL_SECONDS,
        )


def _lookup_job_owner(job_id: str) -> str | None:
    raw: object = None
    with contextlib.suppress(Exception):
        raw = Redis.from_url(
            REDIS_URL,
            socket_connect_timeout=0.5,
            socket_timeout=0.5,
        ).get(f"{_SECTION_JOB_OWNER_KEY_PREFIX}{job_id}")
    if raw is None:
        return None
    if isinstance(raw, bytes):
        return raw.decode("utf-8", errors="replace")
    return str(raw)


def _failure_error_code(exc: object) -> ExtractionErrorCode:
    """Recover the failure's machine-readable code from the AsyncResult.

    ``run_section_extraction_task`` raises ``ExtractionTaskError`` carrying a
    string ``error_code`` (it survives the Celery JSON round-trip via the
    exception args). Read it duck-typed and coerce to the enum, defaulting any
    missing / unknown code to ``EXTRACTION_FAILED`` so serialization never
    fails on a future or untyped error.
    """
    raw = getattr(exc, "error_code", None)
    if isinstance(raw, str):
        try:
            return ExtractionErrorCode(raw)
        except ValueError:
            return ExtractionErrorCode.EXTRACTION_FAILED
    return ExtractionErrorCode.EXTRACTION_FAILED


# ----------------------------------------------------------------------
# BOLA scope helper (unchanged from sync version)
# ----------------------------------------------------------------------


async def _check_request_scope(
    db: DbSession,
    payload: SectionExtractionRequest,
    current_user_sub: UUID,
) -> None:
    if payload.run_id is None:
        await ensure_project_member(db, payload.project_id, current_user_sub)
        return

    try:
        run = await get_run_or_raise(db, payload.run_id)
    except RunNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

    await ensure_project_member(db, run.project_id, current_user_sub)
    if (
        payload.project_id != run.project_id
        or payload.article_id != run.article_id
        or payload.template_id != run.template_id
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="runId does not match projectId, articleId, and templateId",
        )


# ======================================================================
# POST /api/v1/extraction/sections  — dispatch to Celery
# ======================================================================


@router.post(
    "",
    response_model=None,
    summary="Queue section extraction (async)",
    status_code=status.HTTP_202_ACCEPTED,
)
@limiter.limit("10/minute")
async def extract_section(
    request: Request,
    payload: SectionExtractionRequest,
    db: DbSession,
    user: CurrentUser,
    current_user_sub: UUID = Depends(get_current_user_sub),
) -> JSONResponse | ApiResponse[ExtractionJobStartedResponse]:
    """Validate, authorise, then enqueue ``run_section_extraction_task``.

    Returns 202 with ``{job_id}``; poll
    ``GET /extraction/sections/status/{job_id}`` for the result.
    """
    trace_id = getattr(request.state, "trace_id", None) or str(uuid.uuid4())

    await _check_request_scope(db, payload, current_user_sub)

    if not _is_queue_available():
        return JSONResponse(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            content=ApiResponse.failure(
                code="SERVICE_UNAVAILABLE",
                message="Background extraction queue is unavailable. Please try again later.",
                trace_id=trace_id,
            ).model_dump(),
        )

    logger.info(
        "section_extraction_queued",
        trace_id=trace_id,
        user_id=user.sub,
        project_id=str(payload.project_id),
        article_id=str(payload.article_id),
        template_id=str(payload.template_id),
        entity_type_id=str(payload.entity_type_id) if payload.entity_type_id else None,
        extract_all_sections=payload.extract_all_sections,
        model=payload.model,
    )

    task = run_section_extraction_task.delay(
        payload.model_dump(mode="json"),
        user.sub,
        trace_id,
    )

    _remember_job_owner(task.id, user.sub)

    return JSONResponse(
        status_code=status.HTTP_202_ACCEPTED,
        content=ApiResponse.success(
            data=ExtractionJobStartedResponse(job_id=task.id),
            trace_id=trace_id,
        ).model_dump(),
    )


# ======================================================================
# GET /api/v1/extraction/sections/status/{job_id}  — poll result
# ======================================================================


@router.get(
    "/status/{job_id}",
    response_model=ApiResponse[ExtractionJobStatusResponse],
    summary="Poll async section extraction status",
)
@limiter.limit("30/minute")
async def get_section_extraction_status(
    request: Request,
    job_id: str,
    user: CurrentUser,
) -> ApiResponse[ExtractionJobStatusResponse]:
    """Map the Celery AsyncResult state into the API envelope shape.

    Ownership gate fires before any state-dependent branch: every branch
    leaks task state (and FAILURE leaks the exception repr), so a caller
    who guesses a valid ``job_id`` must not read another user's progress.
    """
    from celery.result import AsyncResult

    from app.worker.celery_app import celery_app

    trace_id = getattr(request.state, "trace_id", None) or str(uuid.uuid4())

    # Typed Any: celery's AsyncResult.state is a narrow Literal union, which
    # makes mypy flag the later `state == "REVOKED"` branch as a non-overlapping
    # comparison; treat the untyped celery result loosely here.
    result: Any = AsyncResult(job_id, app=celery_app)
    state = result.state

    # Ownership gate — Redis record is authoritative; fall back to
    # user_id embedded in the SUCCESS payload when the TTL has expired.
    owner = _lookup_job_owner(job_id)
    if owner is None and state == "SUCCESS" and isinstance(result.result, dict):
        owner = result.result.get("user_id")

    if owner is None:
        return ApiResponse.failure(
            code="NOT_FOUND",
            message="Job not found or expired.",
            trace_id=trace_id,
        )
    if owner != user.sub:
        return ApiResponse.failure(
            code="FORBIDDEN",
            message="Job does not belong to current user.",
            trace_id=trace_id,
        )

    if state == "PENDING":
        return ApiResponse.success(
            data=ExtractionJobStatusResponse(job_id=job_id, status="pending"),
            trace_id=trace_id,
        )
    if state in ("STARTED", "RETRY"):
        return ApiResponse.success(
            data=ExtractionJobStatusResponse(job_id=job_id, status="running"),
            trace_id=trace_id,
        )
    if state == "FAILURE":
        exc = result.result
        return ApiResponse.success(
            data=ExtractionJobStatusResponse(
                job_id=job_id,
                status="failed",
                error=str(exc) if exc else "Task failed.",
                error_code=_failure_error_code(exc),
            ),
            trace_id=trace_id,
        )
    if state == "SUCCESS" and isinstance(result.result, dict):
        raw = result.result
        job_result = ExtractionJobResult(
            mode=raw.get("mode", "single"),
            extractionRunId=raw.get("extraction_run_id", ""),
            suggestionsCreated=raw.get("suggestions_created"),
            entityTypeId=raw.get("entity_type_id"),
            totalSections=raw.get("total_sections"),
            successfulSections=raw.get("successful_sections"),
            failedSections=raw.get("failed_sections"),
            totalSuggestionsCreated=raw.get("total_suggestions_created"),
            sections=raw.get("sections"),
        )
        return ApiResponse.success(
            data=ExtractionJobStatusResponse(job_id=job_id, status="completed", result=job_result),
            trace_id=trace_id,
        )
    if state == "REVOKED":
        return ApiResponse.success(
            data=ExtractionJobStatusResponse(job_id=job_id, status="cancelled"),
            trace_id=trace_id,
        )
    return ApiResponse.success(
        data=ExtractionJobStatusResponse(
            job_id=job_id, status=state.lower() if state else "pending"
        ),
        trace_id=trace_id,
    )
