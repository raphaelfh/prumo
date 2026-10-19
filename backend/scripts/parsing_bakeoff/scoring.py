"""Pure scoring functions for the parsing bake-off.

Everything here is deterministic and dependency-free (stdlib only) so it is
unit-testable without any parser library, model call, or document. The
metrics intentionally mirror what ADR-0011's Validation section asks for:

* ``box_iou`` / ``match_boxes`` — bounding-box correctness (the provenance
  signal: can a reviewer's highlight land on the right region?).
* ``cell_set_f1`` — a structural table-fidelity *proxy*. True TEDS and the
  LLM-judge (which the research found correlates better than TEDS) are run
  at evaluation time with external tools/models; this proxy needs no deps
  and gives a fast, reproducible signal in CI.
* ``recall_set`` — section-heading and reference recovery.
* ``column_inversions`` / ``order_breaks`` / ``chrome_leakage`` / ``zw_char_count`` — reading
  order against the gold paragraph sequence, running heads left as body text,
  and invisible characters in the stored block text.
* ``p95`` / ``maxrss_to_mb`` — per-parser latency tail and peak memory.
* ``aggregate`` — roll per-document scores up to one report per parser.

Text comparisons normalise with Unicode NFKC + whitespace folding +
casefold, matching the anchoring contract (OCR ligatures / smart quotes
must not cause false misses).
"""

from __future__ import annotations

import math
import re
import unicodedata
from collections import Counter, defaultdict
from dataclasses import dataclass, field

# ---------------------------------------------------------------------------
# Text normalisation (shared with the anchoring contract's intent)
# ---------------------------------------------------------------------------


def normalize_text(value: str) -> str:
    """NFKC + collapse all whitespace runs to single spaces + casefold."""
    nfkc = unicodedata.normalize("NFKC", value)
    return " ".join(nfkc.split()).casefold()


# ---------------------------------------------------------------------------
# Bounding boxes (PDF user space: x, y, width, height — all >= 0)
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Box:
    """Axis-aligned box in PDF user-space points."""

    x: float
    y: float
    width: float
    height: float

    @property
    def area(self) -> float:
        return max(0.0, self.width) * max(0.0, self.height)


def box_iou(a: Box, b: Box) -> float:
    """Intersection-over-union of two boxes. 0.0 when they do not overlap."""
    left = max(a.x, b.x)
    bottom = max(a.y, b.y)
    right = min(a.x + a.width, b.x + b.width)
    top = min(a.y + a.height, b.y + b.height)
    inter = max(0.0, right - left) * max(0.0, top - bottom)
    if inter <= 0.0:
        return 0.0
    union = a.area + b.area - inter
    return inter / union if union > 0 else 0.0


@dataclass(frozen=True)
class PRF:
    """Precision / recall / F1 triple."""

    precision: float
    recall: float
    f1: float


def _prf(true_positives: int, n_pred: int, n_gold: int) -> PRF:
    # Both empty → vacuously perfect; one empty → zero.
    if n_pred == 0 and n_gold == 0:
        return PRF(1.0, 1.0, 1.0)
    precision = true_positives / n_pred if n_pred else 0.0
    recall = true_positives / n_gold if n_gold else 0.0
    denom = precision + recall
    f1 = (2 * precision * recall / denom) if denom else 0.0
    return PRF(precision, recall, f1)


def match_boxes(pred: list[Box], gold: list[Box], iou_threshold: float = 0.5) -> PRF:
    """Greedy one-to-one box matching above ``iou_threshold`` → P/R/F1.

    Each gold box is matched to its best unused predicted box; a match
    counts as a true positive only if its IoU meets the threshold.
    """
    used: set[int] = set()
    true_positives = 0
    for g in gold:
        best_iou, best_idx = 0.0, -1
        for i, p in enumerate(pred):
            if i in used:
                continue
            iou = box_iou(p, g)
            if iou > best_iou:
                best_iou, best_idx = iou, i
        if best_idx >= 0 and best_iou >= iou_threshold:
            used.add(best_idx)
            true_positives += 1
    return _prf(true_positives, len(pred), len(gold))


# ---------------------------------------------------------------------------
# Set-based content metrics (tables, sections, references)
# ---------------------------------------------------------------------------


def cell_set_f1(pred_cells: list[str], gold_cells: list[str]) -> PRF:
    """Multiset F1 over normalised table-cell strings (a TEDS proxy).

    Multiset (not set) so repeated identical cell values — common in
    clinical results tables — are not silently collapsed.
    """
    pred = Counter(normalize_text(c) for c in pred_cells)
    gold = Counter(normalize_text(c) for c in gold_cells)
    true_positives = sum((pred & gold).values())
    return _prf(true_positives, sum(pred.values()), sum(gold.values()))


