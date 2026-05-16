"""
Articles Export Endpoint.

Endpoints for exportacao de articles (CSV, RIS, RDF) with opcao de incluir files.
"""

import contextlib
import uuid
from uuid import UUID

from fastapi import APIRouter, Request, Response, status
from fastapi.responses import JSONResponse
from redis import Redis

from app.core.deps import CurrentUser, DbSession, SupabaseClient
from app.core.factories import create_storage_adapter
from app.core.logging import get_logger
from app.repositories.unit_of_work import UnitOfWork
from app.schemas.articles_export import (
    ExportCancelResponse,
    ExportRequest,
    ExportStartedResponse,
    ExportStatusResponse,
    SkippedFileEntry,
)
from app.schemas.common import ApiResponse
from app.services.articles_export_service import ArticlesExportService
from app.utils.rate_limiter import limiter
from app.worker.celery_app import REDIS_URL
from app.worker.tasks.export_tasks import export_articles_task

router = APIRouter()
logger = get_logger(__name__)

# Limite for executar export de metadata de forma sincrona (sem Celery)
SYNC_METADATA_ONLY_MAX_ARTICLES = 50

# Redis key prefix used to bind a Celery export job to its owning user.
# The TTL matches Celery's ``result_expires`` (1 hour) so cancel checks
# work for the whole result window.
_EXPORT_OWNER_KEY_PREFIX = "export_job_owner:"
_EXPORT_OWNER_TTL_SECONDS = 3600


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
    """Best-effort record of ``job_id -> user_id`` for later cancel checks.

    Errors are swallowed: the GET /status path already gates on
    ``result.user_id`` for the SUCCESS state, and cancel falls back to a
    conservative 404 when no owner record is available.
    """
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


@router.post(
    "",
    response_model=None,
    summary="Iniciar exportacao de articles",
    description="Exporta articles em CSV, RIS e/ou RDF; optionalmente inclui files. Return 200 with file (sync) or 202 with jobId (async).",
)
@limiter.limit("10/minute")
async def start_export(
    request: Request,  # noqa: ARG001
    payload: ExportRequest,
    db: DbSession,
    user: CurrentUser,
    supabase: SupabaseClient,
) -> Response | ApiResponse[ExportStartedResponse]:
    """Inicia exportacao. Metadata-only and poucos articles → 200 with file; caso contrario → 202 with job_id."""
    trace_id = str(uuid.uuid4())
    project_id = payload.project_id
    article_ids = payload.article_ids
    formats = [f.lower() for f in payload.formats if (f or "").strip()]
    file_scope = (payload.file_scope or "none").strip().lower()

    if not formats:
        return ApiResponse.failure(
            code="VALIDATION_ERROR",
            message="At least one format is required (csv, ris, rdf).",
            trace_id=trace_id,
        )
    if not article_ids:
        return ApiResponse.failure(
            code="VALIDATION_ERROR",
            message="article_ids cannot be empty.",
            trace_id=trace_id,
        )
    valid_formats = {"csv", "ris", "rdf"}
    if not all(f in valid_formats for f in formats):
        return ApiResponse.failure(
            code="VALIDATION_ERROR",
            message="formats must be one or more of: csv, ris, rdf.",
            trace_id=trace_id,
        )
    if file_scope not in ("none", "main_only", "all"):
        return ApiResponse.failure(
            code="VALIDATION_ERROR",
            message="file_scope must be one of: none, main_only, all.",
            trace_id=trace_id,
        )

    async with UnitOfWork(db) as uow:
        is_member = await uow.project_members.is_member(project_id, user.sub)
        if not is_member:
            return ApiResponse.failure(
                code="FORBIDDEN",
                message="User is not a member of this project.",
                trace_id=trace_id,
            )

    storage = create_storage_adapter(supabase)
    service = ArticlesExportService(
        db=db,
        user_id=user.sub,
        storage=storage,
        trace_id=trace_id,
    )
    articles = await service.get_articles_for_export(
        project_id,
        article_ids,
        include_files=(file_scope != "none"),
    )
    if len(articles) != len(article_ids):
        return ApiResponse.failure(
            code="NOT_FOUND",
            message="One or more articles not found or do not belong to this project.",
            trace_id=trace_id,
        )

    # Sync: metadata-only and ate SYNC_METADATA_ONLY_MAX_ARTICLES articles
    if file_scope == "none" and len(article_ids) <= SYNC_METADATA_ONLY_MAX_ARTICLES:
        content, media_type, filename, skipped = await service.run_export(
            project_id, article_ids, formats, file_scope, job_id=None
        )
        # Issue #30: surface skipped files via an `X-Skipped-Files` header so
        # callers can detect partial exports instead of silently receiving an
        # incomplete file. The async path already exposes this via the JSON
        # status payload; mirror the signal here.
        headers: dict[str, str] = {
            "Content-Disposition": f'attachment; filename="{filename}"',
        }
        if skipped:
            headers["X-Skipped-Files"] = str(len(skipped))
            headers["Access-Control-Expose-Headers"] = "X-Skipped-Files"
        return Response(
            content=content,
            media_type=media_type,
            headers=headers,
        )

    # Async: enfileirar task
    if not _is_queue_available():
        return JSONResponse(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            content=ApiResponse.failure(
                code="SERVICE_UNAVAILABLE",
                message="Background export queue is unavailable. Please start Redis/Celery and try again.",
                trace_id=trace_id,
            ).model_dump(),
        )
    try:
        task = export_articles_task.delay(
            project_id=str(project_id),
            article_ids=[str(aid) for aid in article_ids],
            formats=formats,
            file_scope=file_scope,
            user_id=user.sub,
        )
    except Exception:
        return JSONResponse(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            content=ApiResponse.failure(
                code="SERVICE_UNAVAILABLE",
                message="Background export queue is unavailable. Please start Redis/Celery and try again.",
                trace_id=trace_id,
            ).model_dump(),
        )
    # Record the owner so cancel_export can later authorize the caller.
    _remember_export_owner(task.id, user.sub)
    return JSONResponse(
        status_code=status.HTTP_202_ACCEPTED,
        content=ApiResponse.success(
            data=ExportStartedResponse(job_id=task.id),
            trace_id=trace_id,
        ).model_dump(),
    )


