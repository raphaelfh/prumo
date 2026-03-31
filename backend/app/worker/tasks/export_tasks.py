"""
Export Tasks.

Tasks Celery for exportacao de articles (CSV, RIS, RDF + files).
"""

import asyncio
from uuid import UUID

from app.worker.celery_app import celery_app

_WORKER_LOOP: asyncio.AbstractEventLoop | None = None


def _run_in_worker_loop(coro):
    global _WORKER_LOOP
    if _WORKER_LOOP is None or _WORKER_LOOP.is_closed():
        _WORKER_LOOP = asyncio.new_event_loop()
        asyncio.set_event_loop(_WORKER_LOOP)
    return _WORKER_LOOP.run_until_complete(coro)


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
    """
    Task for exportacao de articles em background.

    Gera ZIP with metadata (CSV/RIS/RDF) and optionalmente files;
    faz upload for storage and retorna URL assinada.

    Args:
        project_id: project.
        article_ids: List de IDs of the articles (UUID strings).
        formats: List de formatos: csv, ris, rdf.
        file_scope: none, main_only, all.
        user_id: user (para ownership do job).

    Returns:
        Dict with download_url, expires_at, skipped_files, user_id.
    """
    from app.core.deps import AsyncSessionLocal, get_supabase_client
    from app.core.factories import create_storage_adapter
    from app.services.articles_export_service import ArticlesExportService

    async def run() -> dict:
        async with AsyncSessionLocal() as session:
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

    return _run_in_worker_loop(run())