def recall_set(pred: list[str], gold: list[str]) -> float:
    """Fraction of gold items present (normalised) in pred. Empty gold → 1.0."""
    if not gold:
        return 1.0
    pred_norm = {normalize_text(p) for p in pred}
    hit = sum(1 for g in gold if normalize_text(g) in pred_norm)
    return hit / len(gold)


# ---------------------------------------------------------------------------
# Block-level metrics: reading order, page chrome, invisible characters
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Block:
    """One stored block in reading order. ``box`` is top-left origin (y down)."""

    page: int
    text: str
    block_type: str
    box: Box


#: Blocks that are not body text for reading order.
_NON_BODY_TYPES = frozenset({"header", "footer", "table_cell", "figure"})
#: A block and a gold paragraph match when their first this-many alphanumeric
#: characters (normalized) agree; shorter gold paragraphs are skipped.
_PARAGRAPH_KEY_CHARS = 24


def _paragraph_key(text: str) -> str:
    alnum = "".join(ch for ch in normalize_text(text) if ch.isalnum())
    return alnum[:_PARAGRAPH_KEY_CHARS]


def _matched_order(blocks: list[Block], gold_paragraphs: list[str]) -> list[int]:
    """Gold paragraph indexes in the parser's reading order.

    Each body block is matched to the gold paragraph whose normalized,
    alphanumeric-only prefix it starts with (so a line-break hyphen or a
    trailing sentence does not break the match); a block that starts mid
    paragraph matches nothing. Gold paragraphs with a short or ambiguous
    prefix are skipped, and each gold paragraph counts once (its first block).
    """
    key_counts = Counter(_paragraph_key(p) for p in gold_paragraphs)
    index_by_key = {
        _paragraph_key(p): i
        for i, p in enumerate(gold_paragraphs)
        if len(_paragraph_key(p)) == _PARAGRAPH_KEY_CHARS and key_counts[_paragraph_key(p)] == 1
    }
    order: list[int] = []
    seen: set[int] = set()
    for block in blocks:
        if block.block_type in _NON_BODY_TYPES:
            continue
        index = index_by_key.get(_paragraph_key(block.text))
        if index is not None and index not in seen:
            seen.add(index)
            order.append(index)
    return order


def column_inversions(blocks: list[Block], gold_paragraphs: list[str]) -> tuple[int, int]:
    """Inversions of gold paragraph indexes in the parser's reading order.

    Returns ``(inversions, paragraphs_matched)``: the number of pairs read in
    the opposite order to the gold sequence, and how many paragraphs matched.
    One displaced paragraph inflates this by its displacement distance; see
    ``order_breaks`` for the count of reading-order jumps.
    """
    order = _matched_order(blocks, gold_paragraphs)
    inversions = sum(1 for i, left in enumerate(order) for right in order[i + 1 :] if left > right)
    return inversions, len(order)


def order_breaks(blocks: list[Block], gold_paragraphs: list[str]) -> int:
    """Adjacent descents in the parser's reading order of gold paragraphs.

    Each break is one place a reader jumps backwards (e.g. a column read out
    of turn), however far the jump; a single displaced paragraph is one break.
    """
    order = _matched_order(blocks, gold_paragraphs)
    return sum(1 for left, right in zip(order, order[1:], strict=False) if left > right)


#: The 4.1a chrome rule: top/bottom band height ratio and minimum repeat pages.
_CHROME_BAND_RATIO = 0.08
_CHROME_MIN_PAGES = 3
_CHROME_IGNORED_TYPES = frozenset({"table_cell", "figure"})
_CHROME_TYPES = frozenset({"header", "footer"})
_CAPTION = re.compile(r"^(?:table|figure|fig\.?)\s*\d+", re.IGNORECASE)


def _chrome_key(text: str) -> str:
    return " ".join(re.sub(r"\d+", "#", text.casefold()).split())


