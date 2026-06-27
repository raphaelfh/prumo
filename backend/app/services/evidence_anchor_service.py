"""
Evidence-anchor service — the quote → block matcher.

This is the core grounding algorithm of the grounded-extraction pipeline.  It
anchors an LLM's free-text evidence *quote* back to a verifiable span in the
source document, returning the page, the char range in the canonical
``concat_page_text`` coordinate space, the overlapping block ids, and the union
bounding box for PDF highlighting.

Design
------

**Matching surface.**  The quote is searched against the per-page text produced
by the canonical ``concat_page_text`` (imported from
``app.infrastructure.parsing.base`` — the single source of truth).  Both the
page text and the quote are normalised before comparison.

**Normalisation (both sides).**  Unicode **NFKC** + whitespace folding (runs of
whitespace collapse to a single space; leading/trailing whitespace stripped).
This makes a quote that differs only by ligatures (``ﬁ`` → ``fi``), smart
quotes (``'`` → ``'``), or collapsed whitespace still match.

**Offset coordinate space (the crucial part).**  NFKC and whitespace folding
*change* string length and character positions.  The ``char_start`` /
``char_end`` returned by :func:`match`, however, MUST be offsets into the
ORIGINAL (un-normalised) ``concat_page_text`` page string — the same coordinate
space every block's own ``char_start`` / ``char_end`` lives in.  So for each
page we build a *normalised* surface together with an index map
``norm_to_orig`` such that ``norm_to_orig[i]`` is the original index at which
normalised character ``i`` began.  A matched normalised span ``[ns, ne)`` maps
back to the original span ``[norm_to_orig[ns], norm_to_orig[ne])`` (with
``ne == len(norm)`` mapping to ``len(original)``).

**Bounded, deterministic fuzz (two passes).**  OCR noise (a few wrong
characters) should still match, but an *exact* hit must never lose to a fuzzy
hit, and the search must stay fast enough for the synchronous extraction write
path (the old per-position sliding-window sweep ran in tens of seconds on a real
multi-page PDF and timed out the worker).  So matching runs in two passes:

1. **Exact pass (every page).**  ``str.find`` of the folded quote inside each
   folded page.  If ANY page matches exactly, the best is picked by the
   deterministic tie-break and returned — fuzzy is never run.  This is both more
   correct (an exact match always wins) and the dominant performance win.
2. **Fuzzy pass (only when no page matched exactly and ``fuzz_threshold < 1.0``).**
   Linear per page: a single :meth:`difflib.SequenceMatcher.find_longest_match`
   pass locates the best alignment, a cheap page gate scores that one window and
   skips the page if it is far below threshold, and otherwise a SMALL constant
   grid of windows around the anchor is scored with ``ratio``.  The best
   similarity ratio ≥ ``fuzz_threshold`` wins.  Stdlib only — pure,
   deterministic, no new dependency.

The fuzz unit is a **similarity ratio in [0.0, 1.0]** (``SequenceMatcher.ratio``
— ``2*M/T`` where ``M`` is matched chars and ``T`` is total chars of both
strings).  ``fuzz_threshold=1.0`` means *exact only*; the default
``DEFAULT_FUZZ_THRESHOLD`` tolerates a handful of OCR errors in a sentence-length
quote.  The threshold is a PARAMETER with a sensible default — it is NOT read
from config (config wiring is deferred to a later task).

**Multi-block span + bbox union.**  After mapping the match back to an original
``[char_start, char_end)`` range, ``block_ids`` is every block whose own
``[char_start, char_end)`` overlaps that range (ascending ``block_index``).
``bbox_union`` is the union rectangle over those blocks:
``x = min(x)``, ``y = min(y)``, ``width = max(x+width) - x``,
``height = max(y+height) - y``.

**Deterministic tie-breaking.**  Earliest page, then earliest matched original
``char_start`` (which, because blocks are concatenated in ``block_index`` order,
is the earliest block), then the longest contiguous overlap.  Same inputs always
produce the same output.

**Purity.**  No DB, no IO, no globals.  Input blocks are NEVER mutated: local
``ParsedBlock`` copies are built so that ``assign_char_offsets_to_blocks`` (which
mutates in place) only ever touches the copies, never the caller's
``ArticleTextBlock`` ORM rows (mutating those would dirty the SQLAlchemy
session).
"""

