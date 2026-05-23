"""Extraction Export Endpoints.

Three async routes implementing the OpenAPI contract at
`specs/009-extraction-excel-export/contracts/extraction-export.openapi.yaml`:

    POST /api/v1/projects/{project_id}/extraction-export
    GET  /api/v1/projects/{project_id}/extraction-export/status/{job_id}
    POST /api/v1/projects/{project_id}/extraction-export/status/{job_id}/cancel

Pattern mirrors `articles_export` (sync inline blob for small payloads,
async Celery job + signed Storage URL otherwise). All responses use the
project-wide ``ApiResponse`` envelope.
"""

from __future__ import annotations

import asyncio
import contextlib
import uuid
from uuid import UUID

from fastapi import APIRouter, Request, Response, status
from fastapi.responses import JSONResponse
from redis import Redis

from app.core.deps import CurrentUser, DbSession, SupabaseClient
from app.core.error_handler import AuthorizationError, NotFoundError
from app.core.factories import create_storage_adapter
from app.core.logging import get_logger
from app.schemas.common import ApiResponse
from app.schemas.extraction_export import (
    ExtractionArticleScope,
    ExtractionExportCancelResponse,
    ExtractionExportMode,
    ExtractionExportRequest,
    ExtractionExportStartedResponse,
    ExtractionExportStatusResponse,
)
from app.services.exports.extraction_xlsx_builder import build_workbook
from app.services.extraction_export_service import (
    ExportMode,
    ExtractionExportService,
)
from app.utils.rate_limiter import limiter
from app.worker.celery_app import REDIS_URL
from app.worker.tasks.extraction_export_tasks import export_extraction_task

router = APIRouter()
logger = get_logger(__name__)

#: Sync delivery cutoff in articles. Above this — or when
#: ``include_ai_metadata`` is set, or when ``mode == all_users`` — the
#: endpoint pushes the job to Celery. Tuned to match
#: ``articles_export.SYNC_METADATA_ONLY_MAX_ARTICLES`` (research.md §3).
SYNC_EXPORT_MAX_ARTICLES = 50

_XLSX_MIME = (
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
)

#: Redis owner record TTL (matches Celery ``result_expires``).
_EXPORT_OWNER_KEY_PREFIX = "extraction_export_owner:"
_EXPORT_OWNER_TTL_SECONDS = 3600


# ----------------------------------------------------------------------
# Redis helpers — mirror articles_export so cancel/status can resolve
# ownership without trusting the caller-supplied job id alone.
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


def _remember_export_owner(job_id: str, user_id: str) -> None:
    with contextlib.suppress(Exception):
        Redis.from_url(
            REDIS_URL,
            socket_connect_timeout=0.5,
            socket_timeout=0.5,
        ).set(
            f"{_EXPORT_OWNER_KEY_PREFIX}{job_id}",
            user_id,
            ex=_EXPORT_OWNER_TTL_SECONDS,
        )


def _lookup_export_owner(job_id: str) -> str | None:
    raw: object = None
    with contextlib.suppress(Exception):
        raw = Redis.from_url(
            REDIS_URL,
            socket_connect_timeout=0.5,
            socket_timeout=0.5,
        ).get(f"{_EXPORT_OWNER_KEY_PREFIX}{job_id}")
    if raw is None:
        return None
    if isinstance(raw, bytes):
        return raw.decode("utf-8", errors="replace")
    return str(raw)


def _should_run_sync(payload: ExtractionExportRequest) -> bool:
    """Decide between sync inline delivery and async background job."""
    if payload.mode is ExtractionExportMode.ALL_USERS:
        return False
    if payload.include_ai_metadata:
        return False
    return len(payload.article_ids) <= SYNC_EXPORT_MAX_ARTICLES


# ----------------------------------------------------------------------
# Project name lookup (for filename + audit log)
# ----------------------------------------------------------------------


async def _resolve_project_name(db, project_id: UUID) -> str:
    """Best-effort project name for the filename. Falls back to short id."""
    from sqlalchemy import select

    from app.models.project import Project

    row = (
        await db.execute(select(Project.name).where(Project.id == project_id))
    ).first()
    if row and row[0]:
        return str(row[0])
    return str(project_id).split("-")[0]


