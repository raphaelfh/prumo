"""Export Celery tasks.

Celery tasks that export articles (CSV, RIS, RDF) plus optional PDFs as
a single ZIP, upload the bundle to storage, and return a signed URL.

The async bridge is via ``app.worker._runner.run_task`` — see that
module's docstring for the event-loop rationale.
"""

from __future__ import annotations

from uuid import UUID

from app.worker._runner import run_task
from app.worker.celery_app import celery_app


@celery_app.task(
    bind=True,
    max_retries=1,
    rate_limit="5/m",
)
def export_articles_task(
    self,
    project_id: str,
    article_ids: list[str],
    formats: list[str],
    file_scope: str,
    user_id: str,
) -> dict:
    """Export a set of articles in the background.

    Builds a ZIP with metadata (CSV/RIS/RDF) and optionally the article
    files; uploads the bundle to storage and returns a signed URL.

    Args:
        project_id: Project UUID.
        article_ids: List of article UUIDs to export.
        formats: List of metadata formats: csv, ris, rdf.
        file_scope: One of none, main_only, all.
        user_id: User UUID owning the export job.

    Returns:
        Dict with download_url, expires_at, skipped_files, user_id.
    """

    async def run() -> dict:
        from app.core.deps import get_supabase_client
        from app.core.factories import create_storage_adapter
        from app.services.articles_export_service import ArticlesExportService
        from app.worker._session import worker_session

        async with worker_session() as session:
            supabase = get_supabase_client()
            storage = create_storage_adapter(supabase)
            service = ArticlesExportService(
                db=session,
                user_id=user_id,
                storage=storage,
                trace_id=self.request.id,
            )
            result = await service.run_export_async(
                project_id=UUID(project_id),
                article_ids=[UUID(aid) for aid in article_ids],
                formats=formats,
                file_scope=file_scope,
                job_id=self.request.id,
            )
            result["user_id"] = user_id
            return result

    return run_task(run)
