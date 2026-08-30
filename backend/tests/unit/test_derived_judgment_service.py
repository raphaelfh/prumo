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
    _signaling_contribution,
    compute_derived_judgments,
    coordinate_of,
    derived_spec,
    excluded_field_coordinates,
    is_out_of_scope,
    is_recommendation,
    out_of_scope_sections,
    scope_classifier_coordinate,
    scope_filtered_values,
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


def test_worst_domain_high_propagates_through_missing() -> None:
    """Official step-4 tables (spec 2026-08-22 §1): "at least one domain high
    -> high" does not require the other domains to be rated. The completeness
    gate still holds below High."""
    assert worst_domain(["High", None]) == "High"
    assert worst_domain(["High", "", {"value": None}]) == "High"
    assert worst_domain(["Unclear", None]) is None


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
        DerivedInput(sections=("s",), label="", value="PN", contribution="High", field="q1"),
        DerivedInput(
            sections=("s",), label="", value="No information", contribution="Unclear", field="q2"
        ),
        DerivedInput(sections=("s",), label="", value=None, contribution=None, field="q3"),
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
            sections=("d4_a", "d4_a"),
            label="Apparent performance",
            value=None,
            contribution=None,
            state="unreported",
        ),
        DerivedInput(
            sections=("d4_i", "d4_i"),
            label="Internal validation",
            value=None,
            contribution="High",
            state=None,
        ),
    ]


def test_signaling_group_row_separates_unreported_from_in_progress() -> None:
    """The two contribute-nothing groups must not look alike to a client.

    Both aggregate to no contribution, but they mean opposite things: the
    apparent group is a performance type the study never reported (not a gap
    in the assessment), while the internal group is half-answered (a gap).
    Rendering them identically tells a reviewer a finished assessment is
    unfinished — the failure this row's ``state`` exists to prevent.
    """
    out = compute_derived_judgments(
        _D4_SPEC,
        {
            ("d4_a", "q1_gate"): "Y",
            # apparent: nothing answered at all -> the study did not report it
            ("d4_i", "q2"): "Y",
            # internal: q3 still unanswered -> the assessment is unfinished
        },
    )
    group_rows = [i for i in out[0].inputs if i.label]
    assert [(r.label, r.contribution, r.state) for r in group_rows] == [
        ("Apparent performance", None, "unreported"),
        ("Internal validation", None, "in-progress"),
    ]


def test_signaling_group_row_state_is_empty_when_the_group_contributed() -> None:
    """``contribution`` and ``state`` are complementary — never both set."""
    out = compute_derived_judgments(
        _D4_SPEC,
        {
            ("d4_a", "q1_gate"): "Y",
            ("d4_a", "q2"): "Y",
            ("d4_a", "q3"): "PY",
            ("d4_i", "q2"): "Y",
            ("d4_i", "q3"): "unclear",
        },
    )
    group_rows = [i for i in out[0].inputs if i.label]
    assert [(r.contribution, r.state) for r in group_rows] == [("Low", None), ("Unclear", None)]


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


def test_excluded_field_coordinates_unions_the_assessor_pointers() -> None:
    """§3: the LLM exclusion set is the union of every entry's target /
    rationale / summary coordinates — declared data, no name conventions."""
    spec = [
        {
            "id": "dev_d1_quality",
            "rule": "signaling_worst",
            "target": {"section": "dev_d1", "field": "quality_concern"},
            "rationale": {"section": "dev_d1", "field": "quality_concern_rationale"},
            "inputs": [{"section": "dev_d1", "field": "q1"}],
        },
        {
            "id": "dev_overall_quality",
            "rule": "worst_domain",
            "summary": {"section": "overall_judgement", "field": "summary_quality_development"},
            "inputs": [{"section": "dev_d1", "field": "quality_concern"}],
        },
    ]
    assert excluded_field_coordinates(spec) == {
        ("dev_d1", "quality_concern"),
        ("dev_d1", "quality_concern_rationale"),
        ("overall_judgement", "summary_quality_development"),
    }
    assert excluded_field_coordinates([]) == set()
    assert excluded_field_coordinates(None) == set()
    assert excluded_field_coordinates(_SPEC) == set()  # v1-shaped: no pointers


