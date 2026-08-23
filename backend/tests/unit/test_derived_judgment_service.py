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
    DerivedInput,
    DerivedJudgment,
    compute_derived_judgments,
    derived_spec,
    is_recommendation,
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
            # The per-domain breakdown the client explains the result from: the
            # collapse group reports its collapsed judgment and carries EVERY
            # section behind it, so a caller can name the group from what they
            # share rather than after whichever one happens to come first.
            inputs=(
                DerivedInput(sections=("eval_d1",), label="", value="Low", contribution="Low"),
                DerivedInput(
                    sections=("eval_d4_a", "eval_d4_i", "eval_d4_e"),
                    label="",
                    value="High",
                    contribution="High",
                ),
            ),
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


# ---------------------------------------------------------------------------
# signaling_worst — the derived DEFAULT computed from signaling questions
# (spec 2026-08-22 §1). Y/PY -> Low, PN/N -> High, unclear (QUADAS-2) ->
# Unclear, NI marker -> Unclear, other markers excluded, unanswered or
# out-of-vocabulary -> missing (never a silent Low).
# ---------------------------------------------------------------------------

_NI = {"value": None, "absent_reason": "no_information"}
_NA = {"value": None, "absent_reason": "not_applicable"}


def _sig_spec(n_inputs: int) -> list[dict[str, Any]]:
    """A recommendation entry with *n_inputs* plain inputs q1..qN in section s."""
    return [
        {
            "id": "dev_d1_quality",
            "label": "Development D1: quality",
            "rule": "signaling_worst",
            "target": {"section": "s", "field": "quality_concern"},
            "rationale": {"section": "s", "field": "quality_concern_rationale"},
            "inputs": [{"section": "s", "field": f"q{i}"} for i in range(1, n_inputs + 1)],
        }
    ]


def _sig_value(values: dict[str, Any], n_inputs: int | None = None) -> str | None:
    n = n_inputs if n_inputs is not None else len(values)
    out = compute_derived_judgments(_sig_spec(n), {("s", k): v for k, v in values.items()})
    return out[0].value


@pytest.mark.parametrize(
    ("answer", "expected"),
    [
        ("Y", "Low"),
        ("py", "Low"),
        ("PN", "High"),
        ("n", "High"),
        ("Unclear", "Unclear"),  # QUADAS-2 vocabulary, adoptable per §11
        (_NI, "Unclear"),
    ],
)
def test_signaling_answer_mapping(answer: Any, expected: str) -> None:
    assert _sig_value({"q1": answer}) == expected


def test_signaling_accepts_both_caller_shapes() -> None:
    """Raw envelope (run view) and resolved display label (export) agree."""
    assert _sig_value({"q1": {"value": "pn"}}) == "High"
    assert _sig_value({"q1": "No information"}) == "Unclear"
    assert _sig_value({"q1": "Not applicable"}) is None  # excluded, nothing judged


def test_signaling_excluded_markers_drop_out() -> None:
    assert _sig_value({"q1": _NA, "q2": "Y"}) == "Low"
    assert _sig_value({"q1": _NA}) is None  # all excluded -> nothing judged


def test_signaling_out_of_vocabulary_is_missing_never_low() -> None:
    assert _sig_value({"q1": "maybe"}) is None
    assert _sig_value({"q1": "maybe", "q2": "Y"}, n_inputs=2) is None


def test_signaling_unanswered_gates_low_and_unclear() -> None:
    # q2 exists in the spec but has no stored value.
    assert _sig_value({"q1": "Y"}, n_inputs=2) is None
    assert _sig_value({"q1": "Unclear"}, n_inputs=2) is None


def test_signaling_high_propagates_through_missing() -> None:
    """High is monotone: one flagged N fires the default with q2 unanswered."""
    assert _sig_value({"q1": "N"}, n_inputs=2) == "High"


def test_signaling_all_low_is_low_and_unclear_wins_over_low() -> None:
    assert _sig_value({"q1": "Y", "q2": "PY"}) == "Low"
    assert _sig_value({"q1": "Y", "q2": _NI}) == "Unclear"