async def _resolve_template_name(db, template_id: UUID) -> str:
    from sqlalchemy import select

    from app.models.extraction import ProjectExtractionTemplate

    row = (
        await db.execute(
            select(ProjectExtractionTemplate.name).where(
                ProjectExtractionTemplate.id == template_id
            )
        )
    ).first()
    if row and row[0]:
        return str(row[0])
    return str(template_id).split("-")[0]


# ======================================================================
# POST /projects/{project_id}/extraction-export
# ======================================================================


@router.post(
    "/{project_id}/extraction-export",
    response_model=None,
    summary="Start an extraction export",
)
@limiter.limit("10/minute")
async def start_extraction_export(
    request: Request,  # noqa: ARG001 — slowapi requirement
    project_id: UUID,
    payload: ExtractionExportRequest,
    db: DbSession,
    user: CurrentUser,
    supabase: SupabaseClient,
) -> Response:
    """Validate, authorise, then dispatch via sync or async path."""
    trace_id = request.headers.get("x-trace-id") or str(uuid.uuid4())

    # --- request coherence ------------------------------------------------
    if (
        payload.mode is ExtractionExportMode.SINGLE_USER
        and payload.reviewer_id is None
    ):
        return _envelope_failure(
            status.HTTP_400_BAD_REQUEST,
            code="VALIDATION_ERROR",
            message="reviewer_id is required when mode=single_user.",
            trace_id=trace_id,
        )
    if (
        payload.article_scope is ExtractionArticleScope.SELECTED_ONLY
        and not payload.article_ids
    ):
        return _envelope_failure(
            status.HTTP_400_BAD_REQUEST,
            code="VALIDATION_ERROR",
            message="article_ids cannot be empty when article_scope=selected_only.",
            trace_id=trace_id,
        )

    # --- service + auth gate ----------------------------------------------
    storage = create_storage_adapter(supabase)
    service = ExtractionExportService(
        db=db,
        user_id=user.sub,
        storage=storage,
        trace_id=trace_id,
    )

    try:
        await service.assert_can_export(
            project_id=project_id,
            mode=ExportMode(payload.mode.value),
            target_reviewer_id=payload.reviewer_id,
        )
    except AuthorizationError as exc:
        return _envelope_failure(
            status.HTTP_403_FORBIDDEN,
            code="FORBIDDEN",
            message=str(exc),
            trace_id=trace_id,
        )

    # --- structured audit log (FR-025) ------------------------------------
    logger.info(
        "extraction_export_started",
        actor=user.sub,
        project_id=str(project_id),
        mode=payload.mode.value,
        target_reviewer_id=str(payload.reviewer_id) if payload.reviewer_id else None,
        template_id=str(payload.template_id),
        article_count=len(payload.article_ids),
        article_scope=payload.article_scope.value,
        include_ai_metadata=payload.include_ai_metadata,
        anonymize_reviewer_names=payload.anonymize_reviewer_names,
        trace_id=trace_id,
    )

    # --- sync path --------------------------------------------------------
    if _should_run_sync(payload):
        try:
            layout = await service.resolve_layout(
                project_id=project_id,
                template_id=payload.template_id,
                mode=ExportMode(payload.mode.value),
                article_ids=payload.article_ids,
                include_ai_metadata=payload.include_ai_metadata,
                anonymize_reviewer_names=payload.anonymize_reviewer_names,
                reviewer_id=payload.reviewer_id,
            )
        except NotFoundError as exc:
            return _envelope_failure(
                status.HTTP_404_NOT_FOUND,
                code="NOT_FOUND",
                message=str(exc),
                trace_id=trace_id,
            )

        if not layout.articles:
            return _envelope_failure(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                code="EMPTY_ELIGIBLE_ARTICLES",
                message=(
                    "No eligible articles for the selected mode + scope. "
                    "Finalize at least one Run, then retry."
                ),
                trace_id=trace_id,
            )

        # Run the CPU-bound openpyxl writer off the event loop.
        data: bytes = await asyncio.to_thread(build_workbook, layout)

        project_name = await _resolve_project_name(db, project_id)
        filename = ExtractionExportService.format_filename(
            project_name=project_name,
            template_name=layout.template_name,
            mode=ExportMode(payload.mode.value),
            generated_at=layout.notes.generated_at,
        )

        return Response(
            content=data,
            media_type=_XLSX_MIME,
            headers={
                "Content-Disposition": f'attachment; filename="{filename}"',
                "Access-Control-Expose-Headers": "Content-Disposition,X-Trace-Id",
                "X-Trace-Id": trace_id,
            },
        )

    # --- async path -------------------------------------------------------
    if not _is_queue_available():
        return _envelope_failure(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            code="SERVICE_UNAVAILABLE",
            message=(
                "Background export queue is unavailable. Please start "
                "Redis/Celery and try again."
            ),
            trace_id=trace_id,
        )
    try:
        task = export_extraction_task.delay(
            project_id=str(project_id),
            template_id=str(payload.template_id),
            mode=payload.mode.value,
            article_ids=[str(aid) for aid in payload.article_ids],
            article_scope=payload.article_scope.value,
            user_id=user.sub,
            reviewer_id=(str(payload.reviewer_id) if payload.reviewer_id else None),
            include_ai_metadata=payload.include_ai_metadata,
            anonymize_reviewer_names=payload.anonymize_reviewer_names,
        )
    except Exception:
        return _envelope_failure(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            code="SERVICE_UNAVAILABLE",
            message=(
                "Background export queue is unavailable. Please start "
                "Redis/Celery and try again."
            ),
            trace_id=trace_id,
        )

    _remember_export_owner(task.id, user.sub)
    return JSONResponse(
        status_code=status.HTTP_202_ACCEPTED,
        content=ApiResponse.success(
            data=ExtractionExportStartedResponse(job_id=task.id),
            trace_id=trace_id,
        ).model_dump(),
    )