from __future__ import annotations

import unicodedata
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from difflib import SequenceMatcher
from typing import Protocol, runtime_checkable

from app.infrastructure.parsing.base import (
    ParsedBlock,
    assign_char_offsets_to_blocks,
    concat_page_text,
)
from app.schemas.extraction import (
    HybridCitationAnchor,
    PDFRect,
    PDFTextRange,
    PositionV1,
    TextCitationAnchor,
)

# ---------------------------------------------------------------------------
# Tuning constants (parameters, not config)
# ---------------------------------------------------------------------------

#: Default minimum ``SequenceMatcher.ratio`` for a fuzzy match to be accepted.
#: 0.85 tolerates a handful of OCR-style character substitutions in a
#: sentence-length quote while rejecting unrelated text.  ``1.0`` disables fuzz
#: (exact match only).
DEFAULT_FUZZ_THRESHOLD: float = 0.85

#: Fractional slack on the candidate window length during fuzzy search.  The
#: fuzzy search anchors the quote against the page with a single
#: ``SequenceMatcher.find_longest_match`` pass, then probes only a SMALL constant
#: band of candidate windows around that anchor.  Window lengths range from
#: ``(1 - slack) * len(quote)`` to ``(1 + slack) * len(quote)`` so OCR noise that
#: inserts/deletes a few characters is still reachable while the search stays
#: linear in the page length.
_FUZZ_LEN_SLACK: float = 0.25

#: Position offsets (in characters) probed on either side of the anchor returned
#: by ``find_longest_match``.  The longest common block can sit anywhere inside
#: the quote, so we slide the window start a couple of characters around the
#: implied alignment to recover the best-scoring region.  Kept tiny so the
#: candidate count per page stays a small constant
#: (``len(_FUZZ_POS_OFFSETS) * len(window_lengths)``).
_FUZZ_POS_OFFSETS: tuple[int, ...] = (-2, 0, 2)

#: Candidate window-length offsets (fractions of the quote length) probed around
#: the quote length, so a few inserted/deleted characters are still reachable.
#: A small fixed tuple fixes the number of ``.ratio()`` evaluations per page at a
#: constant regardless of page length.
_FUZZ_LEN_FRACTIONS: tuple[float, ...] = (-_FUZZ_LEN_SLACK, 0.0, _FUZZ_LEN_SLACK)

#: A page whose best-aligned full-length window scores below
#: ``fuzz_threshold * _FUZZ_PAGE_GATE`` is skipped entirely — the small candidate
#: grid around the anchor cannot recover enough to cross the threshold, so there
#: is no point scoring the rest of the grid.  This makes a non-matching page cost
#: ONE ``.ratio()`` instead of the whole grid.  Slightly below 1.0 so a window a
#: couple of characters off the ideal alignment is still explored.
_FUZZ_PAGE_GATE: float = 0.9

#: Block types considered "prose" for anchor-variant selection.
#: Any block whose type is NOT in this set (i.e. ``table_cell`` or
#: ``figure_caption``) triggers a ``HybridCitationAnchor`` (range + bbox).
_PROSE_BLOCK_TYPES: frozenset[str] = frozenset(
    {"paragraph", "heading", "list_item", "header", "footer"}
)


# ---------------------------------------------------------------------------
# Public result type
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class AnchorMatch:
    """A grounded anchor for an evidence quote.

    Attributes:
        page: 1-indexed page number the quote was found on.
        char_start: Start offset (inclusive) of the matched span inside the
            ORIGINAL ``concat_page_text`` string for ``page`` — the same
            coordinate space as each block's ``char_start``.
        char_end: End offset (exclusive) of the matched span, same space.
        block_ids: ``block_index`` of every block whose ``[char_start, char_end)``
            overlaps the matched range, in ascending order.
        bbox_union: Union bounding box over ``block_ids`` in PDF user space,
            with keys ``x``, ``y``, ``width``, ``height``.
    """

    page: int
    char_start: int
    char_end: int
    block_ids: list[int]
    bbox_union: dict[str, float]


