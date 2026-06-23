"""Unit tests for build_prompt_input — the two extraction text-source paths."""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest

from app.infrastructure.parsing.base import ParsedBlock
from app.services.extraction_prompt_input import build_prompt_input

_EP = "app.services.extraction_prompt_input"


def _block(page, idx, text, bt="paragraph"):
    return ParsedBlock(page, idx, text, 0, len(text), {}, bt)


@pytest.mark.asyncio
async def test_uses_blocks_when_present(monkeypatch) -> None:
    aid, fid = uuid4(), uuid4()
    main_file = SimpleNamespace(id=fid)
    article_files = MagicMock()
    article_files.get_latest_pdf = AsyncMock(return_value=main_file)
    repo = MagicMock()
    repo.list_ordered_for_file = AsyncMock(
        return_value=[_block(1, 0, "Results", "heading"), _block(1, 1, "Effect size 0.81.")]
    )
    monkeypatch.setattr(f"{_EP}.ArticleTextBlockRepository", lambda _db: repo)
    pdf_processor = MagicMock()
    pdf_processor.extract_text = AsyncMock()  # must NOT be called on the blocks path

    text, blocks, file_id = await build_prompt_input(
        db=AsyncMock(),
        article_files=article_files,
        pdf_processor=pdf_processor,
        get_pdf=AsyncMock(),
        article_id=aid,
        model="gpt-4o-mini",
        logger=MagicMock(),
    )
    assert "## Results" in text and "Effect size 0.81." in text
    assert file_id == fid and len(blocks) == 2
    pdf_processor.extract_text.assert_not_awaited()


@pytest.mark.asyncio
async def test_falls_back_to_pypdf_when_no_blocks() -> None:
    aid = uuid4()
    article_files = MagicMock()
    article_files.get_latest_pdf = AsyncMock(return_value=None)  # no PDF file row → no blocks
    pdf_processor = MagicMock()
    pdf_processor.extract_text = AsyncMock(return_value="[Page 1]\nFallback body text.")

    text, blocks, file_id = await build_prompt_input(
        db=AsyncMock(),
        article_files=article_files,
        pdf_processor=pdf_processor,
        get_pdf=AsyncMock(return_value=b"%PDF"),
        article_id=aid,
        model="gpt-4o-mini",
        logger=MagicMock(),
    )
    assert "Fallback body text." in text
    assert blocks == [] and file_id is None
    pdf_processor.extract_text.assert_awaited_once()
