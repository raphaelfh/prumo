"""Unit tests for the bake-off orchestrator (pure; no real parsers/papers)."""

from __future__ import annotations

import math
from dataclasses import dataclass

from parsing_bakeoff.manifest import EvalDoc, EvalSet, GoldLabels
from parsing_bakeoff.parsers import ParseRun, StubParser
from parsing_bakeoff.run import format_markdown, run_bakeoff, score_doc
from parsing_bakeoff.scoring import Box


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
        ),
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
