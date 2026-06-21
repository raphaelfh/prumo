# backend/tests/integration/test_llamaparse_parser.py
from unittest.mock import MagicMock, patch

from app.infrastructure.parsing.base import (
    BLOCK_TYPES,
    assign_char_offsets_to_blocks,
    concat_page_text,
)
from app.infrastructure.parsing.llamaparse_parser import LlamaParseParser


def _fake_result():
    # Minimal items tree + page sizes mirroring the agentic granular-bbox shape.
    # One heading + one box-less item on page 1 (page_height = 800), top-left origin.
    return MagicMock(
        pages=[MagicMock(page=1, height=800.0, width=600.0)],
        items=[
            MagicMock(
                type="heading",
                page=1,
                value="Results",
                bbox={"x": 50.0, "y": 100.0, "w": 200.0, "h": 20.0},
            ),
            MagicMock(type="text", page=1, value="A box-less line", bbox=None),
            MagicMock(
                type="weird_unknown",
                page=1,
                value="Mystery",
                bbox={"x": 10.0, "y": 700.0, "w": 80.0, "h": 12.0},
            ),
        ],
    )


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

    # block_type mapping: heading->heading, text->paragraph, unknown->paragraph
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
