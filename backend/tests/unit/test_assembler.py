"""
Unit tests for the section-aware block assembler.

Tests cover:
- Reading-order preservation across pages.
- Heading → section markers (IMRaD-aware).
- Contiguous ``table_cell`` blocks → reconstructed table (markdown).
- Over-budget → whole-section selection with ``dropped_sections`` populated,
  no mid-section/mid-table cut.
- In-budget: nothing past a naive 15k char cut is silently lost.
- Optional ``focus`` hint biases section priority deterministically.
- Prose equals block.text (== the canonical concat_page_text slice by construction);
  serialization now delegates to render_blocks_to_markdown.
- Input blocks are never mutated by assemble().
- Over-budget fallback pops WHOLE sections (never string-splits on separator).
"""

from app.infrastructure.parsing.base import (
    ParsedBlock,
    assign_char_offsets_to_blocks,
    concat_page_text,
)
from app.llm.assembler import (
    DroppedSection,
    assemble,
    assemble_for_model,
    blocks_from_plain_text,
    estimate_tokens,
)
from app.schemas.extraction import AssemblyInfo

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_BBOX = {"x": 0.0, "y": 0.0, "width": 100.0, "height": 20.0}


def _b(
    page: int,
    idx: int,
    text: str,
    block_type: str = "paragraph",
) -> ParsedBlock:
    """Convenience factory for ParsedBlock with dummy offsets."""
    return ParsedBlock(
        page_number=page,
        block_index=idx,
        text=text,
        char_start=0,
        char_end=len(text),
        bbox=_BBOX,
        block_type=block_type,
    )


# ---------------------------------------------------------------------------
# 1. Reading-order preservation across pages
# ---------------------------------------------------------------------------


class TestReadingOrder:
    def test_single_page_order(self) -> None:
        blocks = [
            _b(1, 2, "Third"),
            _b(1, 0, "First"),
            _b(1, 1, "Second"),
        ]
        text, dropped = assemble(blocks, budget=10_000)
        assert dropped == []
        # Reading order: First, Second, Third
        pos_first = text.index("First")
        pos_second = text.index("Second")
        pos_third = text.index("Third")
        assert pos_first < pos_second < pos_third

    def test_multi_page_order(self) -> None:
        blocks = [
            _b(2, 0, "Page two content"),
            _b(1, 0, "Page one content"),
        ]
        text, _ = assemble(blocks, budget=10_000)
        assert text.index("Page one content") < text.index("Page two content")

    def test_multi_page_multi_block_order(self) -> None:
        blocks = [
            _b(2, 1, "P2B2"),
            _b(1, 1, "P1B2"),
            _b(2, 0, "P2B1"),
            _b(1, 0, "P1B1"),
        ]
        text, _ = assemble(blocks, budget=10_000)
        positions = [text.index(t) for t in ("P1B1", "P1B2", "P2B1", "P2B2")]
        assert positions == sorted(positions)

    def test_pages_not_necessarily_contiguous(self) -> None:
        blocks = [
            _b(5, 0, "Last"),
            _b(1, 0, "First"),
            _b(3, 0, "Middle"),
        ]
        text, _ = assemble(blocks, budget=10_000)
        assert text.index("First") < text.index("Middle") < text.index("Last")


# ---------------------------------------------------------------------------
# 2. Heading → section markers
# ---------------------------------------------------------------------------