# ======================================================================
# GET /projects/{project_id}/extraction-export/reviewers
# ======================================================================


@router.get(
    "/{project_id}/extraction-export/reviewers",
    response_model=ApiResponse[list[dict]],
    summary="List reviewers with non-reject decisions for the picker (US2 / FR-028)",
)
@limiter.limit("30/minute")
async def list_extraction_export_reviewers(
    request: Request,
    project_id: UUID,
    template_id: UUID,
    db: DbSession,
    user: CurrentUser,
    supabase: SupabaseClient,
) -> ApiResponse[list[dict]]:
    """Return reviewers who have ≥ 1 non-reject decision on this template.

    Non-managers see only themselves (when they have decisions); managers
    see everyone. The dialog uses this to populate the picker.
    """
    trace_id = request.headers.get("x-trace-id") or str(uuid.uuid4())
    storage = create_storage_adapter(supabase)
    service = ExtractionExportService(
        db=db,
        user_id=user.sub,
        storage=storage,
        trace_id=trace_id,
    )

    # Membership gate (no manager requirement — the picker is read-only).
    try:
        await service.assert_can_export(
            project_id=project_id,
            mode=ExportMode.CONSENSUS,
            target_reviewer_id=None,
        )
    except AuthorizationError as exc:
        return ApiResponse.failure(
            code="FORBIDDEN", message=str(exc), trace_id=trace_id
        )

    reviewers = await service.list_reviewers_with_decisions(
        project_id=project_id, template_id=template_id
    )

    # Non-managers see only themselves.
    from app.models.project import ProjectMemberRole
    from app.repositories.project_repository import ProjectMemberRepository

    repo = ProjectMemberRepository(db)
    is_manager = await repo.has_role(
        project_id, UUID(user.sub), ProjectMemberRole.MANAGER
    )
    if not is_manager:
        reviewers = [r for r in reviewers if r["id"] == user.sub]

    return ApiResponse.success(data=reviewers, trace_id=trace_id)


# ======================================================================
# GET /projects/{project_id}/extraction-export/status/{job_id}
# ======================================================================


