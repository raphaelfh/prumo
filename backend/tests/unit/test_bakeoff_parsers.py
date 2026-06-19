"""Unit tests for the bake-off parser runners (no heavy libs installed)."""

from __future__ import annotations

import pytest
from parsing_bakeoff.parsers import (
    REGISTRY,
    DoclingRunner,
    LlamaParseRunner,
    ParserNotWiredError,
    ParseRun,
    StubParser,
)


def test_stub_parser_is_available_and_returns_preset() -> None:
    preset = ParseRun(pred_cells=["a"], elapsed_s=0.1)
    stub = StubParser(preset=preset)
    assert stub.available() is True
    assert stub.parse("anything.pdf") is preset


def test_unwired_runner_raises_with_guidance() -> None:
    with pytest.raises(ParserNotWiredError, match="DoclingRunner"):
        DoclingRunner().parse("x.pdf")


def test_docling_unavailable_when_lib_absent() -> None:
    # docling is not a dependency of the backend, so the import check is False.
    assert DoclingRunner().available() is False


def test_llamaparse_unavailable_without_key(monkeypatch) -> None:
    monkeypatch.delenv("LLAMA_CLOUD_API_KEY", raising=False)
    assert LlamaParseRunner().available() is False


def test_registry_covers_the_four_candidates() -> None:
    assert set(REGISTRY) == {"docling", "mineru", "opendataloader", "llamaparse"}
