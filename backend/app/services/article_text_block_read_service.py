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
from app.schemas.mcp_article_text import McpTextChunk, McpTextPage, chunk_locator_prefix
from app.schemas.mcp_articles import McpFileOutline, McpOutlineHeading
from app.utils.opaque_cursor import cursor_position, decode_cursor, encode_cursor
from app.utils.text_caps import cap_json_weight

# Module constants (spec §5.1 size caps): an outline keeps at most this many
# headings, each capped in length.
_HEADING_CAP = 60
_HEADING_TEXT_WEIGHT = 122  # 120 ASCII chars + quotes; CJK is cut ~6x shorter

# Rows fetched per repository round-trip while paging article text.
_TEXT_WINDOW_SIZE = 200


async def page_text_blocks(
    db: AsyncSession,
    *,
    article_file_id: UUID,
    page_from: int | None,
    page_to: int | None,
    cursor: str | None,
    budget: int = 28_000,
) -> McpTextPage:
    """Page an article file's text blocks by character budget (spec §5.1).

    Keyset ``(page_number, block_index, char_offset)``: a cursor may resume
    inside an oversized block. Reading order is delegated to
    ``ArticleTextBlockRepository.list_ordered_window`` — this function only
    applies the character-budget paging rule and the split-on-overflow
    behaviour. Raises ``InvalidCursorError`` (via ``decode_cursor``) on a
    malformed cursor.
    """
    decoded = decode_cursor(cursor, arity=3)
    window_start: tuple[int, int] | None = None
    resume_offset = 0
    if decoded is not None:
        page_val, idx_val, offset_val = decoded
        window_start = (cursor_position(page_val), cursor_position(idx_val))
        resume_offset = cursor_position(offset_val)

    repo = ArticleTextBlockRepository(db)
    chunks: list[McpTextChunk] = []
    remaining_budget = budget
    next_cursor: str | None = None
    fetch_start = window_start
    first_fetch = True

    while True:
        rows = await repo.list_ordered_window(
            article_file_id,
            start=fetch_start,
            page_from=page_from,
            page_to=page_to,
            limit=_TEXT_WINDOW_SIZE,
        )
        exhausted = len(rows) < _TEXT_WINDOW_SIZE
        # A re-fetch (not the caller's own cursor) starts at the last
        # processed row's key, which the `>=` filter re-includes: drop it.
        if not first_fetch and rows and (rows[0].page_number, rows[0].block_index) == fetch_start:
            rows = rows[1:]
        first_fetch = False

        if not rows:
            break

        stopped = False
        for row in rows:
            key = (row.page_number, row.block_index)
            block_offset = resume_offset if key == window_start else 0
            text = row.text[block_offset:]
            prefix = chunk_locator_prefix(row.page_number, row.block_index, block_offset)
            needed = len(prefix) + len(text) + 1
            if needed <= remaining_budget:
                chunks.append(
                    McpTextChunk(
                        page_number=row.page_number,
                        block_index=row.block_index,
                        char_offset=block_offset,
                        text=text,
                    )
                )
                remaining_budget -= needed
                continue
            if chunks:
                # Already has a chunk: stop here, the next result starts at
                # this block (unconsumed).
                next_cursor = encode_cursor([row.page_number, row.block_index, block_offset])
            else:
                # First chunk of this result and it still doesn't fit:
                # split it at the budget boundary (code-point slicing).
                split_len = max(remaining_budget - len(prefix) - 1, 0)
                piece = text[:split_len]
                chunks.append(
                    McpTextChunk(
                        page_number=row.page_number,
                        block_index=row.block_index,
                        char_offset=block_offset,
                        text=piece,
                    )
                )
                next_cursor = encode_cursor(
                    [row.page_number, row.block_index, block_offset + split_len]
                )
            stopped = True
            break

        if stopped:
            break
        if exhausted:
            break
        fetch_start = (rows[-1].page_number, rows[-1].block_index)

    return McpTextPage(chunks=chunks, next_cursor=next_cursor)


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
            McpOutlineHeading(
                page=page,
                block_index=block_index,
                text=cap_json_weight(text, _HEADING_TEXT_WEIGHT)[0],
            )
            for page, block_index, text in heading_rows[:_HEADING_CAP]
        ],
        headings_truncated=headings_truncated,
    )