# --------------------------------------------------------------------------- #
# PROBAST+AI 2.1.0: NI as the fifth signaling ANSWER
# --------------------------------------------------------------------------- #
def test_ni_answer_contributes_unclear_through_both_caller_shapes() -> None:
    """Screen/workbook parity for the instrument's fifth answer.

    The two callers hand this module different shapes: the run view passes the
    raw jsonb envelope, the export passes a value_map ``resolve_value`` has
    already collapsed to a scalar. For a select ANSWER that scalar is the
    option's value ("NI"), so both paths land on ``_SIGNALING_MAP["ni"]`` —
    which is what 2.1.0 adds, and which reads NI as Unclear: the instrument's
    own reading, and the same result the retired marker produced, so nothing
    downstream needs a branch.

    The bare "No information" case is the MARKER's label, which
    ``resolve_value`` emits for a coded ``absent_reason``. It already resolved
    to Unclear before 2.1.0; it is asserted here so the answer and the marker
    are pinned to the same contribution, which is what makes the NI option's
    label safe to share with the marker's.
    """
    assert _signaling_contribution({"value": "NI"}) == "Unclear"
    assert _signaling_contribution("NI") == "Unclear"
    assert _signaling_contribution("No information") == "Unclear"
    # Case-insensitive, like every other answer in the map.
    assert _signaling_contribution({"value": "ni"}) == "Unclear"


def test_ni_answer_drives_the_derived_default_like_any_other_answer() -> None:
    """End to end: an NI answer must make a domain default Unclear rather than
    leave it unjudged — the point of putting it on the scale."""
    spec = [
        {
            "id": "d1",
            "label": "D1",
            "rule": "signaling_worst",
            "target": {"section": "d1", "field": "risk_of_bias"},
            "inputs": [
                {"section": "d1", "field": "q1"},
                {"section": "d1", "field": "q2"},
            ],
        }
    ]
    [derived] = compute_derived_judgments(
        spec, {("d1", "q1"): {"value": "Y"}, ("d1", "q2"): {"value": "NI"}}
    )
    assert derived.value == "Unclear"


# ---------------------------------------------------------------------------
# Scope rules (PROBAST+AI 2.1.0). The classifier's answer takes whole sections
# out of play; the rules never learn about scope — the values simply stop
# reaching them.
# ---------------------------------------------------------------------------

_SCOPE_SCHEMA: dict[str, Any] = {
    "scope_rules": {
        "classifier": {"section": "assessment_scope", "field": "study_type"},
        "excludes": {
            "development_only": ["eval_d1", "eval_d4_a"],
            "evaluation_only": ["dev_d1"],
        },
    }
}

_CLASSIFIER = ("assessment_scope", "study_type")


@pytest.mark.parametrize(
    ("answer", "expected"),
    [
        ("development_only", {"eval_d1", "eval_d4_a"}),
        ("evaluation_only", {"dev_d1"}),
        ("development_and_evaluation", set()),  # named by neither rule
        ("", set()),
        ("  development_only  ", {"eval_d1", "eval_d4_a"}),  # stored padding
    ],
)
def test_out_of_scope_sections_reads_the_classifier(answer: str, expected: set[str]) -> None:
    got = out_of_scope_sections(_SCOPE_SCHEMA, {_CLASSIFIER: answer})
    assert got == expected


def test_out_of_scope_sections_accepts_both_caller_shapes() -> None:
    """The run view passes the raw envelope, the export a resolved label."""
    envelope = {"value": "development_only", "absent_reason": None}
    assert out_of_scope_sections(_SCOPE_SCHEMA, {_CLASSIFIER: envelope}) == {
        "eval_d1",
        "eval_d4_a",
    }


