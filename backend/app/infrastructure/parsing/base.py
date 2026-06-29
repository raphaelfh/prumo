"""
Document Parser Port.

Defines the abstract DocumentParser interface and the ParsedBlock value
type.  All concrete parsers (Docling, MinerU, …) implement DocumentParser;
the rest of the codebase imports only from this module.

Separator contract
------------------
``concat_page_text`` joins blocks with a single newline (``"\\n"``).  A
newline is chosen rather than an empty string so that words at the end of
one block and the start of the next do not merge into a single token (e.g.
"method" + "s" → "methods"), which would break substring quote matching.
The newline occupies exactly one character in the page string; char offsets
account for it, so the invariant ::

    block.text == page_text[block.char_start : block.char_end]

holds for every block.

Usage (read-only contract for downstream consumers)
----------------------------------------------------
The prompt-assembler and the evidence-anchorer in the extraction pipeline
MUST import ``concat_page_text`` from this module and MUST NOT re-implement
the concatenation or offset logic.  The function is the single source of
truth.
"""

import math
from abc import ABC, abstractmethod
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Protocol, runtime_checkable

# ---------------------------------------------------------------------------
# Closed block-type vocabulary
# ---------------------------------------------------------------------------

#: The eight block types that the DB CHECK constraint accepts.
#: Any value not in this set is normalised to ``"paragraph"`` before storage.
BLOCK_TYPES: frozenset[str] = frozenset(
    {
        "paragraph",
        "heading",
        "list_item",
        "table_cell",
        "figure_caption",
        "figure",
        "header",
        "footer",
    }
)

_FALLBACK_BLOCK_TYPE = "paragraph"

#: Single newline separator inserted between consecutive blocks on the same
#: page.  Must be one character so offset arithmetic stays simple.
_BLOCK_SEPARATOR = "\n"


def normalize_block_type(raw: str) -> str:
    """Return *raw* if it is in the closed vocabulary, else ``"paragraph"``."""
    return raw if raw in BLOCK_TYPES else _FALLBACK_BLOCK_TYPE


# ---------------------------------------------------------------------------
# ParsedBlock value type
# ---------------------------------------------------------------------------


@dataclass
class ParsedBlock:
    """Immutable representation of one text block extracted from a PDF page.

    Field semantics mirror ``ArticleTextBlock`` (the SQLAlchemy model in
    ``backend/app/models/article.py``) exactly.

    Attributes:
        page_number: 1-indexed page number within the source PDF.
        block_index: 0-indexed reading-order position within the page.
        text: Raw text content of the block.
        char_start: Start offset (inclusive) of *text* inside the page
            string produced by ``concat_page_text``.
        char_end: End offset (exclusive) of *text* inside the page string
            produced by ``concat_page_text``.  Invariant:
            ``page_text[char_start:char_end] == text``.
        bbox: Bounding box in PDF user space (origin bottom-left, points)
            with keys ``x``, ``y``, ``width``, ``height``.
        block_type: One of the seven values in ``BLOCK_TYPES``.  Must be
            normalised before construction (use ``normalize_block_type``).
        row_index: 0-indexed row position within the table (None for non-table blocks).
        col_index: 0-indexed column position within the table (None for non-table blocks).
        row_span: Number of rows spanned by this cell (None for non-table blocks).
        col_span: Number of columns spanned by this cell (None for non-table blocks).
        is_header: Whether this cell is a header cell (None for non-table blocks).
    """

    page_number: int
    block_index: int
    text: str
    char_start: int
    char_end: int
    bbox: dict[str, float]
    block_type: str
    # Native table-cell grid (None for non-table blocks / legacy parsers).
    row_index: int | None = None
    col_index: int | None = None
    row_span: int | None = None
    col_span: int | None = None
    is_header: bool | None = None


# ---------------------------------------------------------------------------
# concat_page_text — single source of truth for char offsets
# ---------------------------------------------------------------------------


def _blocks_by_page_sorted(
    blocks: list[ParsedBlock],
) -> dict[int, list[ParsedBlock]]:
    """Group *blocks* by page number and sort each group by ``block_index``.

    This is the single source of truth for per-page grouping and ordering used
    by both ``concat_page_text`` and ``assign_char_offsets_to_blocks``.

    Args:
        blocks: Parsed blocks from one or more pages.  May be in any order.

    Returns:
        ``{page_number: [blocks sorted by block_index]}`` for every page that
        appears in *blocks*.
    """
    pages: dict[int, list[ParsedBlock]] = {}
    for block in blocks:
        pages.setdefault(block.page_number, []).append(block)
    return {pn: sorted(pb, key=lambda b: b.block_index) for pn, pb in pages.items()}


