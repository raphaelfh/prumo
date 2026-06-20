"""Single parse-at-ingest hook for ALL ingest routes.

Every code path that creates an ArticleFile (Zotero today, direct-upload and
future routes) MUST call enqueue_parse_at_ingest immediately after the row is
created. This is the only sanctioned way to trigger parsing at ingest; the
per-project parser preference is resolved inside the Celery task
(single source of truth), so this hook stays route-agnostic.
"""

from __future__ import annotations

from uuid import UUID

from app.worker.tasks.parsing_tasks import parse_article_file_task


class ArticleFileIngestService:
    """Thin enqueue wrapper — no DB session, route-agnostic."""

    def enqueue_parse_at_ingest(
        self,
        *,
        article_file_id: UUID,
        project_id: UUID,
        user_id: str,
        trace_id: str | None,
    ) -> str:
        """Enqueue parse_article_file_task for a freshly created ArticleFile.

        Returns:
            The Celery task id.
        """
        async_result = parse_article_file_task.delay(
            article_file_id=str(article_file_id),
            project_id=str(project_id),
            user_id=user_id,
            trace_id=trace_id,
        )
        return async_result.id
