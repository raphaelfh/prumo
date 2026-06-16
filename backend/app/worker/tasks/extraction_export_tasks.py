"""Extraction Export Celery tasks (009-extraction-excel-export).

Background-export worker. Opens its own DB session + storage adapter,
runs the export service, uploads bytes, returns a signed URL.

The async bridge is via ``app.worker._runner.run_task`` — see that
module's docstring for the event-loop rationale.
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID

from celery import Task

from app.core.logging import get_logger
from app.worker._runner import run_task
from app.worker.celery_app import celery_app

logger = get_logger(__name__)

#: Signed-URL TTL for the generated ``.xlsx``. Matches the articles_export
#: convention so users see consistent expiry windows across export types.
_DOWNLOAD_URL_TTL_SECONDS = 3600

#: Supabase Storage bucket. We reuse the existing ``articles`` bucket
#: under a dedicated ``exports/extraction/`` prefix (research.md §2).
_STORAGE_BUCKET = "articles"
_STORAGE_PREFIX = "exports/extraction"


@celery_app.task(
    bind=True,
    max_retries=1,
    rate_limit="5/m",
)
def export_extraction_task(
    self: Task[Any, Any],
    project_id: str,
    template_id: str,
    mode: str,
    article_ids: list[str],
    article_scope: str,  # noqa: ARG001 — informational; carried for audit/log
    user_id: str,
    reviewer_id: str | None = None,
    include_ai_metadata: bool = False,
    anonymize_reviewer_names: bool = False,
) -> dict[str, Any]:
    """Async extraction export job.

    Builds the workbook via ``ExtractionExportService``, uploads bytes
    to Supabase Storage, returns ``{download_url, expires_at, user_id}``.
    """

    async def run() -> dict[str, Any]:
        # Lazy imports + lazy client construction.
        from app.core.deps import get_supabase_client
        from app.core.factories import create_storage_adapter
        from app.services.exports.extraction.workbook import build_workbook
        from app.services.extraction_export_service import (
            ExportMode,
            ExtractionExportService,
        )
        from app.worker._session import worker_session

        async with worker_session() as session:
            supabase = get_supabase_client()
            storage = create_storage_adapter(supabase)
            service = ExtractionExportService(
                db=session,
                user_id=user_id,
                storage=storage,
                trace_id=self.request.id,
            )

            layout = await service.resolve_layout(
                project_id=UUID(project_id),
                template_id=UUID(template_id),
                mode=ExportMode(mode),
                article_ids=[UUID(aid) for aid in article_ids],
                include_ai_metadata=include_ai_metadata,
                anonymize_reviewer_names=anonymize_reviewer_names,
                reviewer_id=UUID(reviewer_id) if reviewer_id else None,
            )

            # CPU-bound write — keep it in a thread so the event loop is
            # free for the upload coroutine that follows.
            data = await asyncio.to_thread(build_workbook, layout)

            path = f"{_STORAGE_PREFIX}/{user_id}/{self.request.id}.xlsx"
            await storage.upload(
                _STORAGE_BUCKET,
                path,
                data,
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            )
            download_url = await storage.get_signed_url(
                _STORAGE_BUCKET, path, expires_in=_DOWNLOAD_URL_TTL_SECONDS
            )
            expires_at = (
                datetime.now(UTC) + timedelta(seconds=_DOWNLOAD_URL_TTL_SECONDS)
            ).isoformat()
            return {
                "download_url": download_url,
                "expires_at": expires_at,
                "user_id": user_id,
            }

    return run_task(run)
