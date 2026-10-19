"""Unit tests for the bake-off parser runners (no heavy libs installed)."""

from __future__ import annotations

from pathlib import Path

import pytest
from parsing_bakeoff.parsers import (
    REGISTRY,
    DoclingRunner,
    LlamaParseRunner,
    MarkItDownRunner,
    OpenDataLoaderRunner,
    ParserNotWiredError,
    ParseRun,
    PyMuPDFRunner,
    StubParser,
    _cells_from_markdown,
    _sections_from_markdown,
    run_from_parsed_blocks,
)
from parsing_bakeoff.scoring import Block, Box

from app.infrastructure.parsing.base import ParsedBlock
from tests.fixtures.parsing.two_column import build_two_column_pdf


def _parsed(page: int, idx: int, text: str, block_type: str, y: float) -> ParsedBlock:
    return ParsedBlock(
        page_number=page,
        block_index=idx,
        text=text,
        char_start=0,
        char_end=0,
        bbox={"x": 50.0, "y": y, "width": 200.0, "height": 10.0},
        block_type=block_type,
    )


def test_stub_parser_is_available_and_returns_preset() -> None:
    preset = ParseRun(pred_cells=["a"], elapsed_s=0.1)
    stub = StubParser(preset=preset)
    assert stub.available() is True
    assert stub.parse("anything.pdf") is preset


def test_unwired_runner_raises_with_guidance() -> None:
    with pytest.raises(ParserNotWiredError, match="OpenDataLoaderRunner"):
        OpenDataLoaderRunner().parse("x.pdf")


def test_docling_unavailable_when_lib_absent(monkeypatch) -> None:
    # Simulate docling being absent: patch _installed so find_spec returns None for docling.
    import importlib.util

    original_find_spec = importlib.util.find_spec

    def _fake_find_spec(name: str, *args, **kwargs):
        if name == "docling":
            return None
        return original_find_spec(name, *args, **kwargs)

    monkeypatch.setattr(importlib.util, "find_spec", _fake_find_spec)
    assert DoclingRunner().available() is False


def test_llamaparse_unavailable_without_key(monkeypatch) -> None:
    monkeypatch.delenv("LLAMA_CLOUD_API_KEY", raising=False)
    assert LlamaParseRunner().available() is False


def test_pymupdf_available_as_backend_dependency() -> None:
    # pymupdf (fitz) is a backend dependency since Task 3; always available here.
    assert PyMuPDFRunner().available() is True


def test_markitdown_unavailable_when_lib_absent() -> None:
    # markitdown is not a backend dependency; the import check is False here.
    assert MarkItDownRunner().available() is False


def test_markdown_helpers_extract_sections_and_cells() -> None:
    md = (
        "# Methods\n\nText.\n\n## Results\n\n"
        "| Arm | N |\n| --- | --- |\n| Control | 36 |\n| Drug | 34 |\n"
    )
    assert _sections_from_markdown(md) == ["Methods", "Results"]
    assert _cells_from_markdown(md) == ["Arm", "N", "Control", "36", "Drug", "34"]


def test_registry_covers_the_candidates() -> None:
    assert set(REGISTRY) == {
        "pymupdf",
        "markitdown",
        "docling",
        "mineru",
        "opendataloader",
        "llamaparse",
    }


def test_run_from_parsed_blocks_orders_blocks_and_derives_predictions() -> None:
    parsed = [
        _parsed(2, 0, "Discussion", "heading", 100.0),
        _parsed(1, 1, "36", "table_cell", 300.0),
        _parsed(1, 0, "Methods", "heading", 100.0),
    ]
    run = run_from_parsed_blocks(parsed, {1: 800.0, 2: 800.0}, elapsed_s=0.5)
    assert [(b.page, b.text) for b in run.blocks] == [(1, "Methods"), (1, "36"), (2, "Discussion")]
    assert run.blocks[0] == Block(1, "Methods", "heading", Box(50.0, 100.0, 200.0, 10.0))
    assert run.pred_sections == ["Methods", "Discussion"]
    assert run.pred_cells == ["36"]
    assert run.page_heights == {1: 800.0, 2: 800.0}
    assert run.elapsed_s == 0.5


def test_run_from_parsed_blocks_flips_bottom_left_boxes_to_top_left() -> None:
    # A bottom-left box at y=780 (height 10) on an 800 pt page is the top band.
    run = run_from_parsed_blocks(
        [_parsed(1, 0, "Running head", "header", 780.0)],
        {1: 800.0},
        elapsed_s=0.0,
        bottom_left_origin=True,
    )
    assert run.blocks[0].box == Box(50.0, 10.0, 200.0, 10.0)


def test_pymupdf_runner_measures_the_app_parser_after_normalization(tmp_path: Path) -> None:
    pdf = tmp_path / "two_column.pdf"
    pdf.write_bytes(build_two_column_pdf())
    run = PyMuPDFRunner().parse(str(pdf))
    assert run.error is None
    assert run.page_heights == {1: 842.0, 2: 842.0, 3: 842.0, 4: 842.0}
    # The app parser types the running heads (4.1a) and the stored text is
    # normalized: the fixture's zero-width space never reaches a block.
    assert {"header"} <= {b.block_type for b in run.blocks}
    assert not any("\u200b" in b.text for b in run.blocks)
    assert run.elapsed_s > 0.0
