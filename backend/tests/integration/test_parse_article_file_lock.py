"""Integration test: advisory lock is acquired before the block write.

DocumentParsingService.parse_article_file must call
``pg_advisory_xact_lock(hashtext(:k))`` immediately before
``ArticleTextBlockRepository.replace_for_file`` so that a concurrent
re-parse Retry serializes on the write instead of interleaving two
delete-then-insert passes.

The test spies on the real db_session_real.execute so the lock SQL
actually hits Postgres — it is not mocked out.
"""

from __future__ import annotations

import uuid
from unittest.mock import patch

import pytest
import pytest_asyncio
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.infrastructure.parsing.base import DocumentParser, ParsedBlock
from tests.integration.conftest import SEED

# ---------------------------------------------------------------------------
# Lightweight stubs
# ---------------------------------------------------------------------------


class _StubParser(DocumentParser):
    """Returns a single ParsedBlock — enough for a successful parse path."""

    def parse(self, pdf_bytes: bytes) -> list[ParsedBlock]:  # noqa: ARG002
        return [
            ParsedBlock(
                page_number=1,
                block_index=0,
                text="Lock test",
                char_start=0,
                char_end=0,
                bbox={"x": 0.0, "y": 0.0, "width": 1.0, "height": 1.0},
                block_type="paragraph",
            )
        ]


class _StubStorage:
    """Returns minimal PDF bytes without touching real storage."""

    async def download(self, bucket: str, key: str) -> bytes:  # noqa: ARG002
        return b"%PDF-1.4 stub"


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def seeded_article_file(db_session_real: AsyncSession):
    """Insert a pending ArticleFile row; yield it; clean up after the test."""
    from app.models.article import ArticleFile

    file_id = uuid.uuid4()
    await db_session_real.execute(
        text(
            "INSERT INTO public.article_files "
            "(id, project_id, article_id, file_type, storage_key, file_role) "
            "VALUES (:id, :pid, :aid, 'pdf', :key, 'MAIN')"
        ),
        {
            "id": str(file_id),
            "pid": str(SEED.primary_project),
            "aid": str(SEED.primary_article),
            "key": f"articles/{file_id}.pdf",
        },
    )
    await db_session_real.commit()

    from sqlalchemy import select

    af = (
        await db_session_real.execute(select(ArticleFile).where(ArticleFile.id == file_id))
    ).scalar_one()

    yield af

    await db_session_real.execute(
        text("DELETE FROM public.article_files WHERE id = :id"),
        {"id": str(file_id)},
    )
    await db_session_real.commit()


# ---------------------------------------------------------------------------
# Test
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_parse_acquires_advisory_lock_before_write(
    seeded_article_file, db_session_real: AsyncSession
) -> None:
    """parse_article_file must take pg_advisory_xact_lock before replace_for_file."""
    from app.services.document_parsing_service import DocumentParsingService

    svc = DocumentParsingService(
        db=db_session_real,
        user_id=str(SEED.primary_profile),
        storage=_StubStorage(),
        parser=_StubParser(),
        trace_id="lock-test",
    )
    calls: list[str] = []
    orig_execute = db_session_real.execute

    async def _spy(stmt, *a, **k):
        calls.append(str(stmt))
        return await orig_execute(stmt, *a, **k)

    with patch.object(db_session_real, "execute", side_effect=_spy):
        await svc.parse_article_file(seeded_article_file.id)

    assert any("pg_advisory_xact_lock" in c for c in calls), (
        "lock not acquired; observed SQL calls:\n" + "\n".join(f"  {c!r}" for c in calls)
    )

    # Lock must precede the block write (DELETE or INSERT on article_text_blocks).
    lock_idx = next(i for i, c in enumerate(calls) if "pg_advisory_xact_lock" in c)
    write_candidates = [
        i
        for i, c in enumerate(calls)
        if "article_text_blocks" in c and ("DELETE" in c.upper() or "INSERT" in c.upper())
    ]
    assert write_candidates, "no block write detected; observed SQL calls:\n" + "\n".join(
        f"  {c!r}" for c in calls
    )
    first_write_idx = min(write_candidates)
    assert lock_idx < first_write_idx, (
        f"lock (index {lock_idx}) did not precede block write (index {first_write_idx}); "
        "calls:\n" + "\n".join(f"  [{i}] {c!r}" for i, c in enumerate(calls))
    )