def concat_page_text(blocks: list[ParsedBlock]) -> dict[int, str]:
    """Return a mapping of ``page_number → page_text`` for all pages in *blocks*.

    Blocks on each page are joined in ascending ``block_index`` order with a
    single newline (``"\\n"``) as separator (see module-level docstring for the
    rationale).

    The ``char_start`` / ``char_end`` fields stored on every ``ParsedBlock``
    **must** be computed by this function (or by
    ``assign_char_offsets_to_blocks``) so that the invariant ::

        block.text == page_text[block.char_start : block.char_end]

    holds for every block.

    Args:
        blocks: Parsed blocks from one or more pages.  May be in any order.

    Returns:
        ``{page_number: concatenated_page_string}`` for every page that
        appears in *blocks*.  Pages not present in *blocks* are absent from
        the result.
    """
    return {
        page_number: _BLOCK_SEPARATOR.join(b.text for b in page_blocks)
        for page_number, page_blocks in _blocks_by_page_sorted(blocks).items()
    }


def assign_char_offsets_to_blocks(blocks: list[ParsedBlock]) -> list[ParsedBlock]:
    """Compute and set ``char_start`` / ``char_end`` on each block in *blocks*.

    This is the *write* side of the same single mechanism that
    ``concat_page_text`` uses.  Concrete parsers should call this after
    populating the other fields so that offsets are always consistent with
    the concatenated page text.

    The blocks are mutated in-place **and** returned for convenience.

    Args:
        blocks: Parsed blocks whose offsets should be set.  May span multiple
            pages.  Within each page, blocks are processed in ascending
            ``block_index`` order.

    Returns:
        The same list, mutated in place.
    """
    for page_blocks in _blocks_by_page_sorted(blocks).values():
        cursor = 0
        for i, block in enumerate(page_blocks):
            if i > 0:
                # Account for the separator that precedes this block.
                cursor += len(_BLOCK_SEPARATOR)
            block.char_start = cursor
            block.char_end = cursor + len(block.text)
            cursor = block.char_end

    return blocks


# ---------------------------------------------------------------------------
# DocumentParser ABC
# ---------------------------------------------------------------------------


class DocumentParser(ABC):
    """Abstract base class for PDF document parsers.

    All concrete parser implementations (Docling, MinerU, etc.) must
    subclass ``DocumentParser`` and implement ``parse``.

    The returned ``ParsedBlock`` list must satisfy:
    - ``block_type`` is one of ``BLOCK_TYPES`` (use ``normalize_block_type``).
    - ``char_start`` / ``char_end`` are consistent with ``concat_page_text``;
      the easiest way to guarantee this is to call
      ``assign_char_offsets_to_blocks`` before returning.

    No database, IO, or HTTP is permitted in this layer.
    """

    @abstractmethod
    def parse(self, pdf_bytes: bytes) -> list[ParsedBlock]:
        """Parse *pdf_bytes* and return a list of ``ParsedBlock`` objects.

        Args:
            pdf_bytes: Raw PDF file content.

        Returns:
            A flat list of ``ParsedBlock`` objects across all pages.  Order
            within the list is not specified; use ``block_index`` and
            ``page_number`` for sorting.

        Raises:
            ValueError: If *pdf_bytes* cannot be parsed as a PDF.
        """


# ---------------------------------------------------------------------------
# render_blocks_to_markdown — canonical block→GFM projection (ADR-0013)
# ---------------------------------------------------------------------------


@runtime_checkable
class BlockLike(Protocol):
    """Structural type satisfied by both ``ParsedBlock`` and ``ArticleTextBlock``."""

    page_number: int
    block_index: int
    text: str
    block_type: str
    # Optional native cell-grid metadata; absent/None on legacy blocks.
    row_index: int | None
    col_index: int | None
    row_span: int | None
    col_span: int | None
    is_header: bool | None


_MD_TABLE_CELL_SEP = " | "
_MD_TABLE_RULE_CHAR = "-"