@pytest.mark.parametrize(
    "raw",
    [
        None,
        {"value": None, "absent_reason": "not_applicable"},
        {"value": None, "absent_reason": "no_information"},
        "No information",  # the export's already-resolved label
    ],
)
def test_out_of_scope_sections_fails_open_when_unclassified(raw: Any) -> None:
    """Unanswered, or answered with a marker, excludes nothing.

    "The article does not say" is not a classification, so the run keeps
    assessing the whole instrument — the pre-2.1.0 behaviour.
    """
    values = {} if raw is None else {_CLASSIFIER: raw}
    assert out_of_scope_sections(_SCOPE_SCHEMA, values) == frozenset()


@pytest.mark.parametrize(
    "schema",
    [None, {}, {"derived_judgments": []}, {"scope_rules": "nonsense"}, {"scope_rules": {}}],
)
def test_out_of_scope_sections_is_empty_without_rules(schema: Any) -> None:
    """A template with no rules must behave exactly as it did before 2.1.0."""
    assert scope_classifier_coordinate(schema) is None
    assert out_of_scope_sections(schema, {_CLASSIFIER: "development_only"}) == frozenset()


def test_scope_filtered_values_drops_only_the_excluded_sections() -> None:
    values: dict[tuple[str, str], Any] = {
        ("dev_d1", "rob"): "Low",
        ("eval_d1", "rob"): "High",
        _CLASSIFIER: "development_only",
    }
    kept = scope_filtered_values(values, {"eval_d1"})
    assert kept == {("dev_d1", "rob"): "Low", _CLASSIFIER: "development_only"}
    # The caller's mapping is never mutated — stored values still exist.
    assert ("eval_d1", "rob") in values


def test_scope_filtered_values_is_identity_when_nothing_is_excluded() -> None:
    values: dict[tuple[str, str], Any] = {("dev_d1", "rob"): "Low"}
    assert scope_filtered_values(values, frozenset()) == values


def test_the_leak_the_filter_exists_to_close() -> None:
    """Fill the evaluation part, THEN classify development_only.

    Without the filter the stored High leaks into the evaluation overall and
    the banner shows a verdict for a part the UI calls "Not applicable".
    """
    spec = [
        {
            "id": "eval_overall_rob",
            "label": "Evaluation overall",
            "rule": "worst_domain",
            "inputs": [{"section": "eval_d1", "field": "rob"}],
        }
    ]
    values: dict[tuple[str, str], Any] = {
        ("eval_d1", "rob"): "High",
        _CLASSIFIER: "development_only",
    }
    leaked = compute_derived_judgments(spec, values)
    assert leaked[0].value == "High", "precondition: unfiltered values do leak"

    excluded = out_of_scope_sections(_SCOPE_SCHEMA, values)
    filtered = compute_derived_judgments(spec, scope_filtered_values(values, excluded))
    assert filtered[0].value is None
    assert is_out_of_scope(filtered[0].inputs[0], excluded)


def test_is_out_of_scope_never_stamps_a_sectionless_row() -> None:
    """A malformed spec item resolves to no sections; ``all(())`` is True."""
    assert is_out_of_scope(DerivedInput(sections=(), label="x", value=None), {"eval_d1"}) is False
    assert (
        is_out_of_scope(DerivedInput(sections=("eval_d1",), label="x", value=None), {"eval_d1"})
        is True
    )
    assert (
        is_out_of_scope(
            DerivedInput(sections=("eval_d1", "dev_d1"), label="x", value=None), {"eval_d1"}
        )
        is False
    ), "a collapse group straddling scope is not out of scope"


def test_coordinate_of_reads_missing_keys_as_empty() -> None:
    assert coordinate_of({"section": "s", "field": "f"}) == ("s", "f")
    assert coordinate_of({}) == ("", "")