def chrome_leakage(blocks: list[Block], page_heights: dict[int, float]) -> int:
    """Count running heads/footers a parser left typed as content.

    A block lying wholly in the top (bottom) 8% band of its page whose
    digit-masked text recurs in that band on at least three distinct pages is
    chrome; it leaks when its type is not ``header``/``footer``. Table cells,
    figures and numbered captions are never chrome (the 4.1a rule).
    """
    candidates: list[tuple[Block, tuple[str, str]]] = []
    pages_by_key: dict[tuple[str, str], set[int]] = defaultdict(set)
    for block in blocks:
        height = page_heights.get(block.page)
        text = block.text.strip()
        if not height or block.block_type in _CHROME_IGNORED_TYPES:
            continue
        if not text or _CAPTION.match(text):
            continue
        band = height * _CHROME_BAND_RATIO
        if block.box.y + block.box.height <= band:
            key = ("top", _chrome_key(text))
        elif block.box.y >= height - band:
            key = ("bottom", _chrome_key(text))
        else:
            continue
        candidates.append((block, key))
        pages_by_key[key].add(block.page)
    return sum(
        1
        for block, key in candidates
        if block.block_type not in _CHROME_TYPES and len(pages_by_key[key]) >= _CHROME_MIN_PAGES
    )


#: Zero-width space / non-joiner / joiner, word joiner, BOM, soft hyphen.
ZW_CHARS = frozenset("\u200b\u200c\u200d\u2060\ufeff\u00ad")


def zw_char_count(blocks: list[Block]) -> int:
    """Invisible characters left in the stored block text."""
    return sum(1 for block in blocks for ch in block.text if ch in ZW_CHARS)


def p95(values: list[float]) -> float:
    """Nearest-rank 95th percentile (an observed value). Empty → 0.0."""
    if not values:
        return 0.0
    ordered = sorted(values)
    return ordered[math.ceil(0.95 * len(ordered)) - 1]


def maxrss_to_mb(raw: int, platform: str) -> float:
    """``ru_maxrss`` → MB: macOS reports bytes, Linux reports KiB."""
    return raw / (1024 * 1024) if platform == "darwin" else raw / 1024


# ---------------------------------------------------------------------------
# Per-document and per-parser aggregation
# ---------------------------------------------------------------------------


@dataclass
class DocScore:
    """Score for one (parser, document) pair."""

    doc_id: str
    table_f1: float = 0.0
    bbox_f1: float = 0.0
    #: True only when the doc had gold regions to score bbox against. Docs
    #: without gold regions are excluded from the bbox mean (otherwise a
    #: parser that emits no boxes scores a vacuous 1.0 via match_boxes([], [])).
    bbox_scored: bool = False
    section_recall: float = 0.0
    reference_recall: float = 0.0
    column_inversions: int = 0
    paragraphs_matched: int = 0
    order_breaks: int = 0
    chrome_leakage: int = 0
    zw_chars: int = 0
    parse_seconds: float = 0.0
    est_cost_usd: float = 0.0
    error: str | None = None


@dataclass
class ParserReport:
    """Aggregate of one parser across the evaluation set."""

    parser: str
    n_docs: int
    n_errors: int
    mean_table_f1: float
    mean_bbox_f1: float
    mean_section_recall: float
    mean_reference_recall: float
    mean_latency_s: float
    total_cost_usd: float
    total_column_inversions: int = 0
    total_order_breaks: int = 0
    total_chrome_leakage: int = 0
    total_zw_chars: int = 0
    p95_parse_seconds: float = 0.0
    #: Peak resident memory of the parser's own subprocess (None in-process).
    peak_rss_mb: float | None = None
    doc_scores: list[DocScore] = field(default_factory=list)


def _mean(values: list[float]) -> float:
    return sum(values) / len(values) if values else 0.0


def aggregate(
    parser: str, doc_scores: list[DocScore], peak_rss_mb: float | None = None
) -> ParserReport:
    """Roll per-document scores into one report. Errored docs are excluded
    from the quality means and totals (you cannot score a parse that failed)
    but are counted in ``n_errors`` and still contribute their cost/latency."""
    ok = [d for d in doc_scores if d.error is None]
    return ParserReport(
        parser=parser,
        n_docs=len(doc_scores),
        n_errors=sum(1 for d in doc_scores if d.error is not None),
        mean_table_f1=_mean([d.table_f1 for d in ok]),
        mean_bbox_f1=_mean([d.bbox_f1 for d in ok if d.bbox_scored]),
        mean_section_recall=_mean([d.section_recall for d in ok]),
        mean_reference_recall=_mean([d.reference_recall for d in ok]),
        mean_latency_s=_mean([d.parse_seconds for d in doc_scores]),
        total_cost_usd=sum(d.est_cost_usd for d in doc_scores),
        total_column_inversions=sum(d.column_inversions for d in ok),
        total_order_breaks=sum(d.order_breaks for d in ok),
        total_chrome_leakage=sum(d.chrome_leakage for d in ok),
        total_zw_chars=sum(d.zw_chars for d in ok),
        p95_parse_seconds=p95([d.parse_seconds for d in doc_scores]),
        peak_rss_mb=peak_rss_mb,
        doc_scores=doc_scores,
    )
