"""Integration tests for ArticleTextBlockRepository.

Tests:
- replace_for_file deletes existing rows and bulk-inserts new ones
- field round-trip is exact (including bbox dict and block_type)
- calling replace_for_file twice is idempotent (second call replaces, not appends)
- list_ordered_for_file returns rows ordered by (page_number asc, block_index asc)
- RLS: a non-member session cannot read the inserted rows

Uses db_session_real because we need to test cross-session RLS visibility.
"""

from __future__ import annotations

import uuid
from uuid import UUID

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.infrastructure.parsing.base import ParsedBlock
from app.repositories.article_text_block_repository import ArticleTextBlockRepository
from tests.integration.conftest import SEED

# ---------------------------------------------------------------------------
# Fixture helpers
# ---------------------------------------------------------------------------


async def _insert_article_file(db: AsyncSession, *, project_id: UUID, article_id: UUID) -> UUID:
    file_id = uuid.uuid4()
    await db.execute(
        text(
            "INSERT INTO public.article_files "
            "(id, project_id, article_id, file_type, storage_key, file_role) "
            "VALUES (:id, :pid, :aid, 'pdf', :key, 'MAIN')"
        ),
        {
            "id": str(file_id),
            "pid": str(project_id),
            "aid": str(article_id),
            "key": f"test/{file_id}.pdf",
        },
    )
    await db.commit()
    return file_id


async def _cleanup(db: AsyncSession, *, file_id: UUID) -> None:
    await db.execute(
        text("DELETE FROM public.article_files WHERE id = :id"),
        {"id": str(file_id)},
    )
    await db.commit()


def _make_block(
    page: int,
    idx: int,
    text_val: str,
    char_start: int = 0,
    char_end: int | None = None,
    block_type: str = "paragraph",
) -> ParsedBlock:
    if char_end is None:
        char_end = char_start + len(text_val)
    return ParsedBlock(
        page_number=page,
        block_index=idx,
        text=text_val,
        char_start=char_start,
        char_end=char_end,
        bbox={"x": 10.0, "y": 20.0, "width": 400.0, "height": 12.5},
        block_type=block_type,
    )


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_replace_for_file_inserts_blocks_and_round_trips_fields(
    db_session_real: AsyncSession,
) -> None:
    """replace_for_file inserts blocks; all fields round-trip exactly."""
    file_id = await _insert_article_file(
        db_session_real,
        project_id=SEED.primary_project,
        article_id=SEED.primary_article,
    )
    try:
        blocks = [
            _make_block(1, 0, "First paragraph", char_start=0, char_end=15),
            _make_block(1, 1, "Second paragraph", char_start=16, char_end=32, block_type="heading"),
        ]
        repo = ArticleTextBlockRepository(db_session_real)
        result = await repo.replace_for_file(file_id, blocks)
        await db_session_real.commit()

        assert len(result) == 2

        ordered = await repo.list_ordered_for_file(file_id)
        assert len(ordered) == 2

        b0 = ordered[0]
        assert b0.page_number == 1
        assert b0.block_index == 0
        assert b0.text == "First paragraph"
        assert b0.char_start == 0
        assert b0.char_end == 15
        assert b0.bbox == {"x": 10.0, "y": 20.0, "width": 400.0, "height": 12.5}
        assert b0.block_type == "paragraph"
        assert b0.article_file_id == file_id

        b1 = ordered[1]
        assert b1.block_type == "heading"
        assert b1.block_index == 1
    finally:
        await _cleanup(db_session_real, file_id=file_id)


@pytest.mark.asyncio
async def test_replace_for_file_deletes_existing_rows(
    db_session_real: AsyncSession,
) -> None:
    """replace_for_file deletes old blocks before inserting new ones (not appending)."""
    file_id = await _insert_article_file(
        db_session_real,
        project_id=SEED.primary_project,
        article_id=SEED.primary_article,
    )
    try:
        repo = ArticleTextBlockRepository(db_session_real)

        # First call: 3 blocks
        first_blocks = [_make_block(1, i, f"old block {i}") for i in range(3)]
        await repo.replace_for_file(file_id, first_blocks)
        await db_session_real.commit()

        rows_after_first = await repo.list_ordered_for_file(file_id)
        assert len(rows_after_first) == 3

        # Second call: 2 different blocks (replaces, does not append)
        second_blocks = [_make_block(2, i, f"new block {i}") for i in range(2)]
        await repo.replace_for_file(file_id, second_blocks)
        await db_session_real.commit()

        rows_after_second = await repo.list_ordered_for_file(file_id)
        assert len(rows_after_second) == 2
        assert all(b.text.startswith("new block") for b in rows_after_second)
        assert all(b.page_number == 2 for b in rows_after_second)
    finally:
        await _cleanup(db_session_real, file_id=file_id)


