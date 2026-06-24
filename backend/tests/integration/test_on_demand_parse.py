"""Integration test: on-demand parse-once + stored-markdown reuse.

Verifies that build_prompt_input:
1. Triggers PymupdfParser exactly ONCE when the ArticleFile has no blocks.
2. Returns non-empty markdown + blocks + file_id on first call.
3. Does NOT re-parse on a second call (parse count stays at 1, markdown identical).
"""

from __future__ import annotations

import uuid
from uuid import UUID

import fitz
import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.infrastructure.parsing import pymupdf_parser
from app.infrastructure.storage.base import StorageAdapter
from app.repositories import ArticleFileRepository
from app.services import extraction_prompt_input as epi
from tests.integration.conftest import SEED

# ---------------------------------------------------------------------------
# Fake storage that returns a real one-page PDF
# ---------------------------------------------------------------------------

_STORAGE_KEY = "articles/test-on-demand-parse.pdf"


def _one_page_pdf() -> bytes:
    doc = fitz.open()
    page = doc.new_page()
    page.insert_text((72, 72), "Methods\nWe enrolled 100 patients.", fontsize=11)
    return doc.tobytes()


class _StubStorage(StorageAdapter):
    """Returns a real one-page PDF so PymupdfParser yields real blocks."""

    def __init__(self, payload: bytes) -> None:
        self._payload = payload

    async def download(self, bucket: str, path: str) -> bytes:  # noqa: ARG002
        return self._payload

    async def upload(self, bucket: str, path: str, data: bytes, content_type: str = "") -> str:
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


# ---------------------------------------------------------------------------
# DB helpers
# ---------------------------------------------------------------------------


async def _insert_article_file(db: AsyncSession, *, article_id: UUID, project_id: UUID) -> UUID:
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
# Test
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_unparsed_article_parses_once_then_reuses(
    db_session_real: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """First call triggers parse (call count = 1); second call reuses stored markdown (count stays 1)."""
    calls: dict[str, int] = {"n": 0}
    real_parse = pymupdf_parser.PymupdfParser.parse

    def _counting_parse(self: pymupdf_parser.PymupdfParser, pdf_bytes: bytes) -> list:
        calls["n"] += 1
        return real_parse(self, pdf_bytes)

    monkeypatch.setattr(pymupdf_parser.PymupdfParser, "parse", _counting_parse)

    pdf_payload = _one_page_pdf()
    storage = _StubStorage(pdf_payload)

    file_id = await _insert_article_file(
        db_session_real,
        article_id=SEED.primary_article,
        project_id=SEED.primary_project,
    )
    try:
        article_files = ArticleFileRepository(db_session_real)

        # --- First call: should parse exactly once ---
        md1, blocks1, anchor_file_id = await epi.build_prompt_input(
            db=db_session_real,
            article_files=article_files,
            storage=storage,
            article_id=SEED.primary_article,
            model="gpt-4o-mini",
            logger=_noop_logger(),
            user_id=str(SEED.primary_profile),
            trace_id="test-trace-on-demand",
        )
        await db_session_real.commit()

        assert calls["n"] == 1, f"Expected 1 parse call; got {calls['n']}"
        assert blocks1, "Expected non-empty blocks after parse"
        assert anchor_file_id == file_id
        assert md1.strip(), "Expected non-empty markdown"

        # --- Second call: should reuse, NOT re-parse ---
        md2, blocks2, _ = await epi.build_prompt_input(
            db=db_session_real,
            article_files=article_files,
            storage=storage,
            article_id=SEED.primary_article,
            model="gpt-4o-mini",
            logger=_noop_logger(),
            user_id=str(SEED.primary_profile),
            trace_id="test-trace-on-demand-2",
        )

        assert calls["n"] == 1, f"Parse called again on second invocation (count={calls['n']})"
        assert md2 == md1, "Markdown changed between calls"

    finally:
        await _cleanup(db_session_real, file_id=file_id)


# ---------------------------------------------------------------------------
# Minimal structured-log-compatible no-op logger
# ---------------------------------------------------------------------------


class _NoopLogger:
    def info(self, *_a: object, **_kw: object) -> None:  # noqa: ANN401
        pass

    def bind(self, **_kw: object) -> _NoopLogger:
        return self


def _noop_logger() -> _NoopLogger:
    return _NoopLogger()
