"""Read-side service for Article lookups shared by the article routers.

Keeps the routers out of `app.models.*`: they need an article's owning
project to run `ensure_project_member` before touching anything else.
"""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.article import Article


class ArticleNotFoundError(Exception):
    """Raised when an Article lookup returns no row. HTTP translation in router."""


async def get_article_project_id(db: AsyncSession, article_id: UUID) -> UUID:
    """Return the project_id of an Article or raise.

    The endpoint uses this for membership enforcement via
    `ensure_project_member`, without loading the ORM row.
    """
    project_id = (
        await db.execute(select(Article.project_id).where(Article.id == article_id))
    ).scalar_one_or_none()
    if project_id is None:
        raise ArticleNotFoundError(f"Article {article_id} not found")
    return project_id


async def owned_article(db: AsyncSession, *, project_id: UUID, article_id: UUID) -> UUID:
    """The article's id, only when it belongs to ``project_id``.

    THE article-in-project pair guard (`.claude/rules/backend.md`
    § Ownership guards). The scope is in the WHERE clause, not a compare
    after a bare ``db.get``: a foreign article and a missing one raise the
    same error with the same message shape, so no caller can leak which
    articles exist in projects the caller cannot see.

    Distinct from :func:`get_article_project_id` above, which answers the
    opposite question ("which project owns this?") for routers that must
    resolve an article's project *before* they can check membership at all.
    """
    found = (
        await db.execute(
            select(Article.id).where(Article.id == article_id, Article.project_id == project_id)
        )
    ).scalar_one_or_none()
    if found is None:
        raise ArticleNotFoundError(f"Article {article_id} not found")
    return found