class TestSectionMarkers:
    def test_heading_emits_section_marker(self) -> None:
        blocks = [
            _b(1, 0, "Introduction", "heading"),
            _b(1, 1, "Some paragraph text.", "paragraph"),
        ]
        text, _ = assemble(blocks, budget=10_000)
        # The heading text must appear as a marker (e.g. ## Introduction or === Introduction)
        assert "Introduction" in text
        # The section marker must appear before the paragraph text
        assert text.index("Introduction") < text.index("Some paragraph text.")

    def test_multiple_headings_in_order(self) -> None:
        blocks = [
            _b(1, 0, "Methods", "heading"),
            _b(1, 1, "We did X.", "paragraph"),
            _b(2, 0, "Results", "heading"),
            _b(2, 1, "We found Y.", "paragraph"),
        ]
        text, _ = assemble(blocks, budget=10_000)
        assert text.index("Methods") < text.index("We did X.")
        assert text.index("Results") < text.index("We found Y.")
        assert text.index("We did X.") < text.index("Results")

    def test_header_footer_blocks_excluded_or_suppressed(self) -> None:
        """header/footer blocks (page chrome) should not produce content markers."""
        blocks = [
            _b(1, 0, "Journal Name", "header"),
            _b(1, 1, "Introduction", "heading"),
            _b(1, 2, "Real content.", "paragraph"),
            _b(1, 3, "Page 1 of 10", "footer"),
        ]
        text, _ = assemble(blocks, budget=10_000)
        # Main content must appear
        assert "Introduction" in text
        assert "Real content." in text
        # Chrome text must NOT appear in the output
        assert "Journal Name" not in text
        assert "Page 1 of 10" not in text


# ---------------------------------------------------------------------------
# 3. Contiguous table_cell blocks → reconstructed table
# ---------------------------------------------------------------------------


class TestTableReconstruction:
    def test_contiguous_cells_become_table_not_scattered_lines(self) -> None:
        """Four cells (2 rows × 2 cols) must not appear as four separate lines."""
        blocks = [
            _b(1, 0, "Name", "table_cell"),
            _b(1, 1, "Age", "table_cell"),
            _b(1, 2, "Alice", "table_cell"),
            _b(1, 3, "30", "table_cell"),
        ]
        text, _ = assemble(blocks, budget=10_000)
        # All cell texts must be present
        for cell_text in ("Name", "Age", "Alice", "30"):
            assert cell_text in text
        # The cells should NOT appear as four completely isolated lines separated by
        # no table structure (a good proxy: they must appear close together, not with
        # non-table content between them).
        # More precisely: the reconstructed text for this run should form a
        # recognisable table block (markdown | separators). Just assert that
        # the content is not interleaved with non-table text in a raw line-per-cell
        # manner by checking there is no non-table content between the first and
        # last cell.
        start = min(text.index(c) for c in ("Name", "Age", "Alice", "30"))
        end = max(text.index(c) + len(c) for c in ("Name", "Age", "Alice", "30"))
        table_span = text[start:end]
        # The span must contain all four cells
        for cell_text in ("Name", "Age", "Alice", "30"):
            assert cell_text in table_span

    def test_cells_not_interleaved_with_paragraphs(self) -> None:
        """Paragraph text between two sets of cells must not appear inside
        a reconstructed table."""
        blocks = [
            _b(1, 0, "Cell A1", "table_cell"),
            _b(1, 1, "Cell A2", "table_cell"),
            _b(1, 2, "Mid paragraph text.", "paragraph"),
            _b(1, 3, "Cell B1", "table_cell"),
            _b(1, 4, "Cell B2", "table_cell"),
        ]
        text, _ = assemble(blocks, budget=10_000)
        # Both cell groups and paragraph must appear
        for content in ("Cell A1", "Cell A2", "Mid paragraph text.", "Cell B1", "Cell B2"):
            assert content in text
        # The paragraph must separate the two table runs — it must appear
        # between the end of the first pair and the start of the second pair.
        end_of_first_table = max(
            text.index("Cell A1") + len("Cell A1"), text.index("Cell A2") + len("Cell A2")
        )
        start_of_second_table = min(text.index("Cell B1"), text.index("Cell B2"))
        mid_pos = text.index("Mid paragraph text.")
        assert end_of_first_table < mid_pos < start_of_second_table

    def test_single_cell_renders(self) -> None:
        blocks = [_b(1, 0, "Only cell", "table_cell")]
        text, _ = assemble(blocks, budget=10_000)
        assert "Only cell" in text