def test_signaling_breakdown_carries_raw_answers() -> None:
    out = compute_derived_judgments(
        _sig_spec(3),
        {("s", "q1"): {"value": "PN"}, ("s", "q2"): _NI},
        # q3 unanswered
    )
    assert out[0].inputs == (
        DerivedInput(sections=("s",), label="", value="PN", contribution="High"),
        DerivedInput(sections=("s",), label="", value="No information", contribution="Unclear"),
        DerivedInput(sections=("s",), label="", value=None, contribution=None),
    )


# --- collapse groups (eval D4 per-type sections) -------------------------

_D4_SPEC: list[dict[str, Any]] = [
    {
        "id": "eval_d4_rob",
        "label": "Evaluation D4: Analysis",
        "rule": "signaling_worst",
        "target": {"section": "eval_d4_judgment", "field": "risk_of_bias"},
        "rationale": {"section": "eval_d4_judgment", "field": "risk_of_bias_rationale"},
        "inputs": [
            {"section": "d4_a", "field": "q1_gate"},
            {
                "collapse": "worst_of",
                "label": "Apparent performance",
                "inputs": [
                    {"section": "d4_a", "field": "q2"},
                    {"section": "d4_a", "field": "q3"},
                ],
            },
            {
                "collapse": "worst_of",
                "label": "Internal validation",
                "inputs": [
                    {"section": "d4_i", "field": "q2"},
                    {"section": "d4_i", "field": "q3"},
                ],
            },
        ],
    }
]


def _d4_value(values: dict[tuple[str, str], Any]) -> str | None:
    return compute_derived_judgments(_D4_SPEC, values)[0].value


def test_signaling_unreported_group_is_ignored() -> None:
    """A study is not marked down for a validation type it never claimed."""
    assert (
        _d4_value(
            {
                ("d4_a", "q1_gate"): "Y",
                ("d4_i", "q2"): "Y",
                ("d4_i", "q3"): "PY",
                # apparent group entirely unanswered -> unreported -> ignored
            }
        )
        == "Low"
    )


def test_signaling_group_member_high_fires_group() -> None:
    assert (
        _d4_value(
            {
                ("d4_a", "q1_gate"): "Y",
                ("d4_i", "q2"): "N",
                # q3 unanswered; High propagates inside the group too
            }
        )
        == "High"
    )


def test_signaling_partially_answered_group_is_in_progress() -> None:
    assert (
        _d4_value(
            {
                ("d4_a", "q1_gate"): "Y",
                ("d4_i", "q2"): "Y",
                # d4_i q3 unanswered: group judged-in-part -> in-progress -> null
            }
        )
        is None
    )


def test_signaling_gate_is_a_plain_input() -> None:
    """gate=N fires High immediately, groups unreported or not."""
    assert _d4_value({("d4_a", "q1_gate"): "N"}) == "High"


def test_signaling_group_breakdown_row() -> None:
    out = compute_derived_judgments(
        _D4_SPEC,
        {
            ("d4_a", "q1_gate"): "Y",
            ("d4_i", "q2"): "N",
        },
    )
    group_rows = [i for i in out[0].inputs if i.label]
    assert group_rows == [
        DerivedInput(
            sections=("d4_a", "d4_a"), label="Apparent performance", value=None, contribution=None
        ),
        DerivedInput(
            sections=("d4_i", "d4_i"), label="Internal validation", value=None, contribution="High"
        ),
    ]


# --- spec-shape helpers ---------------------------------------------------


def test_spec_coordinates_walks_target_rationale_summary() -> None:
    spec = [
        {
            "id": "r",
            "rule": "signaling_worst",
            "target": {"section": "s", "field": "judgment"},
            "rationale": {"section": "s", "field": "judgment_rationale"},
            "inputs": [{"section": "s", "field": "q1"}],
        },
        {
            "id": "o",
            "rule": "worst_domain",
            "summary": {"section": "overall", "field": "summary_dev"},
            "inputs": [{"section": "s", "field": "judgment"}],
        },
    ]
    assert spec_coordinates(spec) == [
        ("s", "q1"),
        ("s", "judgment"),
        ("s", "judgment_rationale"),
        ("s", "judgment"),
        ("overall", "summary_dev"),
    ]


def test_is_recommendation_discriminates_on_target() -> None:
    assert is_recommendation({"target": {"section": "s", "field": "f"}})
    assert not is_recommendation({"summary": {"section": "s", "field": "f"}})
    assert not is_recommendation({})
