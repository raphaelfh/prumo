"""Integration tests for DocumentParsingService.

Tests:
- Success path: downloads bytes, runs parser, persists blocks (exact fields),
  sets extraction_status to 'parsed', returns correct DocumentParsingResult.
- Failure path: parser raises -> extraction_status becomes 'parse_failed',
  exception propagates.

Uses db_session_real (deferred triggers). Fakes a StorageAdapter and a
DocumentParser — the storage fake returns dummy bytes; the parser fake
returns a fixed list of ParsedBlock spanning >=2 pages.
"""

from __future__ import annotations

import uuid
from uuid import UUID

import pytest
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.infrastructure.parsing.base import DocumentParser, ParsedBlock
from app.infrastructure.storage.base import StorageAdapter
from app.models.article import ArticleFile
from app.repositories.article_text_block_repository import ArticleTextBlockRepository
from app.services.document_parsing_service import DocumentParsingResult, DocumentParsingService
from tests.integration.conftest import SEED

# ---------------------------------------------------------------------------
# Fakes
# ---------------------------------------------------------------------------


class FakeStorageAdapter(StorageAdapter):
    """Minimal StorageAdapter that returns a fixed bytes payload."""

    def __init__(self, payload: bytes = b"%PDF-1.4 fake") -> None:
        self._payload = payload
        self.downloaded: list[tuple[str, str]] = []

    async def download(self, bucket: str, path: str) -> bytes:
        self.downloaded.append((bucket, path))
        return self._payload

    # --- unused abstract methods ---
    async def upload(
        self, bucket: str, path: str, data: bytes, content_type: str = "application/octet-stream"
    ) -> str:
        raise NotImplementedError

    async def delete(self, bucket: str, path: str) -> bool:
        raise NotImplementedError

    async def exists(self, bucket: str, path: str) -> bool:
        raise NotImplementedError

    async def get_public_url(self, bucket: str, path: str) -> str:
        raise NotImplementedError

    async def get_signed_url(self, bucket: str, path: str, expires_in: int = 3600) -> str:
        raise NotImplementedError

    async def list_files(self, bucket: str, prefix: str = "", limit: int = 100) -> list[dict]:
        raise NotImplementedError


class FakeParser(DocumentParser):
    """Returns a fixed list of 3 ParsedBlock objects spanning 2 pages.

    Offsets are intentionally left as 0 so the service's
    assign_char_offsets_to_blocks call is what sets correct values.
    """

    FIXED_BLOCKS: list[ParsedBlock] = [
        ParsedBlock(
            page_number=1,
            block_index=0,
            text="Hello world",
            char_start=0,
            char_end=0,  # service must normalise
            bbox={"x": 0.0, "y": 0.0, "width": 100.0, "height": 12.0},
            block_type="paragraph",
        ),
        ParsedBlock(
            page_number=1,
            block_index=1,
            text="Second block",
            char_start=0,
            char_end=0,
            bbox={"x": 0.0, "y": 20.0, "width": 100.0, "height": 12.0},
            block_type="heading",
        ),
        ParsedBlock(
            page_number=2,
            block_index=0,
            text="Page two content",
            char_start=0,
            char_end=0,
            bbox={"x": 0.0, "y": 0.0, "width": 100.0, "height": 12.0},
            block_type="paragraph",
        ),
    ]

    def parse(self, pdf_bytes: bytes) -> list[ParsedBlock]:  # noqa: ARG002
        # Return fresh copies so tests don't mutate the class-level defaults.
        import copy

        return copy.deepcopy(self.FIXED_BLOCKS)


