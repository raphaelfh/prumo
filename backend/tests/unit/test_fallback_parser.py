"""Unit tests for FallbackDocumentParser.

The cloud LlamaParse path can block, time out, or error (see
parsing_tasks + the 2h-blocking SDK call). FallbackDocumentParser wraps a
primary parser so that any primary failure degrades to a secondary parser
(PyMuPDF) instead of leaving the ArticleFile stuck at ``pending`` forever.
"""

from __future__ import annotations

import pytest

from app.infrastructure.parsing.base import DocumentParser, ParsedBlock
from app.infrastructure.parsing.fallback_parser import FallbackDocumentParser


def _block(text: str) -> ParsedBlock:
    return ParsedBlock(
        page_number=1,
        block_index=0,
        text=text,
        char_start=0,
        char_end=len(text),
        bbox={"x": 0.0, "y": 0.0, "width": 0.0, "height": 0.0},
        block_type="paragraph",
    )


class _StubParser(DocumentParser):
    def __init__(
        self, *, blocks: list[ParsedBlock] | None = None, error: Exception | None = None
    ) -> None:
        self._blocks = blocks or []
        self._error = error
        self.calls = 0

    def parse(self, pdf_bytes: bytes) -> list[ParsedBlock]:  # noqa: ARG002
        self.calls += 1
        if self._error is not None:
            raise self._error
        return self._blocks


def test_uses_primary_when_it_succeeds() -> None:
    primary = _StubParser(blocks=[_block("primary")])
    fallback = _StubParser(blocks=[_block("fallback")])
    parser = FallbackDocumentParser(primary=primary, fallback=fallback)

    out = parser.parse(b"%PDF-1.4")

    assert [b.text for b in out] == ["primary"]
    assert primary.calls == 1
    assert fallback.calls == 0  # fallback must NOT run when primary works


def test_falls_back_when_primary_raises() -> None:
    primary = _StubParser(error=RuntimeError("llamaparse timed out"))
    fallback = _StubParser(blocks=[_block("fallback")])
    parser = FallbackDocumentParser(primary=primary, fallback=fallback)

    out = parser.parse(b"%PDF-1.4")

    assert [b.text for b in out] == ["fallback"]
    assert primary.calls == 1
    assert fallback.calls == 1


def test_propagates_when_fallback_also_fails() -> None:
    # If BOTH fail there is nothing to degrade to — the error must reach the
    # service so the ArticleFile is marked parse_failed (not silently lost).
    primary = _StubParser(error=RuntimeError("primary boom"))
    fallback = _StubParser(error=ValueError("fallback boom too"))
    parser = FallbackDocumentParser(primary=primary, fallback=fallback)

    with pytest.raises(ValueError, match="fallback boom too"):
        parser.parse(b"%PDF-1.4")


def test_exposes_primary_and_fallback_for_inspection() -> None:
    primary = _StubParser(blocks=[])
    fallback = _StubParser(blocks=[])
    parser = FallbackDocumentParser(primary=primary, fallback=fallback)

    assert parser.primary is primary
    assert parser.fallback is fallback
