"""
Section-aware block assembler for the grounded-extraction pipeline.

Converts a flat list of ``ArticleTextBlock`` (or ``ParsedBlock``) objects into
a structured prompt text that:

1. Preserves reading order (page_number asc, block_index asc).
2. Emits ``## <heading>`` markers from ``heading`` blocks (IMRaD-aware).
3. Coalesces contiguous ``table_cell`` runs into a reconstructed markdown
   table instead of emitting one cell per line.
4. When the serialised text exceeds ``budget`` chars, drops WHOLE sections
   (never a mid-sentence or mid-table prefix cut) according to a deterministic
   IMRaD-aware ranking, and records what was dropped in ``DroppedSection``
   objects.

Design decisions
----------------
**Budget unit**: characters (``len(text)``).  Characters are the simplest
defensible unit for a pure, deterministic function that has no tokeniser
dependency.  The call site that wires this into the extraction prompts can
apply a safety multiplier if needed (e.g. chars × 0.25 ≈ tokens for typical
scientific prose).

**Section ranking (deterministic)**:
Sections are ranked for inclusion in priority order:

    Abstract > Results > Methods > Introduction > Discussion > Conclusion
    > Figures/Tables > Other > References > Appendix > Header/Footer chrome

When a ``focus`` hint is supplied (e.g. ``focus="Methods"``), the named
section is promoted to rank 0 (highest priority), ahead of Abstract.  All
other ranks shift down by one.  The ranking is a static look-up — no
embeddings or ML.

**Table reconstruction**: contiguous ``table_cell`` runs on the same page
are detected by scanning blocks in reading order.  A run break occurs when a
non-cell block is encountered OR when the page changes.  Each run is
serialised as a simple markdown table.  The column count is inferred from the
first row (the longest prefix of cells before the grid wraps — estimated by
looking for repeated column-count patterns; if inference fails, all cells
are placed in a single-column table).

**concat_page_text reuse**: the assembler calls the canonical
``concat_page_text`` imported from ``app.infrastructure.parsing.base`` to
produce per-page text strings.  Local copies of the input blocks are built
so that ``assign_char_offsets_to_blocks`` can mutate them without ever
touching the caller's ORM objects (which would cause spurious SQLAlchemy
dirty-tracking and unwanted UPDATEs).  Prose blocks are sourced from the
canonical surface via ``page_texts[page][cs:ce]``, which is content-identical
to ``block.text`` by construction but guarantees byte-for-byte alignment with
what the evidence-anchorer will index.

**Scope**: pure function, no DB, no IO, no globals.  This module is
intentionally unwired — the call sites in ``section_extraction_service`` and
``model_extraction_service`` are wired in a separate follow-up task.
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass, field
from typing import Protocol, runtime_checkable

from app.infrastructure.parsing.base import (
    ParsedBlock,
    assign_char_offsets_to_blocks,
    concat_page_text,
)

# ---------------------------------------------------------------------------
# Public types
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class DroppedSection:
    """Metadata about a section that was excluded because of budget constraints.

    Attributes:
        title: The heading text (or ``"<preamble>"`` for content before the
            first heading).
        char_count: Approximate character count of the dropped section's
            serialised text (including the heading marker).
        rank: The priority rank assigned to this section (lower = higher
            priority, i.e. kept sections have lower rank numbers).
    """

    title: str
    char_count: int
    rank: int


# ---------------------------------------------------------------------------
# Internal: block protocol (works on both ParsedBlock and ArticleTextBlock ORM rows)
# ---------------------------------------------------------------------------


@runtime_checkable
class _Block(Protocol):
    """Structural protocol satisfied by both ``ParsedBlock`` and ``ArticleTextBlock``."""

    page_number: int
    block_index: int
    text: str
    char_start: int
    char_end: int
    block_type: str


# ---------------------------------------------------------------------------
# IMRaD section ranking
# ---------------------------------------------------------------------------

# Canonical IMRaD priority: lower index = higher priority (kept first).
# The ranking is applied to the *heading text* after normalisation to lower
# case and stripping of trailing punctuation/numbering.
_IMRAD_KEYWORDS: list[tuple[int, tuple[str, ...]]] = [
    (0, ("abstract", "summary")),
    (1, ("result", "finding")),
    (2, ("method", "material", "patient", "participant", "procedure", "protocol")),
    (3, ("introduction", "background", "objective", "aim", "purpose")),
    (4, ("discussion",)),
    (5, ("conclusion", "implication")),
    (6, ("figure", "table", "supplementary", "supplement")),
    (7, ()),  # catch-all "other" — assigned dynamically
    (8, ("reference", "bibliography", "cited")),
    (9, ("appendix", "annex")),
    (10, ()),  # page chrome (header / footer type blocks that leaked through)
]

_DEFAULT_RANK = 7  # "other"


def _section_rank(heading_text: str, focus: str | None) -> int:
    """Return a priority rank for *heading_text* (lower = higher priority).

    If *focus* is provided and matches the heading, the section is promoted
    to rank -1 (highest possible priority, above Abstract).
    """
    normalised = re.sub(r"^\d[\d.\s]*", "", heading_text.lower().strip(" :.-"))
    if focus and normalised == focus.lower().strip():
        return -1
    for rank, keywords in _IMRAD_KEYWORDS:
        if not keywords:
            continue
        if any(kw in normalised for kw in keywords):
            return rank
    return _DEFAULT_RANK


# ---------------------------------------------------------------------------
# Internal: Section dataclass
# ---------------------------------------------------------------------------


@dataclass
class _Section:
    """One logical section: a heading (optional) followed by its body blocks."""

    title: str  # "" for pre-heading preamble
    rank: int
    blocks: list[_Block] = field(default_factory=list)


def _is_chrome(block: _Block) -> bool:
    """Return True for page chrome blocks (header / footer) that add noise."""
    return block.block_type in ("header", "footer")


# ---------------------------------------------------------------------------
# Table reconstruction
# ---------------------------------------------------------------------------

_CELL_SEP = " | "
_ROW_SEP_CHAR = "-"


def _infer_column_count(cell_texts: list[str]) -> int:
    """Heuristically infer the number of columns in a table.

    Tries column counts from 2 to min(8, n) and picks the one where
    n % cols == 0 (exact fit) and cols is smallest.  Falls back to 1.
    """
    n = len(cell_texts)
    if n <= 1:
        return 1
    for cols in range(2, min(9, n + 1)):
        if n % cols == 0:
            return cols
    # No exact fit — use the square-root heuristic (rounded up), capped at 8
    return min(8, max(2, math.ceil(math.sqrt(n))))


def _render_table(cell_texts: list[str]) -> str:
    """Render *cell_texts* as a markdown table string."""
    if not cell_texts:
        return ""
    cols = _infer_column_count(cell_texts)
    rows: list[list[str]] = []
    for i in range(0, len(cell_texts), cols):
        row = cell_texts[i : i + cols]
        # Pad the last row if it is short
        while len(row) < cols:
            row.append("")
        rows.append(row)

    # Compute column widths
    col_widths = [max(len(r[c]) for r in rows) for c in range(cols)]

    def _fmt_row(row: list[str]) -> str:
        cells = [r.ljust(w) for r, w in zip(row, col_widths, strict=True)]
        return "| " + _CELL_SEP.join(cells) + " |"

    def _separator() -> str:
        return "|-" + "-|-".join(_ROW_SEP_CHAR * w for w in col_widths) + "-|"

    lines = [_fmt_row(rows[0]), _separator()]
    for row in rows[1:]:
        lines.append(_fmt_row(row))
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Internal: serialize a section's blocks into a text string
# ---------------------------------------------------------------------------


def _serialize_section(
    section: _Section,
    page_texts: dict[int, str],
    offsets: dict[tuple[int, int], tuple[int, int]],
) -> str:
    """Serialise *section* into a text string (heading marker + body).

    Prose blocks are sourced from *page_texts* via *offsets* — the canonical
    surface produced by ``concat_page_text`` — so that the assembler's output
    is byte-for-byte consistent with what the evidence-anchorer indexes.
    Table-cell text is taken directly from the block (cells are not indexed by
    the anchorer via char offsets).

    Args:
        section: The section to serialise.
        page_texts: Mapping of ``page_number → concatenated page string``
            produced by ``concat_page_text`` on local block copies.
        offsets: Mapping of ``(page_number, block_index) → (char_start, char_end)``
            derived from ``assign_char_offsets_to_blocks`` on local block copies.
    """
    parts: list[str] = []

    if section.title:
        parts.append(f"## {section.title}")

    # Walk blocks, coalescing contiguous table_cell runs.
    # A run breaks when block type changes away from table_cell, or page changes.
    i = 0
    blocks = section.blocks
    while i < len(blocks):
        block = blocks[i]

        if _is_chrome(block):
            i += 1
            continue

        if block.block_type == "table_cell":
            # Collect the contiguous run — cells use .text directly
            run: list[str] = []
            current_page = block.page_number
            while (
                i < len(blocks)
                and blocks[i].block_type == "table_cell"
                and blocks[i].page_number == current_page
            ):
                run.append(blocks[i].text)
                i += 1
            parts.append(_render_table(run))
        else:
            # Route prose through the canonical surface so offsets align with
            # what the evidence-anchorer will index in concat_page_text.
            cs, ce = offsets[(block.page_number, block.block_index)]
            prose = page_texts[block.page_number][cs:ce]
            parts.append(prose)
            i += 1

    return "\n".join(parts)


# ---------------------------------------------------------------------------
# Internal: segment blocks into sections
# ---------------------------------------------------------------------------


def _segment_into_sections(
    sorted_blocks: list[_Block],
    focus: str | None,
) -> list[_Section]:
    """Group *sorted_blocks* (in reading order) into ``_Section`` objects.

    A new section begins every time a ``heading`` block is encountered.
    Blocks before the first heading are grouped into a preamble section
    with title ``""`` (empty string) and rank equal to Abstract's rank (0),
    since the preamble usually contains the abstract or title.
    """
    sections: list[_Section] = []
    current = _Section(title="", rank=_section_rank("abstract", focus))

    for block in sorted_blocks:
        if block.block_type == "heading":
            # Only start a new section if the current one has content
            # (to avoid empty preamble sections when the doc starts with a heading).
            if current.blocks or current.title:
                sections.append(current)
            current = _Section(
                title=block.text,
                rank=_section_rank(block.text, focus),
                blocks=[],
            )
        else:
            current.blocks.append(block)

    # Don't forget the last in-progress section
    if current.blocks or current.title:
        sections.append(current)

    return sections


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def assemble(
    blocks: list[_Block],
    budget: int,
    focus: str | None = None,
) -> tuple[str, list[DroppedSection]]:
    """Assemble *blocks* into structured prompt text within *budget* characters.

    Args:
        blocks: ``ArticleTextBlock`` ORM rows or ``ParsedBlock`` dataclasses.
            May be in any order; this function sorts by (page_number, block_index).
            Input blocks are NEVER mutated.
        budget: Maximum number of characters in the returned text (inclusive).
            When the full document exceeds this limit, whole sections are dropped
            according to the deterministic IMRaD-aware ranking (lower rank =
            higher priority = kept first).  Budget is measured in characters
            (``len(text)``).
        focus: Optional section-title hint (case-insensitive exact match after
            normalisation).  The matching section is promoted to the highest
            priority rank, ensuring it is never dropped before lower-priority
            sections.

    Returns:
        A tuple ``(text, dropped_sections)`` where:
        - *text* is the assembled prompt string, ≤ *budget* chars.
        - *dropped_sections* is a list of ``DroppedSection`` objects describing
          every section that was omitted due to budget constraints (empty list
          when everything fits).

    Notes:
        - Pure function: no DB, no IO, no globals.
        - Input blocks are never mutated; local ``ParsedBlock`` copies are used
          so that ``assign_char_offsets_to_blocks`` does not dirty SQLAlchemy
          ORM objects.
        - Prose text is sourced from ``concat_page_text`` (canonical surface)
          so char offsets match what the evidence-anchorer indexes.
        - ``header`` and ``footer`` blocks are suppressed (page chrome).
        - Contiguous ``table_cell`` blocks on the same page are coalesced into
          a markdown table.
        - When over budget, WHOLE sections are dropped — never a mid-sentence
          or mid-table prefix cut.
    """
    if not blocks:
        return "", []

    # 1. Sort into reading order (page asc, block_index asc).
    sorted_blocks: list[_Block] = sorted(blocks, key=lambda b: (b.page_number, b.block_index))

    # 2. Build local ParsedBlock copies so assign_char_offsets_to_blocks can
    #    mutate them without ever touching the caller's ORM objects.
    copies = [
        ParsedBlock(
            page_number=b.page_number,
            block_index=b.block_index,
            text=b.text,
            char_start=0,
            char_end=0,
            bbox=getattr(b, "bbox", {"x": 0.0, "y": 0.0, "width": 0.0, "height": 0.0}),
            block_type=b.block_type,
        )
        for b in sorted_blocks
    ]
    assign_char_offsets_to_blocks(copies)  # mutates the COPIES only
    page_texts = concat_page_text(copies)  # canonical per-page text
    offsets: dict[tuple[int, int], tuple[int, int]] = {
        (c.page_number, c.block_index): (c.char_start, c.char_end) for c in copies
    }

    # 3. Segment into sections.
    sections = _segment_into_sections(sorted_blocks, focus)

    # 4. Serialise each section to compute its character cost.
    serialised: list[tuple[_Section, str]] = [
        (sec, _serialize_section(sec, page_texts, offsets)) for sec in sections
    ]

    # 5. Check if everything fits within budget.
    #    Join with double newline between sections.
    separator = "\n\n"
    full_text_parts = [text for _, text in serialised if text]
    full_text = separator.join(full_text_parts)

    if len(full_text) <= budget:
        return full_text, []

    # 6. Over budget: select whole sections greedily, highest priority first.
    #    Within the same rank, preserve original document order (stable sort).
    #    We keep track of original indices so we can reconstruct document order
    #    for kept sections.
    indexed: list[tuple[int, _Section, str]] = [
        (i, sec, text) for i, (sec, text) in enumerate(serialised) if text
    ]

    # Sort by (rank asc, original_index asc) — deterministic.
    priority_order = sorted(indexed, key=lambda t: (t[1].rank, t[0]))

    kept_indices: set[int] = set()
    running_chars = 0
    dropped: list[DroppedSection] = []

    for orig_idx, sec, text in priority_order:
        # Cost: text length + separator if this is not the first kept section
        extra = len(separator) if kept_indices else 0
        cost = len(text) + extra
        if running_chars + cost <= budget:
            kept_indices.add(orig_idx)
            running_chars += cost
        else:
            dropped.append(
                DroppedSection(
                    title=sec.title or "<preamble>",
                    char_count=len(text),
                    rank=sec.rank,
                )
            )

    # 7. Reconstruct in original document order.
    kept_parts = [text for i, _, text in indexed if i in kept_indices]
    result_text = separator.join(kept_parts)

    # Defensive: ensure we never exceed budget (rounding/separator edge cases).
    # Track kept sections as a list and pop WHOLE sections from the back —
    # never string-split the serialized output (which would break on separator
    # strings that appear inside block text).
    if len(result_text) > budget:
        # Rebuild the kept list in document order so we can pop whole sections.
        kept_list: list[str] = list(kept_parts)
        while kept_list and len(separator.join(kept_list)) > budget:
            kept_list.pop()
        result_text = separator.join(kept_list)

    return result_text, dropped