def _infer_column_count(cell_texts: list[str]) -> int:
    """Heuristically infer a table's column count from its flat cell list."""
    n = len(cell_texts)
    if n <= 1:
        return 1
    for cols in range(2, min(9, n + 1)):
        if n % cols == 0:
            return cols
    return min(8, max(2, math.ceil(math.sqrt(n))))


def _render_table_legacy(cell_texts: list[str]) -> str:
    """Render a flat list of table-cell texts as a deterministic GFM table."""
    if not cell_texts:
        return ""
    cols = _infer_column_count(cell_texts)
    rows: list[list[str]] = []
    for i in range(0, len(cell_texts), cols):
        row = cell_texts[i : i + cols]
        while len(row) < cols:
            row.append("")
        rows.append(row)
    widths = [max(len(r[c]) for r in rows) for c in range(cols)]

    def _fmt(row: list[str]) -> str:
        cells = [r.ljust(w) for r, w in zip(row, widths, strict=True)]
        return "| " + _MD_TABLE_CELL_SEP.join(cells) + " |"

    rule = "|-" + "-|-".join(_MD_TABLE_RULE_CHAR * w for w in widths) + "-|"
    return "\n".join([_fmt(rows[0]), rule, *(_fmt(r) for r in rows[1:])])


def _render_table_from_grid(cells: Sequence[BlockLike]) -> str:
    """Render GFM from cells carrying native (row_index, col_index).

    Cells are placed by (row_index, col_index); no column-width padding is
    applied so the output is compact and diff-stable across edits.
    """
    cells = list(cells)
    if not cells:
        return ""
    n_rows = max((c.row_index or 0) for c in cells) + 1
    n_cols = max((c.col_index or 0) for c in cells) + 1
    grid = [["" for _ in range(n_cols)] for _ in range(n_rows)]
    for c in cells:
        grid[c.row_index or 0][c.col_index or 0] = c.text

    def _fmt(row: list[str]) -> str:
        return "| " + _MD_TABLE_CELL_SEP.join(row) + " |"

    rule = "|-" + "-|-".join(_MD_TABLE_RULE_CHAR for _ in range(n_cols)) + "-|"
    return "\n".join([_fmt(grid[0]), rule, *(_fmt(grid[r]) for r in range(1, n_rows))])


def _render_table(cells: Sequence[BlockLike]) -> str:
    """Render a contiguous table_cell run as GFM.

    Uses the native (row, col) grid when every cell carries it; otherwise falls
    back to the legacy flat-text column heuristic (legacy / pre-P3 blocks).
    """
    cells = list(cells)
    # BlockLike declares row_index/col_index (Task 1), so direct attribute
    # access is mypy-clean (no getattr-returns-Any noise for the ratchet).
    if cells and all(c.row_index is not None and c.col_index is not None for c in cells):
        return _render_table_from_grid(cells)
    return _render_table_legacy([c.text for c in cells])


def render_blocks_to_markdown(blocks: Sequence[BlockLike]) -> str:
    """Project article text blocks to deterministic GFM markdown (ADR-0013 free tier).

    Reading order (page asc, block_index asc); ``## `` headings; ``- `` list
    items; contiguous same-page ``table_cell`` runs coalesced into a GFM table;
    ``paragraph`` / ``figure_caption`` as plain text; ``header`` / ``footer``
    page chrome suppressed. Pure: no DB, no IO. The extraction assembler
    serialises each kept section through this function so the prompt's tables and
    the reader's tables are byte-identical (one serialization codepath).
    """
    ordered = sorted(blocks, key=lambda b: (b.page_number, b.block_index))
    parts: list[str] = []
    i = 0
    while i < len(ordered):
        block = ordered[i]
        if block.block_type in ("header", "footer", "figure"):
            i += 1
            continue
        if block.block_type == "table_cell":
            page = block.page_number
            run: list[BlockLike] = []
            while (
                i < len(ordered)
                and ordered[i].block_type == "table_cell"
                and ordered[i].page_number == page
            ):
                run.append(ordered[i])
                i += 1
            parts.append(_render_table(run))
            continue
        if block.block_type == "heading":
            parts.append(f"## {block.text}")
        elif block.block_type == "list_item":
            parts.append(f"- {block.text}")
        else:
            parts.append(block.text)
        i += 1
    return "\n".join(p for p in parts if p)