# ---------------------------------------------------------------------------
# Internal: structural protocol (ParsedBlock and ArticleTextBlock both satisfy)
# ---------------------------------------------------------------------------


@runtime_checkable
class _Block(Protocol):
    """Structural protocol satisfied by both ``ParsedBlock`` and ``ArticleTextBlock``."""

    page_number: int
    block_index: int
    text: str
    char_start: int
    char_end: int
    bbox: dict[str, float]
    block_type: str


# ---------------------------------------------------------------------------
# Normalisation + index map
# ---------------------------------------------------------------------------

_WHITESPACE = frozenset(" \t\n\r\f\v\xa0  ")
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


def _normalize_with_index_map(original: str) -> tuple[str, list[int]]:
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
        if ch in _WHITESPACE:
            # Collapse any run of whitespace; defer the single space so that
            # trailing whitespace never gets emitted.
            pending_space = True
            continue

        nfkc = unicodedata.normalize("NFKC", ch)
        # NFKC of a single non-whitespace char can itself contain whitespace
        # (rare), so fold those too rather than emit them verbatim.
        for sub in nfkc:
            sub = _PUNCT_FOLD.get(sub, sub)  # 1:1 punctuation fold; length-stable
            if sub in _WHITESPACE:
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


def _normalize(text: str) -> str:
    """NFKC + punctuation + whitespace fold (used for the quote side).

    Mirrors :func:`_normalize_with_index_map` minus the index map: the result
    must be byte-identical to the page side so exact substring search works.
    """
    nfkc = unicodedata.normalize("NFKC", text)
    folded = "".join(_PUNCT_FOLD.get(c, c) for c in nfkc)
    return " ".join(folded.split())


# ---------------------------------------------------------------------------
# Internal: candidate match within one page
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class _PageCandidate:
    """The best match found on a single page (in normalised coordinates)."""

    norm_start: int
    norm_end: int
    ratio: float


def _best_exact(norm_page: str, norm_quote: str) -> _PageCandidate | None:
    """Return the EARLIEST exact occurrence of *norm_quote* in *norm_page*."""
    idx = norm_page.find(norm_quote)
    if idx == -1:
        return None
    return _PageCandidate(norm_start=idx, norm_end=idx + len(norm_quote), ratio=1.0)


def _fuzzy_anchor(norm_page: str, norm_quote: str) -> int | None:
    """Return the page offset where *norm_quote* best aligns, or ``None``.

    Instead of sweeping every character position (``O(page_len)`` windows, each
    an ``O(win_len)`` ratio → the quadratic blow-up that timed out production), we
    locate the best-aligned region in a SINGLE ``find_longest_match`` pass.  The
    longest common substring sits at quote index ``a`` / page index ``b``, so the
    quote's start aligns at ``b - a`` in the page (clamped into range).
    """
    page_len = len(norm_page)
    matcher = SequenceMatcher(autojunk=False, a=norm_quote, b=norm_page)
    block = matcher.find_longest_match(0, len(norm_quote), 0, page_len)
    if block.size == 0:
        return None
    return min(max(0, block.b - block.a), page_len - 1)