class BrokenParser(DocumentParser):
    """Always raises ValueError to test the failure path."""

    def parse(self, pdf_bytes: bytes) -> list[ParsedBlock]:  # noqa: ARG002
        raise ValueError("Simulated parser failure")


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
            "key": f"articles/{file_id}.pdf",
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


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_parse_article_file_success(
    db_session_real: AsyncSession,
) -> None:
    """Service downloads bytes, persists blocks, sets status='parsed', returns correct result."""
    file_id = await _insert_article_file(
        db_session_real,
        project_id=SEED.primary_project,
        article_id=SEED.primary_article,
    )
    try:
        storage = FakeStorageAdapter()
        parser = FakeParser()
        service = DocumentParsingService(
            db=db_session_real,
            user_id=str(SEED.primary_profile),
            storage=storage,
            parser=parser,
            trace_id="test-trace-1",
        )

        result = await service.parse_article_file(file_id)
        await db_session_real.commit()

        # --- storage was called with the right bucket + key ---
        assert len(storage.downloaded) == 1
        bucket, path = storage.downloaded[0]
        assert bucket == "articles"
        assert path.endswith(".pdf")

        # --- result shape ---
        assert isinstance(result, DocumentParsingResult)
        assert result.block_count == 3
        assert result.page_count == 2  # pages 1 and 2
        assert result.status == "parsed"

        # --- blocks persisted in reading order ---
        repo = ArticleTextBlockRepository(db_session_real)
        blocks = await repo.list_ordered_for_file(file_id)
        assert len(blocks) == 3

        b0 = blocks[0]
        assert b0.page_number == 1
        assert b0.block_index == 0
        assert b0.text == "Hello world"
        # char offsets must be normalised by assign_char_offsets_to_blocks
        assert b0.char_start == 0
        assert b0.char_end == len("Hello world")

        b1 = blocks[1]
        assert b1.page_number == 1
        assert b1.block_index == 1
        assert b1.text == "Second block"
        # offset: len("Hello world") + 1 separator
        assert b1.char_start == len("Hello world") + 1
        assert b1.char_end == len("Hello world") + 1 + len("Second block")

        b2 = blocks[2]
        assert b2.page_number == 2
        assert b2.block_index == 0
        assert b2.text == "Page two content"
        # page 2 starts its own cursor at 0
        assert b2.char_start == 0
        assert b2.char_end == len("Page two content")

        # --- extraction_status flipped ---
        article_file = (
            await db_session_real.execute(select(ArticleFile).where(ArticleFile.id == file_id))
        ).scalar_one()
        assert article_file.extraction_status == "parsed"

    finally:
        await _cleanup(db_session_real, file_id=file_id)


@pytest.mark.asyncio
async def test_parse_article_file_parser_error_sets_parse_failed_and_reraises(
    db_session_real: AsyncSession,
) -> None:
    """When the parser raises, extraction_status becomes 'parse_failed' and the exception propagates."""
    file_id = await _insert_article_file(
        db_session_real,
        project_id=SEED.primary_project,
        article_id=SEED.primary_article,
    )
    try:
        storage = FakeStorageAdapter()
        parser = BrokenParser()
        service = DocumentParsingService(
            db=db_session_real,
            user_id=str(SEED.primary_profile),
            storage=storage,
            parser=parser,
            trace_id="test-trace-2",
        )

        with pytest.raises(ValueError, match="Simulated parser failure"):
            await service.parse_article_file(file_id)

        # Flush happened inside the service; check the status in the same session.
        # (No commit; we are checking the in-flight flushed state.)
        article_file = (
            await db_session_real.execute(select(ArticleFile).where(ArticleFile.id == file_id))
        ).scalar_one()
        assert article_file.extraction_status == "parse_failed"

        # Commit what the service flushed so cleanup can see it.
        await db_session_real.commit()
    finally:
        await _cleanup(db_session_real, file_id=file_id)


@pytest.mark.asyncio
async def test_parse_persists_content_markdown_and_bumps_version(
    db_session_real: AsyncSession,
) -> None:
    """After a successful parse, content_markdown == render_blocks_to_markdown(blocks)
    and content_version is incremented by one, in the same transaction as the blocks."""
    from app.infrastructure.parsing.base import render_blocks_to_markdown

    file_id = await _insert_article_file(
        db_session_real,
        project_id=SEED.primary_project,
        article_id=SEED.primary_article,
    )
    try:
        storage = FakeStorageAdapter()
        parser = FakeParser()
        service = DocumentParsingService(
            db=db_session_real,
            user_id=str(SEED.primary_profile),
            storage=storage,
            parser=parser,
            trace_id="test-trace-md",
        )

        article_file = (
            await db_session_real.execute(select(ArticleFile).where(ArticleFile.id == file_id))
        ).scalar_one()
        before = article_file.content_version

        await service.parse_article_file(file_id)
        await db_session_real.refresh(article_file)

        expected_md = render_blocks_to_markdown(FakeParser.FIXED_BLOCKS)
        assert article_file.content_markdown == expected_md
        assert article_file.content_version == before + 1

        await db_session_real.commit()
    finally:
        await _cleanup(db_session_real, file_id=file_id)
