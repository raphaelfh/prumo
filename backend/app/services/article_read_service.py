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
