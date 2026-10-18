"""Unit tests for the bake-off orchestrator (pure; no real parsers/papers)."""

from __future__ import annotations

import csv
import json
import math
from dataclasses import dataclass, replace
from pathlib import Path

from parsing_bakeoff.manifest import EvalDoc, EvalSet, GoldLabels
from parsing_bakeoff.parsers import ParseRun, StubParser
from parsing_bakeoff.run import (
    format_markdown,
    run_bakeoff,
    run_parser_isolated,
    score_doc,
    write_outputs,
)
from parsing_bakeoff.scoring import Block, Box


def _doc() -> EvalDoc:
    return EvalDoc(
        doc_id="d1",
        pdf_path="d1.pdf",
        source_type="born_digital",
        gold=GoldLabels(
            tables=[["arm", "n"], ["12", "98"]],
            sections=["Methods", "Results"],
            references=["Smith 2021"],
            regions=[Box(0, 0, 10, 10)],
            paragraphs=[_P1, _P2],
        ),
    )


_P1 = "Methods: we enrolled seventy two adults in a randomised trial."
_P2 = "Results: the intervention lowered HbA1c by half a point."


def _metric_run() -> ParseRun:
    """A run with one inversion, one leaked running head and two ZW chars."""
    heights = {1: 800.0, 2: 800.0, 3: 800.0}
    head = [Block(p, "Smith et al.", "paragraph", Box(50, 10, 200, 10)) for p in (1, 2, 3)]
    return ParseRun(
        blocks=[
            *head,
            Block(1, _P2 + "\u200b", "paragraph", Box(50, 300, 200, 40)),
            Block(2, "\u00ad" + _P1, "paragraph", Box(50, 300, 200, 40)),
        ],
        page_heights=heights,
        elapsed_s=1.25,
    )


def test_score_doc_perfect_when_prediction_matches_gold() -> None:
    doc = _doc()
    run = ParseRun(
        pred_regions=[Box(0, 0, 10, 10)],
        pred_cells=["arm", "n", "12", "98"],
        pred_sections=["methods", "results"],
        pred_references=["smith 2021"],
        elapsed_s=1.5,
        est_cost_usd=0.02,
    )
    s = score_doc(doc, run)
    assert math.isclose(s.table_f1, 1.0)
    assert math.isclose(s.bbox_f1, 1.0)
    assert math.isclose(s.section_recall, 1.0)
    assert math.isclose(s.reference_recall, 1.0)
    assert s.error is None


def test_run_bakeoff_with_stub_aggregates() -> None:
    eval_set = EvalSet(name="t", docs=[_doc()])
    stub = StubParser(
        name="perfect",
        preset=ParseRun(
            pred_regions=[Box(0, 0, 10, 10)],
            pred_cells=["arm", "n", "12", "98"],
            pred_sections=["Methods", "Results"],
            pred_references=["Smith 2021"],
            elapsed_s=2.0,
            est_cost_usd=0.05,
        ),
    )
    [report] = run_bakeoff(eval_set, [stub])
    assert report.parser == "perfect"
    assert report.n_docs == 1 and report.n_errors == 0
    assert math.isclose(report.mean_table_f1, 1.0)
    assert math.isclose(report.total_cost_usd, 0.05)


@dataclass
class _Raising:
    name: str = "boom"

    def available(self) -> bool:
        return True

    def parse(self, pdf_path: str) -> ParseRun:  # noqa: ARG002 - matches the parser port
        raise RuntimeError("kaboom")


def test_run_bakeoff_records_parser_exceptions_as_errors() -> None:
    eval_set = EvalSet(name="t", docs=[_doc()])
    [report] = run_bakeoff(eval_set, [_Raising()])
    assert report.n_errors == 1
    assert report.doc_scores[0].error is not None and "kaboom" in report.doc_scores[0].error


def test_format_markdown_ranks_by_table_f1() -> None:
    eval_set = EvalSet(name="t", docs=[_doc()])
    good = StubParser(
        name="good",
        preset=ParseRun(pred_cells=["arm", "n", "12", "98"]),
    )
    poor = StubParser(name="poor", preset=ParseRun(pred_cells=[]))
    reports = run_bakeoff(eval_set, [poor, good])
    md = format_markdown("t", reports)
    assert "| good |" in md and "| poor |" in md
    # 'good' (higher table F1) must appear before 'poor'.
    assert md.index("| good |") < md.index("| poor |")


def test_score_doc_carries_reading_order_chrome_zw_and_timing() -> None:
    s = score_doc(_doc(), _metric_run())
    assert s.column_inversions == 1
    assert s.paragraphs_matched == 2
    assert s.chrome_leakage == 3
    assert s.zw_chars == 2
    assert s.parse_seconds == 1.25


def _reports_with_metrics():
    eval_set = EvalSet(name="t", docs=[_doc(), replace(_doc(), doc_id="d2")])
    [report] = run_bakeoff(eval_set, [StubParser(name="pymupdf", preset=_metric_run())])
    report.peak_rss_mb = 123.4
    return report


def test_markdown_carries_the_new_metric_columns() -> None:
    md = format_markdown("t", [_reports_with_metrics()])
    header = next(line for line in md.splitlines() if line.startswith("| Parser |"))
    for col in (
        "Column inversions",
        "Chrome leakage",
        "ZW chars",
        "p95 parse (s)",
        "Peak RSS (MB)",
    ):
        assert col in header
    row = next(line for line in md.splitlines() if line.startswith("| pymupdf |"))
    assert "| 2 | 6 | 4 | 1.25 | 123.4 |" in row


def test_csv_has_one_row_per_parser_and_paper_with_new_metrics(tmp_path: Path) -> None:
    csv_path, md_path = write_outputs("t", [_reports_with_metrics()], tmp_path)
    rows = list(csv.DictReader(csv_path.open(encoding="utf-8")))
    assert [(r["parser"], r["doc_id"]) for r in rows] == [("pymupdf", "d1"), ("pymupdf", "d2")]
    assert rows[0]["column_inversions"] == "1"
    assert rows[0]["paragraphs_matched"] == "2"
    assert rows[0]["chrome_leakage"] == "3"
    assert rows[0]["zw_chars"] == "2"
    assert rows[0]["parse_seconds"] == "1.250"
    assert md_path.read_text(encoding="utf-8").startswith("# Parsing bake-off")


def test_run_parser_isolated_measures_a_fresh_subprocess(tmp_path: Path) -> None:
    manifest = tmp_path / "manifest.json"
    manifest.write_text(
        json.dumps(
            {
                "name": "t",
                "docs": [
                    {"doc_id": "a", "pdf_path": "a.pdf", "source_type": "born_digital"},
                    {"doc_id": "b", "pdf_path": "b.pdf", "source_type": "born_digital"},
                ],
            }
        ),
        encoding="utf-8",
    )
    report = run_parser_isolated(manifest, "stub", dry_run=True)
    assert report.parser == "stub"
    assert [d.doc_id for d in report.doc_scores] == ["a", "b"]
    assert report.n_errors == 0
    # A python interpreter needs well over 1 MB and well under 64 GB.
    assert report.peak_rss_mb is not None and 1.0 < report.peak_rss_mb < 65536.0
