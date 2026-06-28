"""Unit tests for the LlamaParse result -> ParsedBlock mapping.

These build *real* ``llama_cloud`` 2.x response models (not duck-typed fakes)
so the mapper is pinned to the SDK's actual ``items.pages[].items[]`` shape
and cannot silently drift back to the old (broken) flat ``result.items``
assumption that produced zero blocks in production.
"""

from __future__ import annotations

import pytest
from llama_cloud.types.b_box import BBox
from llama_cloud.types.heading_item import HeadingItem
from llama_cloud.types.parsing_get_response import (
    Items,
    ItemsPageFailedStructuredPage,
    ItemsPageStructuredResultPage,
    Markdown,
    MarkdownPageMarkdownResultPage,
    ParsingGetResponse,
)
from llama_cloud.types.text_item import TextItem

from app.infrastructure.parsing.llamaparse_parser import LlamaParseParser


def _response(
    *, items: Items | None = None, markdown: Markdown | None = None
) -> ParsingGetResponse:
    """Build a minimal ParsingGetResponse with only the fields the mapper reads."""
    return ParsingGetResponse.model_construct(items=items, markdown=markdown)


def test_maps_structured_page_items_to_blocks_with_y_flip() -> None:
    heading = HeadingItem(
        type="heading",
        level=1,
        value="Title",
        md="# Title",
        bbox=[BBox(x=5.0, y=5.0, w=200.0, h=20.0)],
    )
    text = TextItem(
        type="text",
        value="Hello world",
        md="Hello world",
        bbox=[BBox(x=10.0, y=20.0, w=100.0, h=12.0)],
    )
    page = ItemsPageStructuredResultPage(
        items=[heading, text], page_height=800.0, page_number=1, page_width=600.0, success=True
    )
    result = _response(items=Items(pages=[page]))

    blocks = LlamaParseParser._map_result(result)

    assert [b.text for b in blocks] == ["Title", "Hello world"]
    assert [b.block_type for b in blocks] == ["heading", "paragraph"]
    assert [b.page_number for b in blocks] == [1, 1]
    assert [b.block_index for b in blocks] == [0, 1]
    # Y-flip from top-left origin to PDF bottom-left: y_bottom = page_h - y_top - h.
    assert blocks[0].bbox == {"x": 5.0, "y": 775.0, "width": 200.0, "height": 20.0}
    assert blocks[1].bbox == {"x": 10.0, "y": 768.0, "width": 100.0, "height": 12.0}


def test_skips_failed_pages_and_empty_items() -> None:
    good = ItemsPageStructuredResultPage(
        items=[TextItem(type="text", value="keep", md="keep", bbox=None)],
        page_height=500.0,
        page_number=2,
        page_width=400.0,
        success=True,
    )
    failed = ItemsPageFailedStructuredPage(error="boom", page_number=1, success=False)
    result = _response(items=Items(pages=[failed, good]))

    blocks = LlamaParseParser._map_result(result)

    assert len(blocks) == 1
    assert blocks[0].text == "keep"
    assert blocks[0].page_number == 2
    # No bbox on the item -> sentinel (DB column is NOT NULL).
    assert blocks[0].bbox == {"x": 0.0, "y": 0.0, "width": 0.0, "height": 0.0}


def test_falls_back_to_markdown_pages_when_no_structured_items() -> None:
    # A document that parsed (markdown present) but yielded no structured
    # items must still produce blocks so the reader is not empty.
    md = Markdown(
        pages=[
            MarkdownPageMarkdownResultPage(
                markdown="## Page one\n\nBody.", page_number=1, success=True
            ),
            MarkdownPageMarkdownResultPage(markdown="Page two body.", page_number=2, success=True),
        ]
    )
    result = _response(items=Items(pages=[]), markdown=md)

    blocks = LlamaParseParser._map_result(result)

    assert [b.page_number for b in blocks] == [1, 2]
    assert "Page one" in blocks[0].text
    assert blocks[1].text == "Page two body."


def test_raises_only_when_truly_empty() -> None:
    result = _response(items=Items(pages=[]), markdown=Markdown(pages=[]))
    with pytest.raises(ValueError, match="no text blocks"):
        LlamaParseParser._map_result(result)


def test_parse_passes_timeout_to_sdk(monkeypatch: pytest.MonkeyPatch) -> None:
    """parse() MUST cap the blocking SDK call (default is 7200s = 2h)."""
    from types import SimpleNamespace

    parse_captured: dict[str, object] = {}
    upload_captured: dict[str, object] = {}

    class _FakeParsing:
        def parse(self, **kwargs: object) -> ParsingGetResponse:
            parse_captured.update(kwargs)
            return _response(
                markdown=Markdown(
                    pages=[
                        MarkdownPageMarkdownResultPage(
                            markdown="Body.", page_number=1, success=True
                        )
                    ]
                )
            )

    class _FakeFiles:
        def create(self, **kwargs: object) -> SimpleNamespace:
            upload_captured.update(kwargs)
            return SimpleNamespace(id="file-123")

    class _FakeLlamaCloud:
        def __init__(self, *, api_key: str) -> None:  # noqa: ARG002
            self.parsing = _FakeParsing()
            self.files = _FakeFiles()

    # parse() does `from llama_cloud import LlamaCloud` lazily, so patch the
    # module attribute it re-reads on each call.
    monkeypatch.setattr("llama_cloud.LlamaCloud", _FakeLlamaCloud)

    parser = LlamaParseParser(api_key="k", timeout=99.0)
    blocks = parser.parse(b"%PDF-1.4 fake")

    # BOTH the upload and the parse poll must be bounded (each can block).
    assert upload_captured["timeout"] == 99.0
    assert upload_captured["purpose"] == "parse"
    assert parse_captured["timeout"] == 99.0
    assert parse_captured["file_id"] == "file-123"
    assert [b.text for b in blocks] == ["Body."]


def test_timeout_defaults_to_capped_value() -> None:
    # A bare construction must still be bounded — never inherit the SDK's 2h.
    assert LlamaParseParser(api_key="k").timeout == 240.0
