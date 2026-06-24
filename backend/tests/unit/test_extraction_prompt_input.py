"""Unit tests for build_prompt_input — the stored-markdown and budgeted-blocks paths."""

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
async def test_uses_stored_markdown_when_blocks_present(monkeypatch) -> None:
    """When blocks exist and stored_markdown fits the budget, returns it directly."""
    aid, fid = uuid4(), uuid4()
    main_file = SimpleNamespace(id=fid, content_markdown="# Results\n\nEffect size 0.81.")
    article_files = MagicMock()
    article_files.get_latest_pdf = AsyncMock(return_value=main_file)
    repo = MagicMock()
    repo.list_ordered_for_file = AsyncMock(
        return_value=[_block(1, 0, "Results", "heading"), _block(1, 1, "Effect size 0.81.")]
    )
    monkeypatch.setattr(f"{_EP}.ArticleTextBlockRepository", lambda _db: repo)

    text, blocks, file_id = await build_prompt_input(
        db=AsyncMock(),
        article_files=article_files,
        storage=MagicMock(),
        article_id=aid,
        model="gpt-4o-mini",
        logger=MagicMock(),
        user_id="user-1",
        trace_id="t1",
    )
    assert "Results" in text and "Effect size 0.81." in text
    assert file_id == fid
    assert len(blocks) == 2


@pytest.mark.asyncio
async def test_on_demand_parse_when_no_blocks(monkeypatch) -> None:
    """When no blocks exist, DocumentParsingService is called once, blocks reloaded."""
    aid, fid = uuid4(), uuid4()
    main_file = SimpleNamespace(id=fid, content_markdown=None)
    article_files = MagicMock()
    article_files.get_latest_pdf = AsyncMock(return_value=main_file)

    block_after_parse = _block(1, 0, "Hello from parse", "paragraph")
    call_count = {"n": 0}

    async def _list_for_file(file_id):  # noqa: ARG001
        call_count["n"] += 1
        if call_count["n"] == 1:
            return []  # first call: no blocks yet
        # After parse, patch main_file.content_markdown
        main_file.content_markdown = "Hello from parse"
        return [block_after_parse]

    repo = MagicMock()
    repo.list_ordered_for_file = AsyncMock(side_effect=_list_for_file)
    monkeypatch.setattr(f"{_EP}.ArticleTextBlockRepository", lambda _db: repo)

    mock_parsing_instance = MagicMock()
    mock_parsing_instance.parse_article_file = AsyncMock(return_value=None)
    mock_parsing_cls = MagicMock(return_value=mock_parsing_instance)
    monkeypatch.setattr(f"{_EP}.DocumentParsingService", mock_parsing_cls)

    db = AsyncMock()

    text, blocks, file_id = await build_prompt_input(
        db=db,
        article_files=article_files,
        storage=MagicMock(),
        article_id=aid,
        model="gpt-4o-mini",
        logger=MagicMock(),
        user_id="user-1",
        trace_id="t1",
    )

    mock_parsing_instance.parse_article_file.assert_awaited_once_with(fid)
    db.refresh.assert_awaited_once_with(main_file)
    assert file_id == fid
    assert blocks == [block_after_parse]
    assert "Hello from parse" in text


@pytest.mark.asyncio
async def test_raises_when_no_pdf_file() -> None:
    """FileNotFoundError when get_latest_pdf returns None."""
    article_files = MagicMock()
    article_files.get_latest_pdf = AsyncMock(return_value=None)

    with pytest.raises(FileNotFoundError):
        await build_prompt_input(
            db=AsyncMock(),
            article_files=article_files,
            storage=MagicMock(),
            article_id=uuid4(),
            model="gpt-4o-mini",
            logger=MagicMock(),
            user_id="user-1",
            trace_id="t1",
        )


@pytest.mark.asyncio
async def test_falls_back_to_assembler_when_markdown_over_budget(monkeypatch) -> None:
    """When stored_markdown exceeds token budget, assemble_for_model is used instead."""
    aid, fid = uuid4(), uuid4()
    large_md = "x" * 10_000
    main_file = SimpleNamespace(id=fid, content_markdown=large_md)
    article_files = MagicMock()
    article_files.get_latest_pdf = AsyncMock(return_value=main_file)
    repo = MagicMock()
    repo.list_ordered_for_file = AsyncMock(return_value=[_block(1, 0, "Short text", "paragraph")])
    monkeypatch.setattr(f"{_EP}.ArticleTextBlockRepository", lambda _db: repo)

    # Force estimate_tokens to return a value over budget
    monkeypatch.setattr(f"{_EP}.estimate_tokens", lambda _text, _model: 999_999)

    from app.schemas.extraction import AssemblyInfo

    mock_info = AssemblyInfo(total_blocks=1, included_blocks=1, truncated=False, est_tokens=50)
    mock_assemble = MagicMock(return_value=("assembled text", mock_info))
    monkeypatch.setattr(f"{_EP}.assemble_for_model", mock_assemble)

    text, blocks, file_id = await build_prompt_input(
        db=AsyncMock(),
        article_files=article_files,
        storage=MagicMock(),
        article_id=aid,
        model="gpt-4o-mini",
        logger=MagicMock(),
        user_id="user-1",
        trace_id="t1",
    )

    mock_assemble.assert_called_once()
    assert text == "assembled text"
    assert file_id == fid
