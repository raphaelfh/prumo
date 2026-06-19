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

from abc import ABC, abstractmethod
from dataclasses import dataclass

# ---------------------------------------------------------------------------
# Closed block-type vocabulary
# ---------------------------------------------------------------------------

#: The seven block types that the DB CHECK constraint accepts.
#: Any value not in this set is normalised to ``"paragraph"`` before storage.
BLOCK_TYPES: frozenset[str] = frozenset(
    {
        "paragraph",
        "heading",
        "list_item",
        "table_cell",
        "figure_caption",
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
    """

    page_number: int
    block_index: int
    text: str
    char_start: int
    char_end: int
    bbox: dict[str, float]
    block_type: str


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
