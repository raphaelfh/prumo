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

**Scope**: pure function, no DB, no IO, no globals.  Section serialization
delegates to ``render_blocks_to_markdown`` (one GFM codepath shared with the
reader).
"""

from __future__ import annotations

import re
from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Protocol, runtime_checkable

from app.infrastructure.parsing.base import render_blocks_to_markdown
from app.schemas.extraction import AssemblyInfo

try:
    import tiktoken
except ImportError:  # pragma: no cover - tiktoken ships with pydantic-ai-slim[openai]
    tiktoken = None  # type: ignore[assignment]

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
        block_count: Number of blocks in the dropped section.
    """

    title: str
    char_count: int
    rank: int
    block_count: int


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
    # Optional native cell-grid metadata (None on non-table / legacy blocks);
    # declared so the type stays assignable to base.BlockLike for the shared
    # render_blocks_to_markdown serializer.
    row_index: int | None
    col_index: int | None
    row_span: int | None
    col_span: int | None
    is_header: bool | None


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


# ---------------------------------------------------------------------------
# Internal: serialize a section's blocks into a text string
# ---------------------------------------------------------------------------


def _serialize_section(section: _Section) -> str:
    """Serialise a section: ``## title`` marker + body via render_blocks_to_markdown."""
    parts: list[str] = []
    if section.title:
        parts.append(f"## {section.title}")
    body = render_blocks_to_markdown(section.blocks)
    if body:
        parts.append(body)
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
    blocks: Sequence[_Block],
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
        - Input blocks are never mutated.
        - Section body text is produced by ``render_blocks_to_markdown``
          (ADR-0013: one GFM codepath shared with the reader).
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

    # 2. Segment into sections.
    sections = _segment_into_sections(sorted_blocks, focus)

    # 3. Serialise each section to compute its character cost.
    serialised: list[tuple[_Section, str]] = [(sec, _serialize_section(sec)) for sec in sections]

    # 4. Check if everything fits within budget.
    #    Join with double newline between sections.
    separator = "\n\n"
    full_text_parts = [text for _, text in serialised if text]
    full_text = separator.join(full_text_parts)

    if len(full_text) <= budget:
        return full_text, []

    # 5. Over budget: select whole sections greedily, highest priority first.
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
                    block_count=len(sec.blocks),
                )
            )

    # 6. Reconstruct in original document order.
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


# ---------------------------------------------------------------------------
# Model-aware wrapper
# ---------------------------------------------------------------------------

_CHARS_PER_TOKEN = 4  # heuristic char→token ratio for English / scientific prose


def estimate_tokens(text: str, model_name: str) -> int:
    """Best-effort token count: tiktoken for OpenAI models, ``len // 4`` heuristic
    otherwise (e.g. Anthropic, which tiktoken cannot encode — see the documented
    skew in test_assembler)."""
    if not text:
        return 0
    if tiktoken is not None:
        try:
            return len(tiktoken.encoding_for_model(model_name).encode(text))
        except KeyError:
            pass
    return max(1, len(text) // _CHARS_PER_TOKEN)


def assemble_for_model(
    blocks: Sequence[_Block],
    *,
    model_name: str,
    budget_tokens: int,
    focus: str | None = None,
) -> tuple[str, AssemblyInfo]:
    """Assemble *blocks* within a model-aware token budget, returning the markdown
    plus a typed ``AssemblyInfo``. Converts the token budget to a char budget for
    the deterministic char-based ``assemble``; reports actual usage. Never raises —
    over-budget docs drop whole low-priority sections (``AssemblyInfo.truncated``)."""
    char_budget = max(1, budget_tokens * _CHARS_PER_TOKEN)
    text, dropped = assemble(blocks, budget=char_budget, focus=focus)
    dropped_blocks = sum(d.block_count for d in dropped)
    info = AssemblyInfo(
        total_blocks=len(blocks),
        included_blocks=len(blocks) - dropped_blocks,
        truncated=bool(dropped),
        est_tokens=estimate_tokens(text, model_name),
    )
    return text, info
