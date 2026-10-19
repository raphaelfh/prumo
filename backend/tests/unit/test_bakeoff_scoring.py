"""Unit tests for the parsing bake-off scoring core (pure, no deps)."""

from __future__ import annotations

import math

from parsing_bakeoff.scoring import (
    Block,
    Box,
    DocScore,
    aggregate,
    box_iou,
    cell_set_f1,
    chrome_leakage,
    column_inversions,
    match_boxes,
    maxrss_to_mb,
    normalize_text,
    order_breaks,
    p95,
    recall_set,
    zw_char_count,
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
                "a",
                table_f1=1.0,
                bbox_f1=0.8,
                bbox_scored=True,
                parse_seconds=1.0,
                est_cost_usd=0.01,
            ),
            DocScore(
                "b",
                table_f1=0.0,
                bbox_f1=0.0,
                parse_seconds=2.0,
                est_cost_usd=0.02,
                error="OCR failed",
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


# ---------------------------------------------------------------------------
# Reading-order, chrome, invisible-character and resource metrics
# ---------------------------------------------------------------------------

_PARAS = [
    "Background: obesity is a growing burden in adults worldwide.",
    "Methods: we enrolled seventy two adults in a randomised trial.",
    "Results: the intervention lowered HbA1c by half a point.",
    "Conclusions: game based education improves glycaemic control.",
]


def _body(page: int, text: str, y: float = 300.0, block_type: str = "paragraph") -> Block:
    return Block(page=page, text=text, block_type=block_type, box=Box(50, y, 200, 40))


class TestColumnInversions:
    def test_gold_order_has_no_inversions(self) -> None:
        blocks = [_body(1, p) for p in _PARAS]
        assert column_inversions(blocks, _PARAS) == (0, 4)

    def test_counts_pairwise_inversions_of_gold_indexes(self) -> None:
        # Reading order 2, 0, 3, 1 -> inverted pairs (2,0) (2,1) (3,1) = 3.
        order = [2, 0, 3, 1]
        blocks = [_body(1, _PARAS[i]) for i in order]
        assert column_inversions(blocks, _PARAS) == (3, 4)

    def test_matches_by_normalized_prefix_ignoring_hyphen_breaks_and_case(self) -> None:
        # A parser block that splits a word at a line-break hyphen and adds
        # trailing text still matches its gold paragraph by prefix.
        blocks = [
            _body(1, "RESULTS: the inter-\nvention lowered HbA1c by half a point. Table 2 shows"),
            _body(1, _PARAS[0]),
        ]
        assert column_inversions(blocks, _PARAS) == (1, 2)

    def test_skips_chrome_tables_and_continuation_blocks(self) -> None:
        blocks = [
            _body(1, _PARAS[3], block_type="header"),
            _body(1, _PARAS[2], block_type="table_cell"),
            _body(1, "lowered HbA1c by half a point, a continuation"),
            _body(1, _PARAS[1]),
            _body(2, _PARAS[0]),
        ]
        assert column_inversions(blocks, _PARAS) == (1, 2)

    def test_each_gold_paragraph_counts_once(self) -> None:
        blocks = [_body(1, _PARAS[1]), _body(1, _PARAS[0]), _body(2, _PARAS[1])]
        assert column_inversions(blocks, _PARAS) == (1, 2)

    def test_no_gold_paragraphs_is_zero(self) -> None:
        assert column_inversions([_body(1, _PARAS[0])], []) == (0, 0)


class TestOrderBreaks:
    def test_counts_adjacent_descents(self) -> None:
        # Reading order 2, 0, 3, 1 -> descents 2>0 and 3>1.
        blocks = [_body(1, _PARAS[i]) for i in [2, 0, 3, 1]]
        assert order_breaks(blocks, _PARAS) == 2

    def test_one_displaced_paragraph_is_one_break_but_many_inversions(self) -> None:
        blocks = [_body(1, _PARAS[i]) for i in [1, 2, 3, 0]]
        assert order_breaks(blocks, _PARAS) == 1
        assert column_inversions(blocks, _PARAS) == (3, 4)


class TestChromeLeakage:
    _HEIGHTS = dict.fromkeys(range(1, 5), 800.0)

    def test_running_head_typed_paragraph_on_three_pages_leaks(self) -> None:
        blocks = [
            Block(p, f"J Clin Med 2024; {p}", "paragraph", Box(50, 20, 300, 10))
            for p in range(1, 4)
        ]
        blocks.append(_body(1, "Body text that appears once."))
        assert chrome_leakage(blocks, self._HEIGHTS) == 3

    def test_typed_chrome_does_not_leak_but_counts_toward_repeats(self) -> None:
        blocks = [
            Block(1, "Smith et al.", "header", Box(50, 20, 300, 10)),
            Block(2, "Smith et al.", "header", Box(50, 20, 300, 10)),
            Block(3, "Smith et al.", "paragraph", Box(50, 20, 300, 10)),
        ]
        assert chrome_leakage(blocks, self._HEIGHTS) == 1

    def test_bottom_band_footer_typed_paragraph_leaks(self) -> None:
        blocks = [Block(p, f"Page {p}", "paragraph", Box(280, 780, 40, 10)) for p in range(1, 5)]
        assert chrome_leakage(blocks, self._HEIGHTS) == 4

    def test_repeats_on_two_pages_or_outside_band_do_not_leak(self) -> None:
        blocks = [
            Block(1, "Smith et al.", "paragraph", Box(50, 20, 300, 10)),
            Block(2, "Smith et al.", "paragraph", Box(50, 20, 300, 10)),
            Block(1, "Mid page", "paragraph", Box(50, 300, 300, 10)),
            Block(2, "Mid page", "paragraph", Box(50, 300, 300, 10)),
            Block(3, "Mid page", "paragraph", Box(50, 300, 300, 10)),
        ]
        assert chrome_leakage(blocks, self._HEIGHTS) == 0

    def test_tables_figures_and_numbered_captions_never_leak(self) -> None:
        blocks = []
        for p in range(1, 4):
            blocks.append(Block(p, "n", "table_cell", Box(50, 20, 30, 10)))
            blocks.append(Block(p, "Table 1 Baseline", "figure_caption", Box(50, 20, 300, 10)))
        assert chrome_leakage(blocks, self._HEIGHTS) == 0


def test_zw_char_count_counts_every_invisible_code_point() -> None:
    blocks = [
        _body(1, "doi:\u200b10.1/x\u00ad"),
        _body(1, "\ufeffword\u2060joiner\u200c\u200d"),
        _body(2, "clean"),
    ]
    assert zw_char_count(blocks) == 6


class TestP95:
    def test_nearest_rank_over_twenty_timings(self) -> None:
        assert p95([float(v) for v in range(20, 0, -1)]) == 19.0

    def test_single_value_and_empty(self) -> None:
        assert p95([3.5]) == 3.5
        assert p95([]) == 0.0


def test_maxrss_to_mb_normalizes_macos_bytes_and_linux_kib() -> None:
    assert maxrss_to_mb(512 * 1024 * 1024, "darwin") == 512.0
    assert maxrss_to_mb(512 * 1024, "linux") == 512.0


def test_aggregate_rolls_up_new_metrics() -> None:
    scores = [
        DocScore(f"d{i}", parse_seconds=float(i), column_inversions=i, chrome_leakage=1, zw_chars=2)
        for i in range(1, 21)
    ]
    scores.append(DocScore("bad", parse_seconds=100.0, error="boom", zw_chars=50))
    report = aggregate("pymupdf", scores, peak_rss_mb=321.5)
    assert report.total_column_inversions == sum(range(1, 21))
    assert report.total_chrome_leakage == 20
    assert report.total_zw_chars == 40
    # Timing includes the errored doc (compute was still spent): 21 values.
    assert report.p95_parse_seconds == 20.0
    assert report.peak_rss_mb == 321.5