def _best_fuzzy(
    norm_page: str,
    norm_quote: str,
    fuzz_threshold: float,
) -> _PageCandidate | None:
    """Return the best fuzzy match of *norm_quote* in *norm_page* (or ``None``).

    Linear in the page length.  A single ``SequenceMatcher.find_longest_match``
    pass locates the best-aligned region (:func:`_fuzzy_anchor`).  The full-length
    window at that anchor is scored first as a cheap PAGE GATE: a page whose best
    alignment scores far below the threshold cannot be recovered by the tiny
    candidate grid, so it is skipped after a single ``.ratio()`` (this is what
    keeps a non-matching page cheap).  Otherwise a SMALL constant grid of windows
    around the anchor — a few position offsets × a few lengths within
    ``±_FUZZ_LEN_SLACK`` of the quote length — is scored, and the highest ratio
    ≥ *fuzz_threshold* wins.  Ties on ratio break toward the earliest
    ``norm_start`` then the shortest window, so the result is deterministic.

    Preserves OCR tolerance: a quote with a handful of substituted characters
    aligns cleanly (substitutions don't shift the alignment), so its full-length
    anchor window scores well above the threshold and the gate lets it through.
    """
    q_len = len(norm_quote)
    page_len = len(norm_page)
    if q_len == 0 or page_len == 0:
        return None

    anchor = _fuzzy_anchor(norm_page, norm_quote)
    if anchor is None:
        return None

    matcher = SequenceMatcher(autojunk=False)
    matcher.set_seq2(norm_quote)

    # Cheap page gate: score the full-length window at the primary anchor.  If
    # even that best-aligned window is well below the threshold, no nearby window
    # can cross it — skip the rest of the grid for this page.
    gate_end = min(anchor + q_len, page_len)
    matcher.set_seq1(norm_page[anchor:gate_end])
    if matcher.ratio() < fuzz_threshold * _FUZZ_PAGE_GATE:
        return None

    # A small, fixed grid of window starts × lengths around the anchor so a few
    # inserted/deleted characters are still reachable.
    starts = sorted({min(max(0, anchor + off), page_len - 1) for off in _FUZZ_POS_OFFSETS})
    window_lengths = sorted(
        {max(1, q_len + int(q_len * frac)) for frac in _FUZZ_LEN_FRACTIONS} | {q_len}
    )

    best: _PageCandidate | None = None
    for start in starts:
        for win_len in window_lengths:
            end = min(start + win_len, page_len)
            if end <= start:
                continue
            matcher.set_seq1(norm_page[start:end])
            # real_quick_ratio is a deterministic upper bound; skip windows that
            # cannot beat the current best before paying for the full ratio.
            if best is not None and matcher.real_quick_ratio() < best.ratio:
                continue
            ratio = matcher.ratio()
            if ratio < fuzz_threshold:
                continue
            if best is None or _fuzzy_better(ratio, start, end - start, best):
                best = _PageCandidate(norm_start=start, norm_end=end, ratio=ratio)
    return best


def _fuzzy_better(
    ratio: float,
    start: int,
    win_len: int,
    incumbent: _PageCandidate,
) -> bool:
    """Deterministic ordering: higher ratio, then earlier start, then shorter."""
    inc_len = incumbent.norm_end - incumbent.norm_start
    return (ratio, -start, -win_len) > (incumbent.ratio, -incumbent.norm_start, -inc_len)


# ---------------------------------------------------------------------------
# Internal: map a normalised span back to the original, then to blocks
# ---------------------------------------------------------------------------


def _trim_whitespace(original: str, char_start: int, char_end: int) -> tuple[int, int]:
    """Tighten ``[char_start, char_end)`` over leading/trailing ORIGINAL whitespace.

    Whitespace folding means a match can map back onto a span that begins or
    ends inside a collapsed-whitespace run (or across a block separator), so the
    returned slice would carry stray ``\\n`` / spaces a highlighter would render.
    Trim the start forward over leading whitespace and the end back over trailing
    whitespace.  Fold-equality is preserved because folding strips exactly this
    leading/trailing whitespace anyway.
    """
    while char_start < char_end and original[char_start] in _WHITESPACE:
        char_start += 1
    while char_end > char_start and original[char_end - 1] in _WHITESPACE:
        char_end -= 1
    return char_start, char_end