@router.get(
    "/{project_id}/extraction-export/status/{job_id}",
    response_model=ApiResponse[ExtractionExportStatusResponse],
    summary="Poll async extraction export status",
)
@limiter.limit("30/minute")
async def get_extraction_export_status(
    request: Request,
    project_id: UUID,  # noqa: ARG001 — kept for symmetry + future audit log
    job_id: str,
    user: CurrentUser,
) -> ApiResponse[ExtractionExportStatusResponse]:
    """Map the Celery AsyncResult state into the API envelope shape."""
    from celery.result import AsyncResult

    from app.worker.celery_app import celery_app

    trace_id = request.headers.get("x-trace-id") or str(uuid.uuid4())

    result = AsyncResult(job_id, app=celery_app)
    state = result.state

    # PENDING + no owner record == job never enqueued or fully expired.
    if state == "PENDING" and _lookup_export_owner(job_id) is None:
        return ApiResponse.failure(
            code="NOT_FOUND",
            message="Job not found or expired.",
            trace_id=trace_id,
        )

    if state == "PENDING":
        return ApiResponse.success(
            data=ExtractionExportStatusResponse(job_id=job_id, status="pending"),
            trace_id=trace_id,
        )
    if state in ("STARTED", "RETRY"):
        return ApiResponse.success(
            data=ExtractionExportStatusResponse(job_id=job_id, status="running"),
            trace_id=trace_id,
        )
    if state == "FAILURE":
        return ApiResponse.success(
            data=ExtractionExportStatusResponse(
                job_id=job_id,
                status="failed",
                error=str(result.result) if result.result else "Task failed.",
            ),
            trace_id=trace_id,
        )
    if state == "SUCCESS" and result.result:
        data = result.result
        if isinstance(data, dict) and data.get("user_id") != user.sub:
            return ApiResponse.failure(
                code="FORBIDDEN",
                message="Job does not belong to current user.",
                trace_id=trace_id,
            )
        return ApiResponse.success(
            data=ExtractionExportStatusResponse(
                job_id=job_id,
                status="completed",
                download_url=data.get("download_url"),
                expires_at=data.get("expires_at"),
            ),
            trace_id=trace_id,
        )
    if state == "REVOKED":
        return ApiResponse.success(
            data=ExtractionExportStatusResponse(job_id=job_id, status="cancelled"),
            trace_id=trace_id,
        )
    return ApiResponse.success(
        data=ExtractionExportStatusResponse(
            job_id=job_id, status=state.lower() if state else "pending"
        ),
        trace_id=trace_id,
    )


# ======================================================================
# POST /projects/{project_id}/extraction-export/status/{job_id}/cancel
# ======================================================================


@router.post(
    "/{project_id}/extraction-export/status/{job_id}/cancel",
    response_model=ApiResponse[ExtractionExportCancelResponse],
    summary="Cancel a running extraction export",
)
@router.delete(
    "/{project_id}/extraction-export/status/{job_id}",
    response_model=ApiResponse[ExtractionExportCancelResponse],
    summary="Cancel a running extraction export (DELETE alias)",
)
@limiter.limit("20/minute")
async def cancel_extraction_export(
    request: Request,
    project_id: UUID,  # noqa: ARG001 — kept for symmetry
    job_id: str,
    user: CurrentUser,
) -> ApiResponse[ExtractionExportCancelResponse]:
    """Revoke the Celery job; no-op for already-terminal states."""
    from celery.result import AsyncResult

    from app.worker.celery_app import celery_app

    trace_id = request.headers.get("x-trace-id") or str(uuid.uuid4())

    owner = _lookup_export_owner(job_id)
    result = AsyncResult(job_id, app=celery_app)
    if owner is None and result.state == "SUCCESS" and isinstance(result.result, dict):
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

    if result.state in ("SUCCESS", "FAILURE", "REVOKED"):
        return ApiResponse.success(
            data=ExtractionExportCancelResponse(cancelled=False),
            trace_id=trace_id,
        )
    celery_app.control.revoke(job_id, terminate=True)
    return ApiResponse.success(
        data=ExtractionExportCancelResponse(cancelled=True),
        trace_id=trace_id,
    )


# ----------------------------------------------------------------------
# Helpers
# ----------------------------------------------------------------------


def _envelope_failure(
    status_code: int,
    *,
    code: str,
    message: str,
    trace_id: str,
) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content=ApiResponse.failure(
            code=code,
            message=message,
            trace_id=trace_id,
        ).model_dump(),
    )
