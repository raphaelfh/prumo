"""Unit tests for build_prompt_input — the prompt is always assembled from blocks."""

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
async def test_prompt_always_from_blocks_with_refs(monkeypatch) -> None:
    """A stored content_markdown that fits the budget is never the prompt: the
    prompt is assembled from the blocks and carries their refs, with assembly
    info (file identity, no truncation, a real token estimate)."""
    aid, fid = uuid4(), uuid4()
    stored = "## Results\nEffect size 0.81."
    main_file = SimpleNamespace(
        id=fid,
        content_markdown=stored,
        original_filename="teste3.pdf",
        content_version=3,
    )
    article_files = MagicMock()
    article_files.get_latest_pdf = AsyncMock(return_value=main_file)
    repo = MagicMock()
    repo.list_ordered_for_file = AsyncMock(
        return_value=[_block(1, 0, "Results", "heading"), _block(1, 1, "Effect size 0.81.")]
    )
    monkeypatch.setattr(f"{_EP}.ArticleTextBlockRepository", lambda _db: repo)

    text, info = await build_prompt_input(
        db=AsyncMock(),
        article_files=article_files,
        storage=MagicMock(),
        article_id=aid,
        model="gpt-4o-mini",
        logger=MagicMock(),
        user_id="user-1",
        trace_id="t1",
    )
    assert text == "## [p1·b0] Results\n[p1·b1] Effect size 0.81."
    assert text != stored
    assert info.anchor_file_id == fid
    assert len(info.anchor_blocks) == 2
    assert info.file_name == "teste3.pdf"
    assert info.content_version == 3
    assert info.truncated is False
    assert isinstance(info.est_tokens, int) and info.est_tokens > 0


@pytest.mark.asyncio
async def test_on_demand_parse_when_no_blocks(monkeypatch) -> None:
    """When no blocks exist, DocumentParsingService is called once, blocks reloaded."""
    aid, fid = uuid4(), uuid4()
    main_file = SimpleNamespace(
        id=fid, content_markdown=None, original_filename=None, content_version=0
    )
    article_files = MagicMock()
    article_files.get_latest_pdf = AsyncMock(return_value=main_file)

    block_after_parse = _block(1, 0, "Hello from parse", "paragraph")
    call_count = {"n": 0}

    async def _list_for_file(file_id):  # noqa: ARG001
        call_count["n"] += 1
        if call_count["n"] == 1:
            return []  # first call: no blocks yet
        # After parse, patch what the refresh would reload
        main_file.content_markdown = "Hello from parse"
        main_file.content_version = 1
        return [block_after_parse]

    repo = MagicMock()
    repo.list_ordered_for_file = AsyncMock(side_effect=_list_for_file)
    monkeypatch.setattr(f"{_EP}.ArticleTextBlockRepository", lambda _db: repo)

    mock_parsing_instance = MagicMock()
    mock_parsing_instance.parse_article_file = AsyncMock(return_value=None)
    mock_parsing_cls = MagicMock(return_value=mock_parsing_instance)
    monkeypatch.setattr(f"{_EP}.DocumentParsingService", mock_parsing_cls)

    db = AsyncMock()

    text, info = await build_prompt_input(
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
    assert info.anchor_file_id == fid
    assert info.anchor_blocks == [block_after_parse]
    assert info.content_version == 1  # read after the on-demand parse
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
async def test_budget_truncation_surfaces_on_info(monkeypatch) -> None:
    """Over the token budget, whole sections drop and the info says truncated."""
    from app.core.config import settings

    monkeypatch.setattr(settings, "LLM_ASSEMBLY_BUDGET_TOKENS", 30)
    main_file = SimpleNamespace(
        id=uuid4(), content_markdown=None, original_filename="big.pdf", content_version=1
    )
    article_files = MagicMock()
    article_files.get_latest_pdf = AsyncMock(return_value=main_file)
    repo = MagicMock()
    repo.list_ordered_for_file = AsyncMock(
        return_value=[
            _block(1, 0, "Abstract", "heading"),
            _block(1, 1, "short abstract"),
            _block(2, 0, "References", "heading"),
            _block(2, 1, "word " * 200),
        ]
    )
    monkeypatch.setattr(f"{_EP}.ArticleTextBlockRepository", lambda _db: repo)

    text, info = await build_prompt_input(
        db=AsyncMock(),
        article_files=article_files,
        storage=MagicMock(),
        article_id=uuid4(),
        model="gpt-4o-mini",
        logger=MagicMock(),
        user_id="user-1",
        trace_id="t1",
    )
    assert text == "## [p1·b0] Abstract\n[p1·b1] short abstract"
    assert info.truncated is True
    assert len(info.anchor_blocks) == 4


def test_assembled_charms_prompt_carries_no_customize_slot() -> None:
    """The seeded CHARMS default reaches the prompt as the general instruction;
    the review question comes from the project's settings, so no slot asks for it."""
    from app.llm.prompts import section_extraction
    from app.seed import _CHARMS_TEMPLATE_ID, _LLM_TEMPLATE_INSTRUCTIONS

    instruction = _LLM_TEMPLATE_INSTRUCTIONS[_CHARMS_TEMPLATE_ID]
    prompt = section_extraction.render(
        entity_name="Participants",
        entity_description="Who was studied",
        article_text="Effect size 0.81.",
        general_instructions=instruction,
        review_question="Adults with sepsis; 28-day mortality.",
    )
    assert instruction in prompt
    assert "[customize:" not in prompt
