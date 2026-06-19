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
* ``aggregate`` — roll per-document scores up to one report per parser.

Text comparisons normalise with Unicode NFKC + whitespace folding +
casefold, matching the anchoring contract (OCR ligatures / smart quotes
must not cause false misses).
"""

from __future__ import annotations

import unicodedata
from collections import Counter
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
    elapsed_s: float = 0.0
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
    doc_scores: list[DocScore] = field(default_factory=list)


def _mean(values: list[float]) -> float:
    return sum(values) / len(values) if values else 0.0


def aggregate(parser: str, doc_scores: list[DocScore]) -> ParserReport:
    """Roll per-document scores into one report. Errored docs are excluded
    from the quality means (you cannot score a parse that failed) but are
    counted in ``n_errors`` and still contribute their cost/latency."""
    ok = [d for d in doc_scores if d.error is None]
    return ParserReport(
        parser=parser,
        n_docs=len(doc_scores),
        n_errors=sum(1 for d in doc_scores if d.error is not None),
        mean_table_f1=_mean([d.table_f1 for d in ok]),
        mean_bbox_f1=_mean([d.bbox_f1 for d in ok if d.bbox_scored]),
        mean_section_recall=_mean([d.section_recall for d in ok]),
        mean_reference_recall=_mean([d.reference_recall for d in ok]),
        mean_latency_s=_mean([d.elapsed_s for d in doc_scores]),
        total_cost_usd=sum(d.est_cost_usd for d in doc_scores),
        doc_scores=doc_scores,
    )
