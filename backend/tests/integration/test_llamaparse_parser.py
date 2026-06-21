# backend/tests/integration/test_llamaparse_parser.py
from unittest.mock import MagicMock, patch

from llama_cloud.types.b_box import BBox
from llama_cloud.types.code_item import CodeItem
from llama_cloud.types.heading_item import HeadingItem
from llama_cloud.types.parsing_get_response import (
    Items,
    ItemsPageStructuredResultPage,
    ParsingGetResponse,
)
from llama_cloud.types.text_item import TextItem

from app.infrastructure.parsing.base import (
    BLOCK_TYPES,
    assign_char_offsets_to_blocks,
    concat_page_text,
)
from app.infrastructure.parsing.llamaparse_parser import LlamaParseParser


def _fake_result() -> ParsingGetResponse:
    # Real llama_cloud 2.x models (NOT a hand-shaped MagicMock — the previous
    # mock encoded a flat result.items/result.pages shape the SDK never returns,
    # which is exactly why the prod mapper silently produced zero blocks).
    # One structured page (height 800, top-left origin): heading + box-less text
    # + a code item that normalises to paragraph.
    page = ItemsPageStructuredResultPage(
        page_number=1,
        page_height=800.0,
        page_width=600.0,
        success=True,
        items=[
            HeadingItem(
                type="heading",
                level=1,
                value="Results",
                md="# Results",
                bbox=[BBox(x=50.0, y=100.0, w=200.0, h=20.0)],
            ),
            TextItem(type="text", value="A box-less line", md="A box-less line", bbox=None),
            CodeItem(
                type="code",
                value="Mystery",
                md="`Mystery`",
                bbox=[BBox(x=10.0, y=700.0, w=80.0, h=12.0)],
            ),
        ],
    )
    return ParsingGetResponse.model_construct(items=Items(pages=[page]), markdown=None)


def test_llamaparse_maps_items_to_blocks_with_yflip():
    with patch("llama_cloud.LlamaCloud") as cloud_cls:
        client = cloud_cls.return_value
        client.files.create.return_value = MagicMock(id="file-1")
        client.parsing.parse.return_value = _fake_result()

        blocks = LlamaParseParser(api_key="lc-key").parse(b"%PDF-1.4 fake")

        # the SDK call shape (agentic tier + granular bboxes)
        client.files.create.assert_called_once()
        _, kwargs = client.parsing.parse.call_args
        assert kwargs["tier"] == "agentic"
        assert kwargs["output_options"] == {"granular_bboxes": ["word", "line", "cell"]}
        assert set(kwargs["expand"]) == {"markdown", "items"}

    # block_type mapping: heading->heading, text->paragraph, code->paragraph
    by_text = {b.text: b for b in blocks}
    assert by_text["Results"].block_type == "heading"
    assert by_text["A box-less line"].block_type == "paragraph"
    assert by_text["Mystery"].block_type == "paragraph"

    for b in blocks:
        assert b.page_number == 1
        assert b.block_type in BLOCK_TYPES
        assert set(b.bbox) == {"x", "y", "width", "height"}  # never None

    # Y-flip: top-left y=100,h=20 on an 800-tall page -> bottom-left y = 800-100-20 = 680
    assert by_text["Results"].bbox["y"] == 680.0

    # box-less item gets a sentinel covering bbox, not None
    assert by_text["A box-less line"].bbox == {"x": 0.0, "y": 0.0, "width": 0.0, "height": 0.0}

    # 0-indexed reading-order block_index
    idx = sorted(b.block_index for b in blocks)
    assert idx[0] == 0 and idx == list(range(len(blocks)))

    # offset invariant after the service-side assignment
    assign_char_offsets_to_blocks(blocks)
    page_text = concat_page_text(blocks)
    for b in blocks:
        assert b.text == page_text[b.page_number][b.char_start : b.char_end]
