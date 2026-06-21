"""Unit tests for the bake-off parser runners (no heavy libs installed)."""

from __future__ import annotations

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


def test_pymupdf_unavailable_when_lib_absent() -> None:
    # pymupdf is not a backend dependency; the import check is False here.
    assert PyMuPDFRunner().available() is False


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
