"""Extraction Export Celery tasks (009-extraction-excel-export).

Background-export worker. Opens its own DB session + storage adapter,
runs the export service, uploads bytes, returns a signed URL.

The async bridge is via ``app.worker._runner.run_task`` — see that
module's docstring for the event-loop rationale.
"""

from __future__ import annotations

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
    shape: str = "complete",
) -> dict[str, Any]:
    """Async extraction export job.

    Builds the workbook via ``build_export``, uploads bytes
    to Supabase Storage, returns ``{download_url, expires_at, user_id}``.
    """

    async def run() -> dict[str, Any]:
        # Lazy imports + lazy client construction.
        from app.core.deps import get_supabase_client
        from app.core.factories import create_storage_adapter
        from app.services.exports.extraction.run import ExportRequest, build_export
        from app.services.exports.extraction.workbook import ExportShape
        from app.services.extraction_export_service import ExportMode
        from app.worker._session import worker_session

        req = ExportRequest(
            project_id=UUID(project_id),
            template_id=UUID(template_id),
            mode=ExportMode(mode),
            article_ids=tuple(UUID(aid) for aid in article_ids),
            reviewer_id=UUID(reviewer_id) if reviewer_id else None,
            include_ai_metadata=include_ai_metadata,
            anonymize_reviewer_names=anonymize_reviewer_names,
            shape=ExportShape(shape),
        )
        async with worker_session() as session:
            file = await build_export(session, req, user_id=user_id, trace_id=self.request.id)

            storage = create_storage_adapter(get_supabase_client())
            path = f"{_STORAGE_PREFIX}/{user_id}/{self.request.id}/{file.filename}"
            await storage.upload(_STORAGE_BUCKET, path, file.content, file.media_type)
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
