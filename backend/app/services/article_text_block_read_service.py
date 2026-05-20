"""Read-side service for ArticleTextBlock rows (typography reader view).

Owns the inline SQL that `article_text_blocks.py` used to do directly,
so the endpoint module stops importing from `app.models.*`.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.article import ArticleFile, ArticleTextBlock


class ArticleFileNotFoundError(Exception):
    """Raised when an ArticleFile lookup returns no row. HTTP translation in router."""


async def get_article_file_project_id(db: AsyncSession, article_file_id: UUID) -> UUID:
    """Return the project_id of an ArticleFile or raise.

    The endpoint uses this to enforce project membership via the standard
    `ensure_project_member` helper, without having to load the ORM row.
    """
    project_id = (
        await db.execute(select(ArticleFile.project_id).where(ArticleFile.id == article_file_id))
    ).scalar_one_or_none()
    if project_id is None:
        raise ArticleFileNotFoundError(f"Article file {article_file_id} not found")
    return project_id


async def list_text_blocks(db: AsyncSession, article_file_id: UUID) -> list[dict[str, Any]]:
    """Return all text blocks for the given article_file in reading order
    (page_number asc, block_index asc), as the camelCase dicts the
    pdf-viewer expects."""
    rows = (
        (
            await db.execute(
                select(ArticleTextBlock)
                .where(ArticleTextBlock.article_file_id == article_file_id)
                .order_by(
                    ArticleTextBlock.page_number.asc(),
                    ArticleTextBlock.block_index.asc(),
                )
            )
        )
        .scalars()
        .all()
    )
    return [
        {
            "id": str(row.id),
            "pageNumber": row.page_number,
            "blockIndex": row.block_index,
            "text": row.text,
            "charStart": row.char_start,
            "charEnd": row.char_end,
            "bbox": row.bbox,
            "blockType": row.block_type,
        }
        for row in rows
    ]
