"""Read-side service for Article lookups shared by the article routers.

Keeps the routers out of `app.models.*`: they need an article's owning
project to run `ensure_project_member` before touching anything else.
"""

from __future__ import annotations

from collections.abc import Sequence
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


async def owned_articles(
    db: AsyncSession, *, project_id: UUID, article_ids: Sequence[UUID]
) -> list[UUID]:
    """The ids (deduplicated, input order), only when EVERY one belongs to ``project_id``.

    THE article-in-project pair guard (`.claude/rules/backend.md`
    § Ownership guards). The scope is in the WHERE clause, not a compare
    after a bare ``db.get``: a foreign article and a missing one raise the
    same error with the same message shape, so no caller can leak which
    articles exist in projects the caller cannot see.
    """
    # Coerce first: the driver accepts a str id in the WHERE clause, so the
    # Python-side membership check below must compare like for like.
    wanted = list(dict.fromkeys(UUID(str(article_id)) for article_id in article_ids))
    found = set(
        (
            await db.execute(
                select(Article.id).where(Article.id.in_(wanted), Article.project_id == project_id)
            )
        ).scalars()
    )
    missing = next((article_id for article_id in wanted if article_id not in found), None)
    if missing is not None:
        raise ArticleNotFoundError(f"Article {missing} not found")
    return wanted


async def owned_article(db: AsyncSession, *, project_id: UUID, article_id: UUID) -> UUID:
    """The article's id, only when it belongs to ``project_id`` (see :func:`owned_articles`).

    Distinct from :func:`get_article_project_id` above, which answers the
    opposite question ("which project owns this?") for routers that must
    resolve an article's project *before* they can check membership at all.
    """
    return (await owned_articles(db, project_id=project_id, article_ids=[article_id]))[0]
