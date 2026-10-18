"""Block refs an AI answer cites → the source window they name.

The extraction prompt marks every block with a citation ref
(``[p3·b12]``, or ``[p3·b12–b18]`` for a coalesced table run;
``app.schemas.mcp_article_text.chunk_locator_prefix``). The model answers
evidence as ``{block_ref, quote}``; this module parses the ref, resolves it
to a small window of source blocks and checks the quote sits inside it, so
the grounding validator (``app.llm.validators``) and the evidence write path
(``app.services.ai_extraction._candidates``) share one reading.

It also owns the text normalization (NFKC + punctuation + whitespace fold)
that quote matching uses on both sides, so the window check and the anchor
matcher (``app.services.evidence_anchor_service``) can never disagree on
what "the same words" means.

Support module: imports ``app.infrastructure.parsing.base`` and the stdlib
only — never a service, repository or model
(``scripts/fitness/check_layered_arch.py``).
"""

from __future__ import annotations

import re
import unicodedata
from collections.abc import Sequence
from dataclasses import dataclass

from app.infrastructure.parsing.base import BlockLike

# ---------------------------------------------------------------------------
# Normalization (shared with the anchor matcher)
# ---------------------------------------------------------------------------

#: The characters a whitespace run folds (the anchor matcher trims spans with it).
WHITESPACE = frozenset(" \t\n\r\f\v\xa0  ")
#: Typographic punctuation that NFKC does NOT fold but which routinely differs
#: between an LLM's quote and the source PDF.  Each mapping is a 1:1 character
#: replacement so the normalised → original index map stays exact (length is
#: preserved).  Curly single/double quotes and primes fold to their ASCII
#: equivalents; the various dashes fold to a hyphen-minus.
_PUNCT_FOLD: dict[str, str] = {
    "‘": "'",  # left single quote
    "’": "'",  # right single quote / apostrophe
    "‚": "'",  # single low-9 quote
    "‛": "'",  # single high-reversed-9 quote
    "′": "'",  # prime
    "“": '"',  # left double quote
    "”": '"',  # right double quote
    "„": '"',  # double low-9 quote
    "‟": '"',  # double high-reversed-9 quote
    "″": '"',  # double prime
    "‐": "-",  # hyphen
    "‑": "-",  # non-breaking hyphen
    "‒": "-",  # figure dash
    "–": "-",  # en dash
    "—": "-",  # em dash
    "―": "-",  # horizontal bar
    "−": "-",  # minus sign
}


def normalize_with_index_map(original: str) -> tuple[str, list[int]]:
    """Return ``(normalised, norm_to_orig)`` for *original*.

    Normalisation is **NFKC + whitespace folding**: each original character is
    NFKC-normalised individually (which may expand it to several characters,
    e.g. the ligature ``ﬁ`` → ``"fi"``), runs of whitespace collapse to a single
    space, and leading/trailing whitespace is stripped.

    ``norm_to_orig[i]`` is the index into *original* at which normalised
    character ``i`` began.  Mapping the normalised half-open span ``[ns, ne)``
    back to the original is ``original[norm_to_orig[ns] : end]`` where ``end`` is
    ``norm_to_orig[ne]`` if ``ne < len(norm)`` else ``len(original)``.

    Processing character-by-character (rather than normalising the whole string
    at once) is what keeps the index map exact: we always know which ORIGINAL
    offset produced each emitted normalised character.
    """
    norm_chars: list[str] = []
    norm_to_orig: list[int] = []
    pending_space = False  # a folded-whitespace run is pending emission

    for orig_idx, ch in enumerate(original):
        if ch in WHITESPACE:
            # Collapse any run of whitespace; defer the single space so that
            # trailing whitespace never gets emitted.
            pending_space = True
            continue

        nfkc = unicodedata.normalize("NFKC", ch)
        # NFKC of a single non-whitespace char can itself contain whitespace
        # (rare), so fold those too rather than emit them verbatim.
        for sub in nfkc:
            sub = _PUNCT_FOLD.get(sub, sub)  # 1:1 punctuation fold; length-stable
            if sub in WHITESPACE:
                pending_space = True
                continue
            if pending_space and norm_chars:
                # Emit the single folded space only between real characters.
                norm_chars.append(" ")
                norm_to_orig.append(orig_idx)
            pending_space = False
            norm_chars.append(sub)
            norm_to_orig.append(orig_idx)

    return "".join(norm_chars), norm_to_orig


