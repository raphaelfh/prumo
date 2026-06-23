"""Integration test: unique (article_file_id, page_number, block_index) constraint.

After migration 0031, a duplicate triple must fail with IntegrityError.
Uses db_session_real because we need to verify DB-level constraints,
not ORM-level behaviour.
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from tests.integration.conftest import SEED


async def _insert_article_file(db: AsyncSession) -> str:
    """Insert a minimal article_files row and return its id string."""
    file_id = str(uuid.uuid4())
    await db.execute(
        text(
            "INSERT INTO public.article_files "
            "(id, project_id, article_id, file_type, storage_key, file_role) "
            "VALUES (:id, :pid, :aid, 'pdf', :key, 'MAIN')"
        ),
        {
            "id": file_id,
            "pid": str(SEED.primary_project),
            "aid": str(SEED.primary_article),
            "key": f"test-unique/{file_id}.pdf",
        },
    )
    await db.commit()
    return file_id


async def _cleanup_article_file(db: AsyncSession, *, file_id: str) -> None:
    await db.execute(
        text("DELETE FROM public.article_files WHERE id = :id"),
        {"id": file_id},
    )
    await db.commit()


@pytest.mark.asyncio
async def test_duplicate_block_index_rejected(db_session_real: AsyncSession) -> None:
    """After 0031, a duplicate (article_file_id, page, block_index) must fail."""
    fid = await _insert_article_file(db_session_real)
    try:
        insert = text(
            "INSERT INTO article_text_blocks "
            "(id, article_file_id, page_number, block_index, text, char_start, char_end, "
            "bbox, block_type) "
            "VALUES (gen_random_uuid(), :fid, 1, 0, :t, 0, 1, "
            "CAST(:bbox AS jsonb), 'paragraph')"
        )
        bbox = '{"x":0,"y":0,"width":100,"height":10}'
        await db_session_real.execute(insert, {"fid": fid, "t": "a", "bbox": bbox})
        await db_session_real.commit()

        with pytest.raises(IntegrityError):
            await db_session_real.execute(insert, {"fid": fid, "t": "b", "bbox": bbox})
            await db_session_real.commit()
    finally:
        # rollback any open failed transaction before cleanup
        await db_session_real.rollback()
        await _cleanup_article_file(db_session_real, file_id=fid)