def _resolve_original_span(
    candidate: _PageCandidate,
    norm_page: str,
    norm_to_orig: list[int],
    original: str,
) -> tuple[int, int] | None:
    """Map a matched normalised span to an ORIGINAL span that honours the invariant.

    Returns ``(char_start, char_end)`` such that
    ``_normalize(original[char_start:char_end]) == _normalize(norm_span)`` (the
    advertised fold-back guarantee), or ``None`` when no such span exists.

    The naive map-back (``norm_to_orig[ns]`` … ``norm_to_orig[ne]``) can break in
    two ways; both are corrected here with fold-equality as the source of truth:

    * **Whitespace padding.**  A boundary can land inside a collapsed-whitespace
      run / across a block separator, so the span carries stray leading/trailing
      ``\\n`` / spaces a highlighter would render.  These are trimmed first
      (:func:`_trim_whitespace`); folding strips exactly that whitespace, so
      trimming never disturbs fold-equality.

    * **Expansion boundary.**  ``norm_to_orig`` maps every sub-character of a
      1→many NFKC expansion (e.g. the ligature ``ﬁ`` → ``f``, ``i``) to the SAME
      original index.  When the match *starts* on a non-first sub-character, the
      naive span includes the WHOLE original expansion char and folds one char too
      WIDE.  We snap the start forward to original-character granularity (dropping
      the partially-covered expansion char) only when that repairs fold-equality.
      If the quote genuinely begins/ends mid-expansion — a degenerate input a real
      LLM quote never produces — no original slice folds to it and we return
      ``None`` rather than a span that violates the guarantee.

    Fold-equality is re-checked after every adjustment, so a valid exact span
    (the overwhelmingly common case) is accepted untouched and a non-representable
    one is rejected rather than silently widened.
    """
    target = _normalize(norm_page[candidate.norm_start : candidate.norm_end])

    char_start = norm_to_orig[candidate.norm_start]
    char_end = (
        norm_to_orig[candidate.norm_end]
        if candidate.norm_end < len(norm_to_orig)
        else len(original)
    )
    char_start, char_end = _trim_whitespace(original, char_start, char_end)

    if char_end > char_start and _normalize(original[char_start:char_end]) == target:
        return char_start, char_end

    # The naive span folds wider than the match: the start fell inside an NFKC
    # expansion.  Snap the start forward to the next original character (dropping
    # the over-included expansion char) and re-check.  If it still does not fold
    # to the match the quote is not representable as any original slice — honour
    # the guarantee by reporting no anchor.
    if char_start < char_end:
        snapped_start, snapped_end = _trim_whitespace(original, char_start + 1, char_end)
        if (
            snapped_end > snapped_start
            and _normalize(original[snapped_start:snapped_end]) == target
        ):
            return snapped_start, snapped_end

    return None


def _overlapping_blocks(
    page_blocks: list[ParsedBlock],
    char_start: int,
    char_end: int,
) -> list[ParsedBlock]:
    """Return blocks whose ``[char_start, char_end)`` overlaps ``[char_start, char_end)``.

    *page_blocks* must carry offsets in ``concat_page_text`` coordinates and be
    sorted by ``block_index`` (the local copies built in :func:`match` satisfy
    both).  Half-open overlap: ``b.char_start < char_end and b.char_end > char_start``.
    """
    return [b for b in page_blocks if b.char_start < char_end and b.char_end > char_start]


