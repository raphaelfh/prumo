"""Service layer for ``article_files`` ingest + recovery.

Keeps the API layer off models and repositories (layered-architecture
fitness: ``api -> services -> repositories -> models``) AND co-locates
ArticleFile creation with the parse-at-ingest hook (every create site must
enqueue — see ``tests/fitness/test_article_file_create_uses_hook.py``). The
endpoint owns membership + HTTP mapping; this service owns the DB work and
scheduling.
"""

from __future__ import annotations

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.models.article import ArticleFile
from app.repositories.article_repository import ArticleFileRepository
from app.services.article_file_ingest_service import ArticleFileIngestService

logger = get_logger(__name__)


class ParseEnqueueError(Exception):
    """Raised when scheduling the parse fails after the row was persisted.

    The row is left as ``parse_failed`` (committed) so the caller can map
    this to a retryable HTTP error without losing the failure state.
    """


class ArticleFileService:
    """CRUD + parse scheduling for ``article_files``."""

    def __init__(self, db: AsyncSession) -> None:
        self._db = db
        self._repo = ArticleFileRepository(db)

    async def list_for_article(self, article_id: UUID) -> list[ArticleFile]:
        """List an article's files MAIN-first (document-switcher data source)."""
        return await self._repo.list_for_article_ordered(article_id)

    async def register_uploaded_file(
        self,
        *,
        project_id: UUID,
        article_id: UUID,
        storage_key: str,
        file_type: str,
        original_filename: str | None,
        bytes_: int | None,
        file_role: str,
        user_id: str,
        trace_id: str | None,
    ) -> ArticleFile:
        """Create the ``article_files`` row and enqueue its parse.

        Raises ``ParseEnqueueError`` if the parse could not be scheduled.
        """
        article_file = ArticleFile(
            project_id=project_id,
            article_id=article_id,
            file_type=file_type,
            storage_key=storage_key,
            original_filename=original_filename,
            bytes=bytes_,
            file_role=file_role,
        )
        await self._repo.create(article_file)
        # Commit BEFORE enqueue: the Celery task loads the row in its own session.
        await self._db.commit()
        await self._db.refresh(article_file)
        await self._enqueue_or_fail(
            article_file, project_id=project_id, user_id=user_id, trace_id=trace_id
        )
        return article_file

    async def reparse(
        self,
        *,
        article_file_id: UUID,
        project_id: UUID,
        user_id: str,
        trace_id: str | None,
    ) -> ArticleFile | None:
        """Reset an existing file to pending and re-enqueue its parse.

        Returns ``None`` if the file does not exist. Raises
        ``ParseEnqueueError`` if the parse could not be scheduled.
        """
        article_file = await self._repo.get_by_id(article_file_id)
        if article_file is None:
            return None
        article_file.extraction_status = "pending"
        article_file.extraction_error = None
        await self._db.commit()
        await self._db.refresh(article_file)
        await self._enqueue_or_fail(
            article_file, project_id=project_id, user_id=user_id, trace_id=trace_id
        )
        return article_file

    async def _enqueue_or_fail(
        self,
        article_file: ArticleFile,
        *,
        project_id: UUID,
        user_id: str,
        trace_id: str | None,
    ) -> None:
        try:
            ArticleFileIngestService().enqueue_parse_at_ingest(
                article_file_id=article_file.id,
                project_id=project_id,
                user_id=user_id,
                trace_id=trace_id,
            )
        except Exception as exc:  # do NOT swallow — persist failure + signal caller
            logger.warning(
                "article_file_enqueue_failed",
                trace_id=trace_id,
                article_file_id=str(article_file.id),
                error=str(exc),
            )
            article_file.extraction_status = "parse_failed"
            article_file.extraction_error = f"enqueue failed: {exc}"[:500]
            await self._db.commit()
            raise ParseEnqueueError(str(exc)) from exc
