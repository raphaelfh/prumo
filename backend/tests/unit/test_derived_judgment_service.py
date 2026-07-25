"""The single worst-domain implementation (PROBAST+AI step 4).

Two deliberately different aggregations:
  * worst_of   (collapse across performance types) — LENIENT: ignores
    unjudged members; null only when nothing is judged.
  * worst_domain (across domains) — STRICT: any unjudged domain yields None.
    One does not conclude low risk from an incomplete assessment.
"""

from __future__ import annotations

from typing import Any

import pytest

from app.services.derived_judgment_service import (
    DerivedJudgment,
    compute_derived_judgments,
    derived_spec,
    spec_coordinates,
    worst_domain,
    worst_of,
)

_SPEC: list[dict[str, Any]] = [
    {
        "id": "eval_overall_rob",
        "label": "Overall risk of bias (evaluation)",
        "rule": "worst_domain",
        "inputs": [
            {"section": "eval_d1", "field": "risk_of_bias"},
            {
                "collapse": "worst_of",
                "inputs": [
                    {"section": "eval_d4_a", "field": "risk_of_bias"},
                    {"section": "eval_d4_i", "field": "risk_of_bias"},
                    {"section": "eval_d4_e", "field": "risk_of_bias"},
                ],
            },
        ],
    }
]


@pytest.mark.parametrize(
    ("values", "expected"),
    [
        (["Low", "Low"], "Low"),
        (["Low", "Unclear"], "Unclear"),
        (["Unclear", "High"], "High"),
        (["High", "Low"], "High"),
    ],
)
def test_worst_domain_severity_order(values: list[Any], expected: str) -> None:
    assert worst_domain(values) == expected


@pytest.mark.parametrize("missing", [None, "", "  ", {"value": None}, "Bogus"])
def test_worst_domain_is_strict_about_incompleteness(missing: Any) -> None:
    assert worst_domain(["Low", missing]) is None


def test_worst_domain_of_nothing_is_none() -> None:
    assert worst_domain([]) is None


def test_worst_domain_maps_no_information_to_unclear() -> None:
    """methodology.md §4b: "NI que impeça julgar leva a Unclear" — an explicit
    no-information answer on a domain IS a judgment, not an absence."""
    marker = {"value": None, "absent_reason": "no_information"}
    assert worst_domain(["Low", marker]) == "Unclear"


def test_worst_domain_still_excludes_non_ni_markers() -> None:
    """Only no_information maps to Unclear; a domain cannot be N/A."""
    assert worst_domain(["Low", {"value": None, "absent_reason": "not_applicable"}]) is None


def test_worst_of_is_lenient() -> None:
    """Unreported performance types are ignored, not counted as incomplete."""
    assert worst_of(["Low", None, ""]) == "Low"
    assert worst_of([None, "High", None]) == "High"
    assert worst_of([None, None, None]) is None


def test_worst_of_unwraps_envelopes_and_is_case_insensitive() -> None:
    assert worst_of([{"value": "high"}, {"value": "Low"}]) == "High"


def test_compute_collapses_d4_then_aggregates() -> None:
    values: dict[tuple[str, str], Any] = {
        ("eval_d1", "risk_of_bias"): "Low",
        ("eval_d4_i", "risk_of_bias"): {"value": "High"},
        # apparent + external not reported -> ignored by the collapse
    }
    assert compute_derived_judgments(_SPEC, values) == [
        DerivedJudgment(
            id="eval_overall_rob",
            label="Overall risk of bias (evaluation)",
            value="High",
        )
    ]


def test_compute_returns_none_when_a_domain_is_unjudged() -> None:
    out = compute_derived_judgments(_SPEC, {("eval_d4_i", "risk_of_bias"): "Low"})
    assert out[0].value is None


def test_compute_returns_none_when_no_performance_type_reported() -> None:
    out = compute_derived_judgments(_SPEC, {("eval_d1", "risk_of_bias"): "Low"})
    assert out[0].value is None


def test_unsupported_rule_yields_none_rather_than_a_wrong_value() -> None:
    spec = [
        {
            "id": "x",
            "label": "X",
            "rule": "best_domain",
            "inputs": [{"section": "s", "field": "f"}],
        }
    ]
    assert compute_derived_judgments(spec, {("s", "f"): "Low"})[0].value is None


def test_derived_spec_reads_template_schema() -> None:
    assert derived_spec({"derived_judgments": _SPEC}) == _SPEC
    assert derived_spec({}) == []
    assert derived_spec(None) == []
    assert derived_spec({"derived_judgments": "nonsense"}) == []


def test_spec_coordinates_walks_collapse_groups() -> None:
    assert spec_coordinates(_SPEC) == [
        ("eval_d1", "risk_of_bias"),
        ("eval_d4_a", "risk_of_bias"),
        ("eval_d4_i", "risk_of_bias"),
        ("eval_d4_e", "risk_of_bias"),
    ]
    assert spec_coordinates([]) == []


def test_malformed_spec_entries_are_skipped_not_crashed() -> None:
    """Defensive branches: non-dict entries, missing inputs, bad collapse."""
    malformed: list[Any] = [
        "not-a-dict",
        {"id": "no_inputs", "label": "X"},
        {"id": "bad_collapse", "label": "Y", "inputs": [{"collapse": "worst_of"}]},
    ]
    out = compute_derived_judgments(malformed, {})
    assert [d.id for d in out] == ["bad_collapse"]
    assert out[0].value is None
    assert spec_coordinates(malformed) == []


def test_compute_on_empty_spec_is_empty() -> None:
    assert compute_derived_judgments([], {}) == []
