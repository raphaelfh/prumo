"""Read-side service for ArticleTextBlock rows (typography reader view).

Owns the camelCase dict mapping that the pdf-viewer endpoint expects.
The ordered query is delegated to ``ArticleTextBlockRepository`` — the
single ordered-read owner.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.article import ArticleFile, ArticleTextBlock
from app.repositories.article_text_block_repository import ArticleTextBlockRepository
from app.schemas.mcp_articles import McpFileOutline, McpOutlineHeading

# Module constants (spec §5.1 size caps): an outline keeps at most this many
# headings, each capped in length.
_HEADING_CAP = 60
_HEADING_TEXT_CAP = 120


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
    pdf-viewer expects.

    Ordering is owned by ``ArticleTextBlockRepository.list_ordered_for_file``;
    this function only applies the presentation mapping.
    """
    repo = ArticleTextBlockRepository(db)
    rows = await repo.list_ordered_for_file(article_file_id)
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


async def get_file_outline(db: AsyncSession, *, article_file_id: UUID) -> McpFileOutline:
    """An article file's page/block counts plus its heading outline
    (spec §5.1): one aggregate query, one capped headings query."""
    page_count, block_count = (
        await db.execute(
            select(
                func.count(func.distinct(ArticleTextBlock.page_number)),
                func.count(),
            ).where(ArticleTextBlock.article_file_id == article_file_id)
        )
    ).one()

    heading_rows = (
        await db.execute(
            select(
                ArticleTextBlock.page_number,
                ArticleTextBlock.block_index,
                ArticleTextBlock.text,
            )
            .where(
                ArticleTextBlock.article_file_id == article_file_id,
                ArticleTextBlock.block_type == "heading",
            )
            .order_by(ArticleTextBlock.page_number, ArticleTextBlock.block_index)
            .limit(_HEADING_CAP + 1)
        )
    ).all()
    headings_truncated = len(heading_rows) > _HEADING_CAP

    return McpFileOutline(
        article_file_id=article_file_id,
        page_count=page_count,
        block_count=block_count,
        headings=[
            McpOutlineHeading(page=page, block_index=block_index, text=text[:_HEADING_TEXT_CAP])
            for page, block_index, text in heading_rows[:_HEADING_CAP]
        ],
        headings_truncated=headings_truncated,
    )
