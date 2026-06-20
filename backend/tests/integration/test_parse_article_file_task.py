"""Integration tests for parse_article_file_task._run_parse.

Tests exercise the inner async coroutine directly (db=db_session_real),
bypassing Celery's event loop and worker_session() so we can inspect DB
state inline.

Success path:
    _FakeParser returns one ParsedBlock → ArticleTextBlock row persisted,
    ArticleFile.extraction_status == "parsed".

Error path:
    _BoomParser raises → exception propagates, ArticleFile.extraction_status
    == "parse_failed" (flushed by DocumentParsingService before re-raising;
    check is done before commit so the flushed state is visible).

Retry path (unit-level):
    A targeted mock of _run_parse confirms the Celery wrapper calls
    self.retry on exception — no live network or Celery worker needed.
"""

from __future__ import annotations

import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.infrastructure.parsing.base import ParsedBlock
from app.models.article import ArticleFile, ArticleTextBlock
from tests.integration.conftest import SEED

# ---------------------------------------------------------------------------
# Lightweight parser fakes (not subclassing ABC so no parse() type check)
# ---------------------------------------------------------------------------


class _FakeParser:
    """Returns a single ParsedBlock on every call."""

    def parse(self, pdf_bytes: bytes) -> list[ParsedBlock]:  # noqa: ARG002
        return [
            ParsedBlock(
                page_number=1,
                block_index=0,
                text="Hello",
                char_start=0,
                char_end=0,
                bbox={"x": 0.0, "y": 0.0, "width": 1.0, "height": 1.0},
                block_type="paragraph",
            )
        ]


class _BoomParser:
    """Always raises ValueError to exercise the error path."""

    def parse(self, pdf_bytes: bytes) -> list[ParsedBlock]:  # noqa: ARG002
        raise ValueError("parse exploded")


# ---------------------------------------------------------------------------
# DB helpers (mirrors test_document_parsing_service.py)
# ---------------------------------------------------------------------------


async def _insert_article_file(
    db: AsyncSession, *, project_id: uuid.UUID, article_id: uuid.UUID
) -> uuid.UUID:
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
            "key": f"articles/{file_id}.pdf",
        },
    )
    await db.commit()
    return file_id


async def _cleanup(db: AsyncSession, *, file_id: uuid.UUID) -> None:
    await db.execute(
        text("DELETE FROM public.article_files WHERE id = :id"),
        {"id": str(file_id)},
    )
    await db.commit()


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_task_populates_blocks_and_flips_status(db_session_real: AsyncSession) -> None:
    """Success: one block persisted, extraction_status='parsed'."""
    file_id = await _insert_article_file(
        db_session_real,
        project_id=SEED.primary_project,
        article_id=SEED.primary_article,
    )
    try:
        with (
            patch("app.core.factories.create_document_parser", return_value=_FakeParser()),
            patch("app.core.factories.create_storage_adapter") as storage_factory,
            patch("app.core.deps.get_supabase_client", return_value=MagicMock()),
        ):
            storage_factory.return_value.download = AsyncMock(return_value=b"%PDF-1.4 fake")

            from app.worker.tasks.parsing_tasks import _run_parse

            await _run_parse(
                str(file_id),
                str(SEED.primary_project),
                str(SEED.primary_profile),
                trace_id="t-1",
                db=db_session_real,
            )
            await db_session_real.commit()

        blocks = (
            (
                await db_session_real.execute(
                    select(ArticleTextBlock).where(ArticleTextBlock.article_file_id == file_id)
                )
            )
            .scalars()
            .all()
        )
        assert len(blocks) == 1
        assert blocks[0].text == "Hello"

        af = (
            await db_session_real.execute(select(ArticleFile).where(ArticleFile.id == file_id))
        ).scalar_one()
        assert af.extraction_status == "parsed"
    finally:
        await _cleanup(db_session_real, file_id=file_id)


@pytest.mark.asyncio
async def test_task_error_sets_parse_failed_and_reraises(db_session_real: AsyncSession) -> None:
    """Error: _BoomParser raises; extraction_status flushed to 'parse_failed'."""
    file_id = await _insert_article_file(
        db_session_real,
        project_id=SEED.primary_project,
        article_id=SEED.primary_article,
    )
    try:
        with (
            patch("app.core.factories.create_document_parser", return_value=_BoomParser()),
            patch("app.core.factories.create_storage_adapter") as storage_factory,
            patch("app.core.deps.get_supabase_client", return_value=MagicMock()),
        ):
            storage_factory.return_value.download = AsyncMock(return_value=b"%PDF-1.4 fake")

            from app.worker.tasks.parsing_tasks import _run_parse

            with pytest.raises(ValueError, match="parse exploded"):
                await _run_parse(
                    str(file_id),
                    str(SEED.primary_project),
                    str(SEED.primary_profile),
                    trace_id="t-2",
                    db=db_session_real,
                )

        # Service flushed parse_failed before re-raising — visible in this session.
        af = (
            await db_session_real.execute(select(ArticleFile).where(ArticleFile.id == file_id))
        ).scalar_one()
        assert af.extraction_status == "parse_failed"

        await db_session_real.commit()
    finally:
        await _cleanup(db_session_real, file_id=file_id)


def test_celery_task_calls_retry_on_exception() -> None:
    """The Celery wrapper calls self.retry when _run_parse raises.

    Patches parse_article_file_task.retry so self.retry is intercepted
    without needing a live Celery worker or injecting a fake self.
    """
    from app.worker.tasks.parsing_tasks import parse_article_file_task

    mock_retry = MagicMock(side_effect=Exception("retry called"))
    with (
        patch("app.worker._runner.run_task", side_effect=ValueError("boom")),
        patch.object(parse_article_file_task, "retry", mock_retry),
        pytest.raises(Exception, match="retry called"),
    ):
        parse_article_file_task.run(
            "00000000-0000-0000-0000-000000000001",
            "00000000-0000-0000-0000-000000000002",
            "00000000-0000-0000-0000-000000000003",
            trace_id=None,
        )

    mock_retry.assert_called_once()
