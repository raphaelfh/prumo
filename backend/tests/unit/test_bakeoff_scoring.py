"""Unit tests for the parsing bake-off scoring core (pure, no deps)."""

from __future__ import annotations

import math

from parsing_bakeoff.scoring import (
    Box,
    DocScore,
    aggregate,
    box_iou,
    cell_set_f1,
    match_boxes,
    normalize_text,
    recall_set,
)


def _close(a: float, b: float, tol: float = 1e-9) -> bool:
    return math.isclose(a, b, abs_tol=tol)


class TestNormalizeText:
    def test_collapses_whitespace_and_casefolds(self) -> None:
        assert normalize_text("  Hello\n\tWORLD  ") == "hello world"

    def test_nfkc_folds_ligatures(self) -> None:
        # U+FB01 LATIN SMALL LIGATURE FI → "fi"
        assert normalize_text("ﬁnding") == "finding"


class TestBoxIou:
    def test_identical_boxes_iou_one(self) -> None:
        b = Box(0, 0, 10, 10)
        assert _close(box_iou(b, b), 1.0)

    def test_disjoint_boxes_iou_zero(self) -> None:
        assert box_iou(Box(0, 0, 10, 10), Box(100, 100, 10, 10)) == 0.0

    def test_half_overlap(self) -> None:
        # Two 10x10 boxes overlapping in a 5x10 strip: inter=50, union=150.
        assert _close(box_iou(Box(0, 0, 10, 10), Box(5, 0, 10, 10)), 50 / 150)


class TestMatchBoxes:
    def test_perfect_match(self) -> None:
        boxes = [Box(0, 0, 10, 10), Box(20, 20, 10, 10)]
        prf = match_boxes(boxes, boxes)
        assert (prf.precision, prf.recall, prf.f1) == (1.0, 1.0, 1.0)

    def test_extra_prediction_lowers_precision(self) -> None:
        gold = [Box(0, 0, 10, 10)]
        pred = [Box(0, 0, 10, 10), Box(50, 50, 10, 10)]
        prf = match_boxes(pred, gold)
        assert _close(prf.precision, 0.5)
        assert _close(prf.recall, 1.0)

    def test_below_threshold_is_not_a_match(self) -> None:
        # ~9% IoU, below the 0.5 default.
        prf = match_boxes([Box(9, 0, 10, 10)], [Box(0, 0, 10, 10)])
        assert prf.recall == 0.0

    def test_both_empty_is_perfect(self) -> None:
        assert match_boxes([], []).f1 == 1.0


class TestCellSetF1:
    def test_normalisation_makes_cells_match(self) -> None:
        prf = cell_set_f1(["  12.5 ", "ﬁnding"], ["12.5", "finding"])
        assert _close(prf.f1, 1.0)

    def test_multiset_counts_repeats(self) -> None:
        # gold has the value twice; predicting it once → recall 0.5.
        prf = cell_set_f1(["n/a"], ["n/a", "n/a"])
        assert _close(prf.recall, 0.5)


class TestRecallSet:
    def test_partial_section_recovery(self) -> None:
        pred = ["Methods", "Results"]
        gold = ["methods", "results", "Discussion"]
        assert _close(recall_set(pred, gold), 2 / 3)

    def test_empty_gold_is_one(self) -> None:
        assert recall_set([], []) == 1.0


class TestAggregate:
    def test_excludes_errored_docs_from_quality_means_but_counts_them(self) -> None:
        scores = [
            DocScore(
                "a", table_f1=1.0, bbox_f1=0.8, bbox_scored=True, elapsed_s=1.0, est_cost_usd=0.01
            ),
            DocScore(
                "b", table_f1=0.0, bbox_f1=0.0, elapsed_s=2.0, est_cost_usd=0.02, error="OCR failed"
            ),
        ]
        report = aggregate("docling", scores)
        assert report.n_docs == 2
        assert report.n_errors == 1
        # Only the successful doc counts toward quality means.
        assert _close(report.mean_table_f1, 1.0)
        assert _close(report.mean_bbox_f1, 0.8)
        # Cost/latency include the errored doc (compute was still spent).
        assert _close(report.total_cost_usd, 0.03)
        assert _close(report.mean_latency_s, 1.5)