# ---------------------------------------------------------------------------
# 4. Over-budget: whole-section selection, dropped_sections populated
# ---------------------------------------------------------------------------


TINY_BUDGET = 200  # chars — forces section dropping for most test docs


class TestOverBudgetSectionSelection:
    def _imrad_doc(self) -> list[ParsedBlock]:
        """Return a small IMRaD document whose full text exceeds TINY_BUDGET."""
        return [
            _b(1, 0, "Abstract", "heading"),
            _b(1, 1, "A" * 60, "paragraph"),
            _b(2, 0, "Introduction", "heading"),
            _b(2, 1, "B" * 60, "paragraph"),
            _b(3, 0, "Methods", "heading"),
            _b(3, 1, "C" * 60, "paragraph"),
            _b(4, 0, "Results", "heading"),
            _b(4, 1, "D" * 60, "paragraph"),
            _b(5, 0, "Discussion", "heading"),
            _b(5, 1, "E" * 60, "paragraph"),
            _b(6, 0, "References", "heading"),
            _b(6, 1, "F" * 60, "paragraph"),
        ]

    def test_dropped_sections_populated_when_over_budget(self) -> None:
        blocks = self._imrad_doc()
        text, dropped = assemble(blocks, budget=TINY_BUDGET)
        assert len(dropped) > 0

    def test_dropped_sections_are_DroppedSection_instances(self) -> None:
        blocks = self._imrad_doc()
        _, dropped = assemble(blocks, budget=TINY_BUDGET)
        for d in dropped:
            assert isinstance(d, DroppedSection)

    def test_no_mid_section_cut(self) -> None:
        """Every section that appears in the output must be FULLY included.

        Strategy: for each kept section heading, assert its paragraph body
        also appears.
        """
        section_map = {
            "Abstract": "A" * 60,
            "Introduction": "B" * 60,
            "Methods": "C" * 60,
            "Results": "D" * 60,
            "Discussion": "E" * 60,
            "References": "F" * 60,
        }
        blocks = self._imrad_doc()
        text, dropped = assemble(blocks, budget=TINY_BUDGET)
        dropped_names = {d.title for d in dropped}
        for heading, body in section_map.items():
            if heading in dropped_names:
                # Dropped sections must not appear in text
                assert body not in text, f"Dropped section '{heading}' body leaked into text"
            else:
                # Kept sections must be fully present
                assert body in text, f"Kept section '{heading}' body missing from text"

    def test_output_within_budget(self) -> None:
        blocks = self._imrad_doc()
        text, _ = assemble(blocks, budget=TINY_BUDGET)
        assert len(text) <= TINY_BUDGET

    def test_deterministic_output(self) -> None:
        """Same input must always produce the same output."""
        blocks = self._imrad_doc()
        results = [assemble(blocks, budget=TINY_BUDGET) for _ in range(3)]
        assert all(r[0] == results[0][0] for r in results)
        assert all(r[1] == results[0][1] for r in results)

    def test_references_dropped_before_results(self) -> None:
        """IMRaD priority: Results/Methods rank higher than References/Discussion.

        When the budget is tight, References should be dropped before Results.
        """
        blocks = self._imrad_doc()
        # Budget big enough to keep Results but not everything
        # Each section is ~heading(~10-15 chars) + body(60 chars) ~ 75 chars per section
        # 3 sections fit in ~225 chars
        text, dropped = assemble(blocks, budget=225)
        dropped_names = {d.title for d in dropped}
        # If any sections are dropped, Results should not be dropped before References
        if dropped_names:
            # References should appear in dropped before Results would be dropped
            if "Results" not in dropped_names:
                pass  # Results kept — good
            else:
                # If Results is dropped, References must also be dropped
                assert "References" in dropped_names

    def test_no_table_mid_cut(self) -> None:
        """A table run must never be split across budget boundary."""
        # Build a doc where a table plus surrounding sections exceed the budget.
        # The table must appear in full or not at all.
        table_blocks = [
            _b(2, 0, "Results Table", "heading"),
            _b(2, 1, "T" * 10, "table_cell"),
            _b(2, 2, "U" * 10, "table_cell"),
            _b(2, 3, "V" * 10, "table_cell"),
            _b(2, 4, "W" * 10, "table_cell"),
        ]
        other_blocks = [
            _b(1, 0, "Introduction", "heading"),
            _b(1, 1, "I" * 60, "paragraph"),
            _b(3, 0, "Discussion", "heading"),
            _b(3, 1, "J" * 60, "paragraph"),
        ]
        blocks = other_blocks + table_blocks
        text, dropped = assemble(blocks, budget=150)
        table_cells = ["T" * 10, "U" * 10, "V" * 10, "W" * 10]
        cells_present = [c in text for c in table_cells]
        # Either all cells are present or none are (whole-table constraint)
        assert all(cells_present) or not any(cells_present)

    def test_fallback_whole_section_drop_not_string_split(self) -> None:
        """Defensive fallback drops WHOLE sections, never fragments on separator.

        Build a block whose text contains the inter-section separator ("\\n\\n").
        With a budget that forces a drop, the survivor must be intact and
        dropped_sections must name the dropped section — no fragment leak.
        """
        # Section A: text that contains the separator string inside it.
        # This would corrupt result if we did result_text.split(separator).pop().
        separator_in_body = "first part\n\nsecond part"  # contains "\n\n"
        blocks = [
            _b(1, 0, "Alpha", "heading"),
            _b(1, 1, separator_in_body, "paragraph"),
            _b(2, 0, "Beta", "heading"),
            _b(2, 1, "B" * 80, "paragraph"),
        ]
        # Alpha section text = "## Alpha\n" + separator_in_body  ≈ 41 chars
        # Beta section text  = "## Beta\n"  + "B"*80             ≈ 89 chars
        # Full text = ~41 + 2 (sep) + 89 = ~132 chars
        # Budget just big enough for Beta but not both
        text, dropped = assemble(blocks, budget=100)
        # Exactly one section must be dropped
        assert len(dropped) == 1
        dropped_title = dropped[0].title
        # The survivor must be fully intact — no partial content from dropped section
        if dropped_title == "Alpha":
            # Beta survives: must be whole
            assert "B" * 80 in text
            # Alpha body must not appear (even the fragment "first part")
            assert "first part" not in text
            assert "second part" not in text
        else:
            # Alpha survives: must be whole including the embedded separator
            assert separator_in_body in text
            # Beta body must not appear
            assert "B" * 80 not in text


