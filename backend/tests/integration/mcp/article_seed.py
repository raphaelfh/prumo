"""Test-only seed helpers for MCP article read tests.

Raw ``INSERT`` (not the ORM) so a test controls ``created_at`` precisely (the
"latest PDF" ordering is otherwise a same-millisecond race) without pulling a
repository into a test module that exercises the API layer's tools.
"""

from __future__ import annotations

from itertools import count
from uuid import UUID, uuid4

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

_pdf_sequence = count()


async def insert_article(
    db: AsyncSession,
    project_id: UUID,
    *,
    title: str,
    authors: list[str] | None = None,
    year: int | None = None,
) -> UUID:
    article_id = uuid4()
    await db.execute(
        text(
            "INSERT INTO public.articles "
            "(id, project_id, title, authors, publication_year, row_version) "
            "VALUES (:id, :pid, :title, :authors, :year, 1)"
        ),
        {
            "id": str(article_id),
            "pid": str(project_id),
            "title": title,
            "authors": authors,
            "year": year,
        },
    )
    await db.flush()
    return article_id


async def insert_pdf(
    db: AsyncSession,
    project_id: UUID,
    article_id: UUID,
    *,
    status: str = "parsed",
) -> UUID:
    """Insert an ``article_files`` PDF row with a strictly increasing
    ``created_at`` (an incrementing millisecond offset), so "latest PDF" is
    deterministic across calls within a test run."""
    file_id = uuid4()
    offset_ms = next(_pdf_sequence)
    await db.execute(
        text(
            "INSERT INTO public.article_files "
            "(id, project_id, article_id, file_type, storage_key, extraction_status, created_at) "
            "VALUES (:id, :pid, :aid, 'application/pdf', :key, :status, "
            "now() + (:offset_ms || ' milliseconds')::interval)"
        ),
        {
            "id": str(file_id),
            "pid": str(project_id),
            "aid": str(article_id),
            "key": f"seed/{file_id}.pdf",
            "status": status,
            "offset_ms": str(offset_ms),
        },
    )
    await db.flush()
    return file_id


async def insert_blocks(
    db: AsyncSession,
    file_id: UUID,
    blocks: list[tuple[int, int, str, str]],
) -> None:
    """Insert ``article_text_blocks`` rows: each tuple is
    ``(page_number, block_index, text, block_type)``."""
    for page_number, block_index, block_text, block_type in blocks:
        await db.execute(
            text(
                "INSERT INTO public.article_text_blocks "
                "(id, article_file_id, page_number, block_index, text, "
                "char_start, char_end, bbox, block_type) "
                "VALUES (:id, :fid, :page, :idx, :text, 0, :char_end, '{}'::jsonb, :block_type)"
            ),
            {
                "id": str(uuid4()),
                "fid": str(file_id),
                "page": page_number,
                "idx": block_index,
                "text": block_text,
                "char_end": len(block_text),
                "block_type": block_type,
            },
        )
    await db.flush()
