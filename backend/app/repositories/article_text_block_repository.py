"""Repository for ArticleTextBlock — bulk writer and ordered reader.

This is the *single ordered-read owner* for article_text_blocks.
The read service (``app.services.article_text_block_read_service``) delegates
its query here and only retains the dict/camelCase mapping layer.

Design notes
------------
- ``replace_for_file`` is for **re-parse** of the same file. Re-upload
  is handled upstream by the ``ON DELETE CASCADE`` on ``article_files``.
- Uses ``flush()`` only, never ``commit()``.  The caller (service or
  UnitOfWork) owns transaction boundaries.
- Bulk-insert via ``db.add_all`` + single ``flush`` — avoids N round-trips.
"""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.infrastructure.parsing.base import ParsedBlock, normalize_block_type
from app.models.article import ArticleTextBlock
from app.repositories.base import BaseRepository


class ArticleTextBlockRepository(BaseRepository[ArticleTextBlock]):
    """Persistence layer for ``ArticleTextBlock`` rows."""

    def __init__(self, db: AsyncSession) -> None:
        super().__init__(db, ArticleTextBlock)

    async def replace_for_file(
        self,
        article_file_id: UUID,
        blocks: list[ParsedBlock],
    ) -> list[ArticleTextBlock]:
        """Delete all existing blocks for *article_file_id*, then bulk-insert *blocks*.

        Intended for re-parse of the same file. Re-upload is handled by the
        ``ON DELETE CASCADE`` on ``article_files``; do not call this from the
        re-upload path.

        Uses ``flush()`` — the caller must ``commit()`` to persist.

        Args:
            article_file_id: PK of the ``ArticleFile`` whose blocks to replace.
            blocks: Flat list of ``ParsedBlock`` values from the parser.

        Returns:
            The newly inserted ``ArticleTextBlock`` ORM instances.
            ``flush()`` populates ``id`` and other server defaults; call
            ``await session.refresh(row)`` individually if you need additional
            server-generated fields.
        """
        # Delete existing rows for this file in a single statement.
        await self.db.execute(
            delete(ArticleTextBlock).where(ArticleTextBlock.article_file_id == article_file_id)
        )

        # Build ORM instances 1-to-1 from ParsedBlock.
        # normalize_block_type enforces the closed-set contract: unknown values
        # degrade to "paragraph" rather than hitting the DB CHECK constraint.
        orm_rows = [
            ArticleTextBlock(
                article_file_id=article_file_id,
                page_number=block.page_number,
                block_index=block.block_index,
                text=block.text,
                char_start=block.char_start,
                char_end=block.char_end,
                bbox=block.bbox,
                block_type=normalize_block_type(block.block_type),
                row_index=block.row_index,
                col_index=block.col_index,
                row_span=block.row_span,
                col_span=block.col_span,
                is_header=block.is_header,
            )
            for block in blocks
        ]

        self.db.add_all(orm_rows)
        await self.db.flush()
        return orm_rows

    async def list_ordered_for_file(
        self,
        article_file_id: UUID,
    ) -> list[ArticleTextBlock]:
        """Return all blocks for *article_file_id* in reading order.

        Ordering: ``page_number ASC``, ``block_index ASC``.  This is the
        single source of truth for ordering — the read service delegates here
        rather than duplicating the ``ORDER BY`` clause.

        Args:
            article_file_id: PK of the target ``ArticleFile``.

        Returns:
            Ordered list of ``ArticleTextBlock`` ORM instances (may be empty).
        """
        result = await self.db.execute(
            select(ArticleTextBlock)
            .where(ArticleTextBlock.article_file_id == article_file_id)
            .order_by(
                ArticleTextBlock.page_number.asc(),
                ArticleTextBlock.block_index.asc(),
            )
        )
        return list(result.scalars().all())