@pytest.mark.asyncio
async def test_replace_for_file_idempotent_on_same_content(
    db_session_real: AsyncSession,
) -> None:
    """Calling replace_for_file twice with identical blocks yields the same result."""
    file_id = await _insert_article_file(
        db_session_real,
        project_id=SEED.primary_project,
        article_id=SEED.primary_article,
    )
    try:
        repo = ArticleTextBlockRepository(db_session_real)
        blocks = [_make_block(1, 0, "idempotent block")]

        await repo.replace_for_file(file_id, blocks)
        await db_session_real.commit()

        await repo.replace_for_file(file_id, blocks)
        await db_session_real.commit()

        ordered = await repo.list_ordered_for_file(file_id)
        assert len(ordered) == 1
        assert ordered[0].text == "idempotent block"
    finally:
        await _cleanup(db_session_real, file_id=file_id)


@pytest.mark.asyncio
async def test_list_ordered_for_file_returns_reading_order(
    db_session_real: AsyncSession,
) -> None:
    """list_ordered_for_file returns (page_number asc, block_index asc) regardless of insertion order."""
    file_id = await _insert_article_file(
        db_session_real,
        project_id=SEED.primary_project,
        article_id=SEED.primary_article,
    )
    try:
        repo = ArticleTextBlockRepository(db_session_real)
        # Insert in scrambled order
        blocks = [
            _make_block(2, 1, "p2b1"),
            _make_block(1, 1, "p1b1"),
            _make_block(2, 0, "p2b0"),
            _make_block(1, 0, "p1b0"),
        ]
        await repo.replace_for_file(file_id, blocks)
        await db_session_real.commit()

        ordered = await repo.list_ordered_for_file(file_id)
        assert [b.text for b in ordered] == ["p1b0", "p1b1", "p2b0", "p2b1"]
    finally:
        await _cleanup(db_session_real, file_id=file_id)


@pytest.mark.asyncio
async def test_replace_for_file_normalizes_unknown_block_type(
    db_session_real: AsyncSession,
) -> None:
    """replace_for_file with an out-of-set block_type persists 'paragraph' (not the raw value)."""
    file_id = await _insert_article_file(
        db_session_real,
        project_id=SEED.primary_project,
        article_id=SEED.primary_article,
    )
    try:
        repo = ArticleTextBlockRepository(db_session_real)
        block = _make_block(1, 0, "sidebar content", block_type="sidebar")
        await repo.replace_for_file(file_id, [block])
        await db_session_real.commit()

        ordered = await repo.list_ordered_for_file(file_id)
        assert len(ordered) == 1
        assert ordered[0].block_type == "paragraph"
    finally:
        await _cleanup(db_session_real, file_id=file_id)


@pytest.mark.asyncio
async def test_replace_for_file_rls_non_member_cannot_read(
    db_session_real: AsyncSession,
) -> None:
    """A non-member cannot read article_text_blocks via Supabase RLS.

    Uses the established pattern from test_blind_review_isolation.py:
    set_config('request.jwt.claims', ...) + SET LOCAL ROLE authenticated,
    then RESET ROLE to restore the session.
    """
    import json

    file_id = await _insert_article_file(
        db_session_real,
        project_id=SEED.primary_project,
        article_id=SEED.primary_article,
    )
    try:
        repo = ArticleTextBlockRepository(db_session_real)
        blocks = [_make_block(1, 0, "rls test block")]
        await repo.replace_for_file(file_id, blocks)
        await db_session_real.commit()

        # Verify the block exists as superuser before activating RLS.
        superuser_rows = (
            await db_session_real.execute(
                text("SELECT id FROM public.article_text_blocks WHERE article_file_id = :fid"),
                {"fid": str(file_id)},
            )
        ).fetchall()
        assert len(superuser_rows) == 1, "Block must exist before RLS test"

        # Activate RLS as the outsider (non-member of primary_project).
        outsider_id = SEED.outsider_profile
        try:
            await db_session_real.execute(
                text("SELECT set_config('request.jwt.claims', :claims, true)"),
                {"claims": json.dumps({"sub": str(outsider_id), "role": "authenticated"})},
            )
            await db_session_real.execute(text("SET LOCAL ROLE authenticated"))

            visible_rows = (
                await db_session_real.execute(
                    text("SELECT id FROM public.article_text_blocks WHERE article_file_id = :fid"),
                    {"fid": str(file_id)},
                )
            ).fetchall()
        finally:
            await db_session_real.execute(text("RESET ROLE"))

        assert visible_rows == [], (
            f"RLS violation: non-member can see {len(visible_rows)} rows in article_text_blocks"
        )
    finally:
        await _cleanup(db_session_real, file_id=file_id)
