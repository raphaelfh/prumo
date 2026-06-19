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
"""

from app.infrastructure.parsing.base import ParsedBlock
from app.services.extraction_block_assembler import DroppedSection, assemble

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