def normalize_text(text: str) -> str:
    """NFKC + punctuation + whitespace fold (used for the quote side).

    Mirrors :func:`normalize_with_index_map` minus the index map: the result
    must be byte-identical to the page side so exact substring search works.
    """
    nfkc = unicodedata.normalize("NFKC", text)
    folded = "".join(_PUNCT_FOLD.get(c, c) for c in nfkc)
    return " ".join(folded.split())


# ---------------------------------------------------------------------------
# Block refs
# ---------------------------------------------------------------------------

#: ``p3·b12`` / ``p3.b12`` / ``p3·b12–b18`` / ``p3.b12-b18``, optionally
#: bracketed, case-insensitive. A ``cont.`` suffix (a chunk
#: resuming mid-block in the MCP reader) is not a citable ref.
_REF = re.compile(
    r"\s*\[?\s*p(\d+)\s*[·.]\s*b(\d+)(?:\s*[–-]\s*b?(\d+))?\s*\]?\s*",
    re.IGNORECASE,
)


@dataclass(frozen=True)
class BlockRef:
    """A parsed ``p3·b12`` (``first == last``) or ``p3·b12–b18`` ref."""

    page: int
    first: int
    last: int


@dataclass(frozen=True)
class BlockRefWindow:
    """The source blocks a ref resolves to, on one page."""

    page: int
    block_indexes: tuple[int, ...]
    #: The window blocks' text joined with ``"\\n"``, in block order.
    text: str


class BlockRefIndex:
    """``page -> {block_index: block}`` over the blocks the prompt carried."""

    def __init__(self, blocks: Sequence[BlockLike]) -> None:
        self._pages: dict[int, dict[int, BlockLike]] = {}
        for block in blocks:
            self._pages.setdefault(block.page_number, {})[block.block_index] = block

    def page(self, page: int) -> dict[int, BlockLike] | None:
        return self._pages.get(page)


def parse_block_ref(raw: str) -> BlockRef | None:
    """The ref in *raw*, or ``None`` for garbage, page 0 or a reversed range."""
    m = _REF.fullmatch(raw)
    if m is None:
        return None
    page, first = int(m.group(1)), int(m.group(2))
    last = int(m.group(3)) if m.group(3) is not None else first
    if page < 1 or first > last:
        return None
    return BlockRef(page=page, first=first, last=last)


def ref_window(index: BlockRefIndex, ref: BlockRef) -> BlockRefWindow | None:
    """The blocks *ref* names: a single block plus its existing neighbours on
    the page (a quote may run across a block boundary), or every block of a
    range (a table run). ``None`` when the page or ``ref.first`` is unknown."""
    blocks = index.page(ref.page)
    if blocks is None or ref.first not in blocks:
        return None
    lo, hi = (ref.first - 1, ref.first + 1) if ref.first == ref.last else (ref.first, ref.last)
    indexes = tuple(i for i in range(lo, hi + 1) if i in blocks)
    return BlockRefWindow(
        page=ref.page,
        block_indexes=indexes,
        text="\n".join(blocks[i].text for i in indexes),
    )


def quote_in_window(quote: str, window: BlockRefWindow) -> bool:
    """A non-empty quote whose normalized text is inside the window's."""
    needle = normalize_text(quote)
    return bool(needle) and needle in normalize_text(window.text)