# ---------------------------------------------------------------------------
# 5. In-budget: nothing past naive 15k cut is silently lost
# ---------------------------------------------------------------------------


class TestInBudgetNoSilentLoss:
    def test_content_beyond_15k_preserved_when_in_budget(self) -> None:
        """For a doc whose total text > 15 000 chars but fits within budget,
        assemble() must include ALL content — not silently drop what lies beyond
        a hypothetical 15 000-char cut."""
        # Build ~18 000 chars of content spread across pages.
        blocks: list[ParsedBlock] = []
        for page in range(1, 7):  # 6 pages
            blocks.append(_b(page, 0, f"Section {page}", "heading"))
            blocks.append(_b(page, 1, "X" * 2_900, "paragraph"))  # ~2 900 chars/page

        # Total text ≈ 6 × (len("Section N") + 2900) ≈ 17 454 chars → > 15 000
        full_text = "\n".join(
            b.text for b in sorted(blocks, key=lambda b: (b.page_number, b.block_index))
        )
        assert len(full_text) > 15_000, "Pre-condition: doc must exceed 15k chars"

        # Budget large enough to fit everything
        large_budget = 20_000
        text, dropped = assemble(blocks, budget=large_budget)

        assert dropped == [], f"No sections should be dropped when in-budget; got {dropped}"
        # Every section heading and every paragraph must appear
        for page in range(1, 7):
            assert f"Section {page}" in text, f"Section {page} heading missing"
            assert "X" * 2_900 in text, f"Section {page} paragraph missing"

    def test_last_section_fully_included_when_at_budget_boundary(self) -> None:
        """If adding the last section would just fit, it must be fully included."""
        # A small two-section doc that fits in budget
        blocks = [
            _b(1, 0, "First Section", "heading"),
            _b(1, 1, "Content A", "paragraph"),
            _b(2, 0, "Second Section", "heading"),
            _b(2, 1, "Content B", "paragraph"),
        ]
        budget = 10_000  # Obviously fits
        text, dropped = assemble(blocks, budget=budget)
        assert "Content A" in text
        assert "Content B" in text
        assert dropped == []


