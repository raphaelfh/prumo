"""A `no_information` marker on a domain judgment is Unclear, not an absence.

Regression: PROBAST+AI run 21681ee0 in prod had all 16 domain judgments
answered — 10 of them by the AI as `status="not_found"`, which the extraction
pipeline stores as a `no_information` marker. The derivation treated every
marker as "not judged", so all four overalls rendered "—" forever even though
the reviewer had answered everything.

The instrument is explicit (methodology.md §4b):

    "NI que impeça julgar leva a Unclear"

An NI that prevents judging IS a judgment of Unclear. But the same doc is
equally explicit that an unreported evaluation-D4 performance type is NOT
judged at all:

    "tipos de desempenho não reportados ficam vazios —
     não se julga o que o estudo não fez"

So the two aggregations treat the marker differently on purpose:
  * worst_domain (across domains)   -> no_information means Unclear
  * worst_of     (D4 type collapse) -> no_information means "not reported",
                                       excluded, so a study is never penalised
                                       for validation it did not perform.
"""

from __future__ import annotations

from typing import Any

from app.seed_probast_ai import _PAI_DERIVED_JUDGMENTS
from app.services.derived_judgment_service import (
    compute_derived_judgments,
    worst_domain,
    worst_of,
)

NI: dict[str, Any] = {"value": None, "absent_reason": "no_information"}
NA: dict[str, Any] = {"value": None, "absent_reason": "not_applicable"}


def test_no_information_on_a_domain_is_unclear_not_absent() -> None:
    assert worst_domain(["Low", NI, "Low"]) == "Unclear"
    assert worst_domain([NI, NI, NI]) == "Unclear"
    # High still dominates Unclear.
    assert worst_domain(["Low", NI, "High"]) == "High"


def test_a_genuinely_missing_domain_is_still_incomplete() -> None:
    """The strict-incompleteness guarantee must survive: an unanswered domain
    is None, so an overall is never concluded from a partial assessment."""
    assert worst_domain(["Low", None, "Low"]) is None
    assert worst_domain(["Low", "", "Low"]) is None


def test_not_applicable_on_a_domain_is_not_a_judgment() -> None:
    """Only no_information maps to Unclear. A domain cannot legitimately be
    not-applicable in PROBAST+AI, so it stays an absence."""
    assert worst_domain(["Low", NA, "Low"]) is None


def test_d4_collapse_excludes_no_information_as_not_reported() -> None:
    """A performance type the study did not report must not drag the domain
    down — the instrument says not to judge what the study did not do."""
    assert worst_of([NI, "Low", NI]) == "Low"
    assert worst_of(["Low", NI, NI]) == "Low"
    assert worst_of([NI, NI, NI]) is None
    # A real judgment still wins.
    assert worst_of([NI, "Low", "High"]) == "High"


def test_only_internal_validation_reported_is_not_penalised() -> None:
    """The case where the two readings diverge: all domains Low, only internal
    validation reported, apparent/external marked no-information. Must be Low,
    not Unclear."""
    collapse = worst_of([NI, "Low", NI])
    assert worst_domain(["Low", "Low", "Low", collapse]) == "Low"


def test_prod_run_21681ee0_now_computes() -> None:
    """The exact values read from prod for the run that reported the bug."""
    values: dict[tuple[str, str], Any] = {
        ("dev_d1_participants", "quality_concern"): NI,
        ("dev_d2_predictors", "quality_concern"): NI,
        ("dev_d3_outcome", "quality_concern"): NI,
        ("dev_d4_analysis", "quality_concern"): NI,
        ("dev_d1_participants", "applicability_concerns"): NI,
        ("dev_d2_predictors", "applicability_concerns"): {"value": "High"},
        ("dev_d3_outcome", "applicability_concerns"): NI,
        ("eval_d1_participants", "risk_of_bias"): {"value": "Low"},
        ("eval_d2_predictors", "risk_of_bias"): NI,
        ("eval_d3_outcome", "risk_of_bias"): {"value": "High"},
        ("eval_d4_analysis_apparent", "risk_of_bias"): {"value": "Low"},
        ("eval_d4_analysis_internal", "risk_of_bias"): NI,
        ("eval_d4_analysis_external", "risk_of_bias"): NI,
        ("eval_d1_participants", "applicability_concerns"): {"value": "Low"},
        ("eval_d2_predictors", "applicability_concerns"): NI,
        ("eval_d3_outcome", "applicability_concerns"): {"value": "High"},
    }
    got = {d.id: d.value for d in compute_derived_judgments(_PAI_DERIVED_JUDGMENTS, values)}
    assert got == {
        "dev_overall_quality": "Unclear",
        "dev_overall_applicability": "High",
        "eval_overall_rob": "High",
        "eval_overall_applicability": "High",
    }
