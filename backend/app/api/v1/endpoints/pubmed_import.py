"""PubMed import by PMID: start (or dry-run) an import, then poll its run.

The import itself runs in the ``imports`` queue: POST writes a ``pending``
run, commits, then enqueues ``import_pubmed_task``; GET reads the run back.
"""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status

from app.api.deps.security import require_project_scope
from app.core.deps import DbSession
from app.schemas.common import ApiResponse
from app.schemas.pubmed_import import (
    ImportRunRead,
    PubmedImportRequest,
    PubmedImportResult,
    PubmedImportStarted,
)
from app.services.pubmed_import_service import (
    ImportQueueUnavailableError,
    ImportRunNotFoundError,
    PubmedImportService,
)
from app.utils.rate_limiter import limiter
from app.worker.tasks.import_tasks import import_pubmed_task

router = APIRouter()


@router.post(
    "/projects/{project_id}/imports/pubmed",
    status_code=status.HTTP_202_ACCEPTED,
    responses={
        200: {"description": "Dry run: counts only, nothing written"},
        503: {"description": "Task queue unavailable or NCBI_EMAIL unset"},
    },
)
@limiter.limit("10/minute")
async def import_pubmed(
    request: Request,
    response: Response,
    project_id: UUID,
    body: PubmedImportRequest,
    db: DbSession,
    user_sub: UUID = Depends(require_project_scope),
) -> ApiResponse[PubmedImportResult]:
    trace_id = getattr(request.state, "trace_id", None)
    service = PubmedImportService(db)
    if body.dry_run:
        response.status_code = status.HTTP_200_OK
        counts = await service.dry_run(project_id, body.pmids)
        return ApiResponse.success(counts, trace_id=trace_id)

    run_id = await service.start(project_id, user_sub)
    await db.commit()
    try:
        import_pubmed_task.delay(
            project_id=str(project_id),
            sync_run_id=str(run_id),
            pmids=body.pmids,
            trace_id=trace_id,
        )
    except Exception as exc:
        await service.mark_failed(project_id=project_id, sync_run_id=run_id)
        await db.commit()
        raise ImportQueueUnavailableError() from exc
    started = PubmedImportStarted(kind="started", sync_run_id=run_id, status="pending")
    return ApiResponse.success(started, trace_id=trace_id)


@router.get(
    "/projects/{project_id}/imports/{sync_run_id}",
    responses={404: {"description": "No import run of the caller in this project"}},
)
@limiter.limit("120/minute")
async def get_import_run(
    request: Request,
    project_id: UUID,
    sync_run_id: UUID,
    db: DbSession,
    user_sub: UUID = Depends(require_project_scope),
) -> ApiResponse[ImportRunRead]:
    try:
        run = await PubmedImportService(db).get_run(
            project_id=project_id, requester_id=user_sub, sync_run_id=sync_run_id
        )
    except ImportRunNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Import run not found"
        ) from exc
    return ApiResponse.success(run, trace_id=getattr(request.state, "trace_id", None))