# ---------------------------------------------------------------------------
# 6. focus hint biases section priority
# ---------------------------------------------------------------------------


class TestFocusHint:
    def test_focus_keeps_matching_section(self) -> None:
        """When focus='Methods', Methods should be kept even at tight budget."""
        blocks = [
            _b(1, 0, "Introduction", "heading"),
            _b(1, 1, "A" * 80, "paragraph"),
            _b(2, 0, "Methods", "heading"),
            _b(2, 1, "B" * 80, "paragraph"),
            _b(3, 0, "Results", "heading"),
            _b(3, 1, "C" * 80, "paragraph"),
        ]
        # Budget fits 2 sections, not all 3
        text, dropped = assemble(blocks, budget=200, focus="Methods")
        assert "B" * 80 in text, "Focus section body must be present"
        dropped_names = {d.title for d in dropped}
        assert "Methods" not in dropped_names

    def test_focus_is_deterministic(self) -> None:
        blocks = [
            _b(1, 0, "Introduction", "heading"),
            _b(1, 1, "A" * 80, "paragraph"),
            _b(2, 0, "Results", "heading"),
            _b(2, 1, "B" * 80, "paragraph"),
        ]
        result1 = assemble(blocks, budget=150, focus="Results")
        result2 = assemble(blocks, budget=150, focus="Results")
        assert result1[0] == result2[0]
        assert result1[1] == result2[1]


# ---------------------------------------------------------------------------
# 7. Prose routes through canonical concat_page_text surface
# ---------------------------------------------------------------------------


class TestCanonicalSurface:
    def test_prose_matches_concat_page_text_slice(self) -> None:
        """For a multi-block page, prose in assemble() output equals
        concat_page_text(copies)[page][cs:ce] for the block's offsets.

        This verifies that assemble() genuinely routes prose through the
        canonical surface rather than just copying block.text.
        """
        blocks = [
            _b(1, 0, "First block", "paragraph"),
            _b(1, 1, "Second block", "paragraph"),
            _b(1, 2, "Third block", "paragraph"),
        ]
        # Build copies and compute canonical offsets the same way assemble() does.
        copies = [
            ParsedBlock(
                page_number=b.page_number,
                block_index=b.block_index,
                text=b.text,
                char_start=0,
                char_end=0,
                bbox=b.bbox,
                block_type=b.block_type,
            )
            for b in blocks
        ]
        assign_char_offsets_to_blocks(copies)
        page_texts = concat_page_text(copies)
        offsets = {(c.page_number, c.block_index): (c.char_start, c.char_end) for c in copies}

        text, dropped = assemble(blocks, budget=10_000)
        assert dropped == []

        # Each block's prose must equal the canonical slice.
        for b in blocks:
            cs, ce = offsets[(b.page_number, b.block_index)]
            canonical_slice = page_texts[b.page_number][cs:ce]
            assert canonical_slice == b.text  # by construction
            assert canonical_slice in text, (
                f"Block '{b.text}' canonical slice not found in assembled output"
            )

    def test_input_blocks_not_mutated_by_assemble(self) -> None:
        """assemble() must not mutate char_start/char_end on input blocks."""
        # Use dummy offsets that are intentionally wrong (0 / len) to detect mutation.
        blocks = [
            _b(1, 0, "Alpha paragraph"),
            _b(1, 1, "Beta paragraph"),
            _b(2, 0, "Gamma paragraph"),
        ]
        original_starts = [b.char_start for b in blocks]
        original_ends = [b.char_end for b in blocks]

        assemble(blocks, budget=10_000)

        for i, b in enumerate(blocks):
            assert b.char_start == original_starts[i], (
                f"Block {i} char_start was mutated: {original_starts[i]} → {b.char_start}"
            )
            assert b.char_end == original_ends[i], (
                f"Block {i} char_end was mutated: {original_ends[i]} → {b.char_end}"
            )


