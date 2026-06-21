"""Service layer for ``article_files`` CRUD.

Keeps the API layer off models and repositories (layered-architecture
fitness: ``api -> services -> repositories -> models``). The endpoints
resolve membership and own the transaction boundary (commit); this service
constructs/loads rows and applies status transitions, flushing only.
"""

from __future__ import annotations

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.article import ArticleFile
from app.repositories.article_repository import ArticleFileRepository


class ArticleFileService:
    """CRUD + parse-status transitions for ``article_files``."""

    def __init__(self, db: AsyncSession) -> None:
        self._repo = ArticleFileRepository(db)

    async def create_uploaded_file(
        self,
        *,
        project_id: UUID,
        article_id: UUID,
        storage_key: str,
        file_type: str,
        original_filename: str | None,
        bytes_: int | None,
        file_role: str,
    ) -> ArticleFile:
        """Create the ``article_files`` row (flush only; caller commits)."""
        article_file = ArticleFile(
            project_id=project_id,
            article_id=article_id,
            file_type=file_type,
            storage_key=storage_key,
            original_filename=original_filename,
            bytes=bytes_,
            file_role=file_role,
        )
        return await self._repo.create(article_file)

    async def get_by_id(self, article_file_id: UUID) -> ArticleFile | None:
        """Load an ``ArticleFile`` by id, or ``None`` if it does not exist."""
        return await self._repo.get_by_id(article_file_id)

    def mark_parse_failed(self, article_file: ArticleFile, error: str) -> None:
        """Mark the row as parse-failed with a truncated error (caller commits)."""
        article_file.extraction_status = "parse_failed"
        article_file.extraction_error = error[:500]

    def reset_for_reparse(self, article_file: ArticleFile) -> None:
        """Reset the row to pending so a re-parse can run (caller commits)."""
        article_file.extraction_status = "pending"
        article_file.extraction_error = None