def _bbox_union(blocks: list[ParsedBlock]) -> dict[str, float]:
    """Union rectangle over *blocks* in PDF user space.

    ``x = min(x)``, ``y = min(y)``, ``width = max(x+width) - x``,
    ``height = max(y+height) - y``.
    """
    xs = [float(b.bbox["x"]) for b in blocks]
    ys = [float(b.bbox["y"]) for b in blocks]
    x_maxes = [float(b.bbox["x"]) + float(b.bbox["width"]) for b in blocks]
    y_maxes = [float(b.bbox["y"]) + float(b.bbox["height"]) for b in blocks]
    min_x = min(xs)
    min_y = min(ys)
    return {
        "x": min_x,
        "y": min_y,
        "width": max(x_maxes) - min_x,
        "height": max(y_maxes) - min_y,
    }


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def match(
    quote: str,
    blocks: Sequence[_Block],
    *,
    fuzz_threshold: float = DEFAULT_FUZZ_THRESHOLD,
) -> AnchorMatch | None:
    """Anchor *quote* to a span in *blocks*, or return ``None`` if absent.

    Args:
        quote: The LLM's evidence quote (free text).  Normalised with NFKC +
            whitespace folding before matching.
        blocks: ``ArticleTextBlock`` ORM rows or ``ParsedBlock`` dataclasses.
            May be in any order and may carry placeholder ``char_start`` /
            ``char_end`` — the matcher derives canonical offsets itself and
            NEVER mutates the input blocks.
        fuzz_threshold: Minimum ``SequenceMatcher.ratio`` in ``[0.0, 1.0]`` for a
            fuzzy (OCR-tolerant) match.  ``1.0`` accepts exact matches only.
            Defaults to :data:`DEFAULT_FUZZ_THRESHOLD`.  This is a parameter, not
            a config value.

    Returns:
        An :class:`AnchorMatch` whose ``char_start`` / ``char_end`` index the
        ORIGINAL ``concat_page_text`` page string, or ``None`` if the quote is
        not found (exactly or within the fuzz threshold) on any page.

    Tie-breaking is deterministic: earliest page, then earliest original
    ``char_start``, then the longest contiguous overlap.
    """
    norm_quote = _normalize(quote)
    if not norm_quote or not blocks:
        return None

    # Build LOCAL copies so assign_char_offsets_to_blocks mutates only the
    # copies, never the caller's ORM rows.  This also makes the matcher robust
    # to inputs whose char_start/char_end are placeholders.
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
        for b in blocks
    ]
    assign_char_offsets_to_blocks(copies)  # mutates the COPIES only
    page_texts = concat_page_text(copies)

    blocks_by_page: dict[int, list[ParsedBlock]] = {}
    for c in copies:
        blocks_by_page.setdefault(c.page_number, []).append(c)
    for page_blocks in blocks_by_page.values():
        page_blocks.sort(key=lambda b: b.block_index)

    # Pre-normalise every page once (reused by both the exact and fuzzy passes).
    norm_pages: dict[int, tuple[str, list[int], str]] = {}
    for page in sorted(page_texts):
        original = page_texts[page]
        norm_page, norm_to_orig = _normalize_with_index_map(original)
        if norm_page:
            norm_pages[page] = (norm_page, norm_to_orig, original)

    # Pass 1 — EXACT only, every page.  An exact substring match on ANY page must
    # win over any fuzzy match (an exact hit is always more trustworthy and is
    # cheap: ``str.find``), so when at least one page matches exactly we pick the
    # best by the deterministic tie-break and RETURN without ever running fuzzy.
    # This is the dominant performance win — the unbounded fuzzy sweep only runs
    # in the rare absent-exact case, and never when a verbatim quote exists.
    exact_result = _best_over_pages(
        norm_pages,
        blocks_by_page,
        lambda norm_page, _norm_to_orig: _best_exact(norm_page, norm_quote),
    )
    if exact_result is not None:
        return exact_result

    # Pass 2 — bounded fuzzy, only when NO page matched exactly and fuzz is on.
    if fuzz_threshold >= 1.0:
        return None
    return _best_over_pages(
        norm_pages,
        blocks_by_page,
        lambda norm_page, _norm_to_orig: _best_fuzzy(norm_page, norm_quote, fuzz_threshold),
    )