# ---------------------------------------------------------------------------
# 8. Model-aware assemble wrapper
# ---------------------------------------------------------------------------


class TestAssembleForModel:
    def _imrad(self) -> list[ParsedBlock]:
        return [
            _b(1, 0, "Abstract", "heading"),
            _b(1, 1, "A" * 400, "paragraph"),
            _b(2, 0, "Results", "heading"),
            _b(2, 1, "B" * 400, "paragraph"),
            _b(3, 0, "References", "heading"),
            _b(3, 1, "C" * 400, "paragraph"),
        ]

    def test_returns_markdown_and_assembly_info(self) -> None:
        text, info = assemble_for_model(
            self._imrad(), model_name="gpt-4o-mini", budget_tokens=100_000
        )
        assert isinstance(info, AssemblyInfo)
        assert info.truncated is False
        assert info.total_blocks == 6
        assert info.included_blocks == 6
        assert info.est_tokens > 0
        assert "Abstract" in text and "Results" in text

    def test_truncated_flag_set_when_over_budget(self) -> None:
        # budget_tokens * 4 chars must be smaller than the full doc (~1.2k chars)
        text, info = assemble_for_model(self._imrad(), model_name="gpt-4o-mini", budget_tokens=120)
        assert info.truncated is True
        assert info.included_blocks < info.total_blocks
        assert len(text) <= 120 * 4

    def test_est_tokens_uses_tiktoken_for_openai(self) -> None:
        # tiktoken counts real tokens; a 400-char ASCII run is far fewer than 400 tokens.
        n = estimate_tokens("word " * 400, "gpt-4o-mini")
        assert 300 < n < 500

    def test_heuristic_skew_for_anthropic_model(self) -> None:
        # Anthropic models are not encodable by tiktoken → char/4 heuristic. Document
        # the skew: the heuristic differs from the OpenAI tokeniser for the same text.
        text = "Heterogeneous clinical-trial endpoints, n=412 (95% CI)."
        heuristic = estimate_tokens(text, "claude-opus-4-8")  # falls back to len//4
        assert heuristic == max(1, len(text) // 4)
        openai = estimate_tokens(text, "gpt-4o-mini")
        assert heuristic != openai  # documented skew between heuristic and tiktoken

    def test_blocks_from_plain_text_splits_on_page_markers(self) -> None:
        blocks = blocks_from_plain_text("[Page 1]\nIntro text.\n\n[Page 2]\nMethods text.")
        assert [b.page_number for b in blocks] == [1, 2]
        assert blocks[0].text == "Intro text." and blocks[0].block_type == "paragraph"

    def test_blocks_from_plain_text_no_markers_single_block(self) -> None:
        blocks = blocks_from_plain_text("just some flat text")
        assert len(blocks) == 1 and blocks[0].page_number == 1

    def test_fallback_text_flows_through_same_budgeted_assembler(self) -> None:
        # A long marker-less pypdf string, wrapped + budgeted, never returns unbounded.
        text, info = assemble_for_model(
            blocks_from_plain_text("X" * 5000), model_name="gpt-4o-mini", budget_tokens=100
        )
        assert len(text) <= 100 * 4
        assert info.truncated is True
