"""Delete articles: rows first, storage objects after the commit.

Order is the point. Removing the PDFs first (the old browser flow) left rows
pointing at nothing whenever the row delete was then refused. Here the rows
go first inside the caller's transaction; the storage keys are collected
before the delete, because the ``article_files`` cascade removes the rows that
hold them. A storage failure after the commit only orphans objects, which
:func:`remove_article_objects` logs by key.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.infrastructure.storage import StorageAdapter
from app.models.article import Article, ArticleFile
from app.services.article_read_service import owned_articles

logger = get_logger(__name__)

_BUCKET = "articles"


@dataclass(frozen=True)
class DeletedArticles:
    """The outcome of a row delete: the count, and the keys to remove from storage."""

    deleted: int
    storage_keys: list[str]


async def delete_project_articles(
    db: AsyncSession, *, project_id: UUID, article_ids: Sequence[UUID]
) -> DeletedArticles:
    """Delete the articles (all of them or, on a foreign id, none) and flush.

    Raises ``ArticleNotFoundError`` when any id is not in ``project_id``.
    Does not commit and does not touch storage.
    """
    ids = await owned_articles(db, project_id=project_id, article_ids=article_ids)
    storage_keys = list(
        (
            await db.execute(
                select(ArticleFile.storage_key).where(
                    ArticleFile.article_id.in_(ids), ArticleFile.project_id == project_id
                )
            )
        ).scalars()
    )
    result = await db.execute(
        delete(Article)
        .where(Article.id.in_(ids), Article.project_id == project_id)
        .returning(Article.id)
    )
    deleted = len(result.scalars().all())
    await db.flush()
    return DeletedArticles(deleted=deleted, storage_keys=storage_keys)


async def remove_article_objects(storage: StorageAdapter, keys: list[str]) -> int:
    """Remove the objects from the ``articles`` bucket; return how many failed."""
    failed = await storage.delete_many(_BUCKET, keys)
    if failed:
        logger.warning("article_delete_storage_orphans", bucket=_BUCKET, keys=failed)
    return len(failed)