def _best_over_pages(
    norm_pages: dict[int, tuple[str, list[int], str]],
    blocks_by_page: dict[int, list[ParsedBlock]],
    find_candidate: Callable[[str, list[int]], _PageCandidate | None],
) -> AnchorMatch | None:
    """Run *find_candidate* on every page and return the best :class:`AnchorMatch`.

    Shared by both passes of :func:`match`.  *find_candidate* locates a
    normalised-coordinate :class:`_PageCandidate` for one page (exact or fuzzy);
    this helper resolves it to an ORIGINAL span, validates the fold-back
    invariant, and applies the deterministic tie-break (earliest page, then
    earliest original ``char_start``, then the longest contiguous overlap).
    Pages are visited in ascending order so the earliest-page tie-break holds.
    """
    best_result: AnchorMatch | None = None
    best_key: tuple[int, int, int] | None = None  # (page, char_start, -overlap_len)

    for page in sorted(norm_pages):
        norm_page, norm_to_orig, original = norm_pages[page]

        candidate = find_candidate(norm_page, norm_to_orig)
        if candidate is None:
            continue

        resolved = _resolve_original_span(candidate, norm_page, norm_to_orig, original)
        if resolved is None:
            continue
        char_start, char_end = resolved

        overlapping = _overlapping_blocks(blocks_by_page[page], char_start, char_end)
        if not overlapping:
            continue

        # Post-condition: the fold-back invariant MUST hold for every non-None
        # return — the returned span, sliced from the ORIGINAL page text and
        # folded, equals the folded matched region.  ``_resolve_original_span``
        # guarantees this for well-formed inputs.  If it does NOT hold (a
        # degenerate edge case the upstream pipeline cannot produce), degrade
        # gracefully: treat the quote as unlocatable rather than raising in the
        # extraction write path.  A non-None return ALWAYS satisfies the invariant.
        if _normalize(original[char_start:char_end]) != _normalize(
            norm_page[candidate.norm_start : candidate.norm_end]
        ):
            continue

        overlap_len = char_end - char_start
        key = (page, char_start, -overlap_len)
        if best_key is None or key < best_key:
            best_key = key
            best_result = AnchorMatch(
                page=page,
                char_start=char_start,
                char_end=char_end,
                block_ids=[b.block_index for b in overlapping],
                bbox_union=_bbox_union(overlapping),
            )

    return best_result


def build_anchor(
    quote: str,
    blocks: Sequence[_Block],
    *,
    fuzz_threshold: float = DEFAULT_FUZZ_THRESHOLD,
) -> PositionV1 | None:
    """Build a :class:`PositionV1` anchor for *quote* against *blocks*.

    Calls :func:`match` to locate the quote, then picks the
    :class:`~app.schemas.extraction.CitationAnchor` variant based on the
    matched blocks' ``block_type``:

    * **All matched blocks are prose** (``paragraph``, ``heading``,
      ``list_item``, ``header``, ``footer``) →
      :class:`~app.schemas.extraction.TextCitationAnchor` (char range only).
    * **Any matched block is** ``table_cell`` **or** ``figure_caption`` →
      :class:`~app.schemas.extraction.HybridCitationAnchor` (char range +
      bbox union + quote).  Hybrid carries the region for table/figure
      highlighting and is the recommended AI anchor shape.

    The function is **pure** (no DB, no IO).  Idempotent on re-run — same
    inputs always produce the same output.

    Args:
        quote: The LLM's free-text evidence quote.
        blocks: ``ArticleTextBlock`` ORM rows (or ``ParsedBlock`` dataclasses).
            Must cover the full document; typically obtained from
            ``ArticleTextBlockRepository.list_ordered_for_file``.
        fuzz_threshold: Passed through to :func:`match`.  ``1.0`` = exact only.

    Returns:
        A :class:`PositionV1` whose ``anchor`` is set to the appropriate
        variant, or ``None`` if the quote cannot be located in *blocks*.
    """
    m = match(quote, blocks, fuzz_threshold=fuzz_threshold)
    if m is None:
        return None

    # Look up the block_type for each matched block_index on m.page.
    matched_block_types: set[str] = set()
    for b in blocks:
        if b.page_number == m.page and b.block_index in m.block_ids:
            matched_block_types.add(b.block_type)

    text_range = PDFTextRange(page=m.page, char_start=m.char_start, char_end=m.char_end)

    # Hybrid if any matched block is a non-prose type (table_cell / figure_caption).
    non_prose = matched_block_types - _PROSE_BLOCK_TYPES
    if non_prose:
        anchor = HybridCitationAnchor(
            kind="hybrid",
            range=text_range,
            rect=PDFRect(**m.bbox_union),
            quote=quote,
            block_ids=m.block_ids,
        )
    else:
        anchor = TextCitationAnchor(
            kind="text",
            range=text_range,
            quote=quote,
            block_ids=m.block_ids,
        )

    return PositionV1(version=1, anchor=anchor)