@router.get(
    "/status/{job_id}",
    response_model=ApiResponse[ExportStatusResponse],
    summary="Status do job de exportacao",
)
@limiter.limit("30/minute")
async def get_export_status(
    request: Request,
    job_id: str,
    user: CurrentUser,
) -> ApiResponse[ExportStatusResponse]:
    """Return status do job; quando completed, inclui downloadUrl and expiresAt."""
    from celery.result import AsyncResult

    from app.worker.celery_app import celery_app

    trace_id = request.headers.get("x-trace-id") or str(uuid.uuid4())

    result = AsyncResult(job_id, app=celery_app)
    state = result.state
    # Issue #60: `result.backend` is always truthy when Celery has a result
    # backend configured, so the previous guard was dead code and an unknown
    # job_id would spin in "pending" indefinitely. Use the owner record
    # (written at enqueue time with TTL = result_expires) as the authoritative
    # existence signal: PENDING + no owner row = job was never enqueued or
    # has fully expired.
    if state == "PENDING" and _lookup_export_owner(job_id) is None:
        return ApiResponse.failure(
            code="NOT_FOUND",
            message="Job not found or expired.",
            trace_id=trace_id,
        )
    if state == "PENDING":
        return ApiResponse.success(
            data=ExportStatusResponse(
                job_id=job_id,
                status="pending",
            ),
            trace_id=trace_id,
        )
    if state == "STARTED" or state == "RETRY":
        return ApiResponse.success(
            data=ExportStatusResponse(
                job_id=job_id,
                status="running",
            ),
            trace_id=trace_id,
        )
    if state == "FAILURE":
        return ApiResponse.success(
            data=ExportStatusResponse(
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
        skipped = data.get("skipped_files") or []
        skipped_entries = None
        if skipped:
            skipped_entries = [
                SkippedFileEntry(
                    article_id=UUID(s["articleId"])
                    if isinstance(s.get("articleId"), str)
                    else s["articleId"],
                    storage_key=s["storageKey"],
                    reason=s["reason"],
                )
                for s in skipped
            ]
        return ApiResponse.success(
            data=ExportStatusResponse(
                job_id=job_id,
                status="completed",
                download_url=data.get("download_url"),
                expires_at=data.get("expires_at"),
                skipped_files=skipped_entries,
            ),
            trace_id=trace_id,
        )
    if state == "REVOKED":
        return ApiResponse.success(
            data=ExportStatusResponse(
                job_id=job_id,
                status="cancelled",
            ),
            trace_id=trace_id,
        )
    return ApiResponse.success(
        data=ExportStatusResponse(
            job_id=job_id,
            status=state.lower() if state else "pending",
        ),
        trace_id=trace_id,
    )


@router.post(
    "/status/{job_id}/cancel",
    response_model=ApiResponse[ExportCancelResponse],
    summary="Cancelar exportacao (POST)",
)
@router.delete(
    "/status/{job_id}",
    response_model=ApiResponse[ExportCancelResponse],
    summary="Cancelar exportacao (DELETE)",
)
@limiter.limit("20/minute")
async def cancel_export(
    request: Request,
    job_id: str,
    user: CurrentUser,
) -> ApiResponse[ExportCancelResponse]:
    """Revoga o job de exportacao. Se ja concluido, no-op.

    Only the user that started the export may cancel it: ownership is
    resolved from the Redis ``export_job_owner:<id>`` key written at start
    time, with a fallback to the SUCCESS-state result payload (which also
    carries ``user_id``). If neither source can confirm ownership the
    request is rejected with 404 so an attacker cannot probe job ids.
    """
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
            data=ExportCancelResponse(cancelled=False),
            trace_id=trace_id,
        )
    celery_app.control.revoke(job_id, terminate=True)
    return ApiResponse.success(
        data=ExportCancelResponse(cancelled=True),
        trace_id=trace_id,
    )
