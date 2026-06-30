"""
Unit tests for the DocumentParser port + ParsedBlock value type.

Tests cover:
- ``concat_page_text``: produces correct per-page strings in block_index order
  across multiple pages and multiple blocks per page.
- Offset invariant: ``block.text == page_text[block.char_start:block.char_end]``
  for every block.
- ``block_type`` normalisation: known values pass through unchanged; unknown
  values are mapped to ``"paragraph"``.
- ``assign_char_offsets_to_blocks``: helper sets consistent offsets.
- ``BLOCK_TYPES`` constant: contains exactly the eight expected values.
"""

import pytest

from app.infrastructure.parsing.base import (
    BLOCK_TYPES,
    ParsedBlock,
    assign_char_offsets_to_blocks,
    concat_page_text,
    normalize_block_type,
    render_blocks_to_markdown,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def make_block(
    page_number: int,
    block_index: int,
    text: str,
    block_type: str = "paragraph",
    char_start: int = 0,
    char_end: int = 0,
) -> ParsedBlock:
    return ParsedBlock(
        page_number=page_number,
        block_index=block_index,
        text=text,
        char_start=char_start,
        char_end=char_end,
        bbox={"x": 0.0, "y": 0.0, "width": 100.0, "height": 20.0},
        block_type=block_type,
    )


# ---------------------------------------------------------------------------
# BLOCK_TYPES constant
# ---------------------------------------------------------------------------


class TestBlockTypes:
    def test_contains_all_eight_values(self) -> None:
        expected = {
            "paragraph",
            "heading",
            "list_item",
            "table_cell",
            "figure_caption",
            "header",
            "footer",
            "figure",
        }
        assert expected == BLOCK_TYPES

    def test_is_frozenset(self) -> None:
        assert isinstance(BLOCK_TYPES, frozenset)


# ---------------------------------------------------------------------------
# normalize_block_type
# ---------------------------------------------------------------------------


class TestNormalizeBlockType:
    @pytest.mark.parametrize(
        "known_type",
        [
            "paragraph",
            "heading",
            "list_item",
            "table_cell",
            "figure_caption",
            "header",
            "footer",
            "figure",
        ],
    )
    def test_known_type_passes_through_unchanged(self, known_type: str) -> None:
        assert normalize_block_type(known_type) == known_type

    def test_unknown_type_maps_to_paragraph(self) -> None:
        assert normalize_block_type("sidebar") == "paragraph"

    def test_empty_string_maps_to_paragraph(self) -> None:
        assert normalize_block_type("") == "paragraph"

    def test_uppercase_known_type_maps_to_paragraph(self) -> None:
        # vocabulary is case-sensitive
        assert normalize_block_type("Paragraph") == "paragraph"

    def test_arbitrary_unknown_type_maps_to_paragraph(self) -> None:
        assert normalize_block_type("diagram") == "paragraph"


# ---------------------------------------------------------------------------
# concat_page_text — basic shape
# ---------------------------------------------------------------------------


class TestConcatPageTextBasic:
    def test_empty_blocks_returns_empty_dict(self) -> None:
        result = concat_page_text([])
        assert result == {}

    def test_single_block_single_page(self) -> None:
        block = make_block(page_number=1, block_index=0, text="Hello world")
        result = concat_page_text([block])
        assert result == {1: "Hello world"}

    def test_two_blocks_same_page_joined_with_newline(self) -> None:
        b0 = make_block(page_number=1, block_index=0, text="First block")
        b1 = make_block(page_number=1, block_index=1, text="Second block")
        result = concat_page_text([b0, b1])
        assert result == {1: "First block\nSecond block"}

    def test_blocks_on_two_separate_pages(self) -> None:
        b1 = make_block(page_number=1, block_index=0, text="Page one text")
        b2 = make_block(page_number=2, block_index=0, text="Page two text")
        result = concat_page_text([b1, b2])
        assert result == {1: "Page one text", 2: "Page two text"}

    def test_blocks_sorted_by_block_index_not_list_order(self) -> None:
        # Intentionally supply blocks in reverse order.
        b1 = make_block(page_number=1, block_index=1, text="B")
        b0 = make_block(page_number=1, block_index=0, text="A")
        result = concat_page_text([b1, b0])
        # Should be "A\nB", not "B\nA"
        assert result == {1: "A\nB"}


# ---------------------------------------------------------------------------
# concat_page_text — multi-page, multi-block
# ---------------------------------------------------------------------------


class TestConcatPageTextMultiPageMultiBlock:
    def test_three_blocks_two_pages(self) -> None:
        blocks = [
            make_block(page_number=1, block_index=0, text="Intro"),
            make_block(page_number=1, block_index=1, text="Body"),
            make_block(page_number=2, block_index=0, text="Conclusion"),
        ]
        result = concat_page_text(blocks)
        assert result[1] == "Intro\nBody"
        assert result[2] == "Conclusion"

    def test_four_blocks_two_pages_interleaved_in_list(self) -> None:
        # Blocks provided in arbitrary (interleaved) order.
        blocks = [
            make_block(page_number=2, block_index=1, text="D"),
            make_block(page_number=1, block_index=0, text="A"),
            make_block(page_number=2, block_index=0, text="C"),
            make_block(page_number=1, block_index=1, text="B"),
        ]
        result = concat_page_text(blocks)
        assert result[1] == "A\nB"
        assert result[2] == "C\nD"

    def test_page_keys_match_blocks_present(self) -> None:
        blocks = [
            make_block(page_number=3, block_index=0, text="Last page"),
            make_block(page_number=1, block_index=0, text="First page"),
        ]
        result = concat_page_text(blocks)
        assert set(result.keys()) == {1, 3}
        # Page 2 is absent — not padded.
        assert 2 not in result


# ---------------------------------------------------------------------------
# Offset invariant via assign_char_offsets_to_blocks
# ---------------------------------------------------------------------------


class TestCharOffsetInvariant:
    def _check_invariant(self, blocks: list[ParsedBlock]) -> None:
        """Assert the offset invariant for every block in *blocks*."""
        page_texts = concat_page_text(blocks)
        for block in blocks:
            page_text = page_texts[block.page_number]
            extracted = page_text[block.char_start : block.char_end]
            assert extracted == block.text, (
                f"Invariant violated for block (page={block.page_number}, "
                f"index={block.block_index}): "
                f"expected {block.text!r}, got {extracted!r}"
            )

    def test_single_block_single_page(self) -> None:
        blocks = [make_block(page_number=1, block_index=0, text="Hello")]
        assign_char_offsets_to_blocks(blocks)
        assert blocks[0].char_start == 0
        assert blocks[0].char_end == 5
        self._check_invariant(blocks)

    def test_two_blocks_same_page(self) -> None:
        blocks = [
            make_block(page_number=1, block_index=0, text="Foo"),
            make_block(page_number=1, block_index=1, text="Bar"),
        ]
        assign_char_offsets_to_blocks(blocks)
        # "Foo\nBar": Foo at [0,3), separator at 3, Bar at [4,7)
        assert blocks[0].char_start == 0
        assert blocks[0].char_end == 3
        assert blocks[1].char_start == 4
        assert blocks[1].char_end == 7
        self._check_invariant(blocks)

    def test_three_blocks_same_page(self) -> None:
        blocks = [
            make_block(page_number=1, block_index=0, text="Alpha"),
            make_block(page_number=1, block_index=1, text="Beta"),
            make_block(page_number=1, block_index=2, text="Gamma"),
        ]
        assign_char_offsets_to_blocks(blocks)
        # "Alpha\nBeta\nGamma"
        assert blocks[0].char_start == 0
        assert blocks[0].char_end == 5
        assert blocks[1].char_start == 6
        assert blocks[1].char_end == 10
        assert blocks[2].char_start == 11
        assert blocks[2].char_end == 16
        self._check_invariant(blocks)

    def test_multi_page_invariant_holds_independently(self) -> None:
        blocks = [
            make_block(page_number=1, block_index=0, text="Page one A"),
            make_block(page_number=1, block_index=1, text="Page one B"),
            make_block(page_number=2, block_index=0, text="Page two"),
        ]
        assign_char_offsets_to_blocks(blocks)
        self._check_invariant(blocks)

    def test_offsets_reset_per_page(self) -> None:
        blocks = [
            make_block(page_number=1, block_index=0, text="Long text on page one"),
            make_block(page_number=2, block_index=0, text="Short"),
        ]
        assign_char_offsets_to_blocks(blocks)
        # Page 2's first block always starts at 0.
        page2_block = next(b for b in blocks if b.page_number == 2)
        assert page2_block.char_start == 0
        self._check_invariant(blocks)

    def test_blocks_supplied_out_of_order_still_correct(self) -> None:
        # Supply blocks in reversed order; assign should still sort by block_index.
        blocks = [
            make_block(page_number=1, block_index=1, text="Second"),
            make_block(page_number=1, block_index=0, text="First"),
        ]
        assign_char_offsets_to_blocks(blocks)
        first = next(b for b in blocks if b.block_index == 0)
        second = next(b for b in blocks if b.block_index == 1)
        assert first.char_start == 0
        assert first.char_end == 5
        assert second.char_start == 6
        assert second.char_end == 12
        self._check_invariant(blocks)

    def test_invariant_with_multiword_texts(self) -> None:
        blocks = [
            make_block(page_number=1, block_index=0, text="The quick brown fox"),
            make_block(page_number=1, block_index=1, text="jumps over the lazy dog"),
        ]
        assign_char_offsets_to_blocks(blocks)
        self._check_invariant(blocks)

    def test_assign_returns_same_list(self) -> None:
        blocks = [make_block(page_number=1, block_index=0, text="x")]
        returned = assign_char_offsets_to_blocks(blocks)
        assert returned is blocks


# ---------------------------------------------------------------------------
# DocumentParser ABC
# ---------------------------------------------------------------------------


class TestDocumentParserABC:
    def test_cannot_instantiate_abstract_class(self) -> None:
        from app.infrastructure.parsing.base import DocumentParser

        with pytest.raises(TypeError):
            DocumentParser()  # type: ignore[abstract]

    def test_concrete_subclass_must_implement_parse(self) -> None:
        from app.infrastructure.parsing.base import DocumentParser

        class ConcreteParser(DocumentParser):
            def parse(self, pdf_bytes: bytes) -> list[ParsedBlock]:  # noqa: ARG002
                return []

        parser = ConcreteParser()
        result = parser.parse(b"")
        assert result == []


# ---------------------------------------------------------------------------
# render_blocks_to_markdown
# ---------------------------------------------------------------------------


class TestRenderBlocksToMarkdown:
    def _b(self, page, idx, text, block_type="paragraph"):
        return ParsedBlock(
            page_number=page,
            block_index=idx,
            text=text,
            char_start=0,
            char_end=len(text),
            bbox={},
            block_type=block_type,
        )

    def test_reading_order_across_pages(self) -> None:
        md = render_blocks_to_markdown([self._b(2, 0, "Second page"), self._b(1, 0, "First page")])
        assert md.index("First page") < md.index("Second page")

    def test_heading_becomes_h2_marker(self) -> None:
        md = render_blocks_to_markdown([self._b(1, 0, "Methods", "heading")])
        assert "## Methods" in md

    def test_list_item_becomes_bullet(self) -> None:
        md = render_blocks_to_markdown([self._b(1, 0, "first point", "list_item")])
        assert "- first point" in md

    def test_header_footer_chrome_suppressed(self) -> None:
        md = render_blocks_to_markdown(
            [
                self._b(1, 0, "Journal Name", "header"),
                self._b(1, 1, "Real content.", "paragraph"),
                self._b(1, 2, "Page 1 of 9", "footer"),
            ]
        )
        assert "Real content." in md
        assert "Journal Name" not in md
        assert "Page 1 of 9" not in md

    def test_contiguous_cells_render_as_gfm_table(self) -> None:
        md = render_blocks_to_markdown(
            [
                self._b(1, 0, "Name", "table_cell"),
                self._b(1, 1, "Age", "table_cell"),
                self._b(1, 2, "Alice", "table_cell"),
                self._b(1, 3, "30", "table_cell"),
            ]
        )
        assert "| Name" in md and "| Alice" in md
        assert "|-" in md  # a GFM separator row exists

    def test_figure_caption_is_plain_text(self) -> None:
        md = render_blocks_to_markdown([self._b(1, 0, "Figure 1. Flowchart.", "figure_caption")])
        assert md == "Figure 1. Flowchart."

    def test_deterministic(self) -> None:
        blocks = [self._b(1, 1, "B"), self._b(1, 0, "A", "heading")]
        assert render_blocks_to_markdown(blocks) == render_blocks_to_markdown(blocks)

    def test_empty_input_returns_empty_string(self) -> None:
        assert render_blocks_to_markdown([]) == ""
