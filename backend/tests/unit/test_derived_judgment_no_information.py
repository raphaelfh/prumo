"""A `no_information` marker on a domain judgment is Unclear, not an absence.

Regression: PROBAST+AI run 21681ee0 in prod had all 16 domain judgments
answered — 10 of them by the AI as `status="not_found"`, which the extraction
pipeline stores as a `no_information` marker. The derivation treated every
marker as "not judged", so all four overalls rendered "—" forever even though
the reviewer had answered everything.

Two instrument rules pull in opposite directions and both must hold:

    "NI que impeça julgar leva a Unclear"                    (§4b, domains)
    "tipos de desempenho não reportados ficam vazios —
     não se julga o que o estudo não fez"                    (§5, D4 types)

So `worst_domain` maps the marker to Unclear while `worst_of` (the D4 type
collapse) excludes it, and a study is never penalised for validation it did
not perform.

The per-function policy assertions live in `test_derived_judgment_service.py`
alongside the functions; this module owns the end-to-end scenarios that only
make sense against the real seeded spec.
"""

from __future__ import annotations

from typing import Any

from app.seed_probast_ai import _PAI_DERIVED_JUDGMENTS as _V2_SPEC
from app.services.derived_judgment_service import compute_derived_judgments, worst_domain

# The v1 PROBAST+AI derivation spec, FROZEN VERBATIM as v1 project clones'
# ``schema_`` rows still carry it in prod (clones copy the spec at clone time
# and are never healed from the global row). The v2 seed rewrite deleted the
# constant from code, but the shape stays live data — these end-to-end
# scenarios are its only real-spec guard. Do not "modernise" this literal.
_V1_DERIVED_JUDGMENTS: list[dict[str, Any]] = [
    {
        "id": "dev_overall_quality",
        "label": "Overall quality (development)",
        "rule": "worst_domain",
        "inputs": [
            {"section": "dev_d1_participants", "field": "quality_concern"},
            {"section": "dev_d2_predictors", "field": "quality_concern"},
            {"section": "dev_d3_outcome", "field": "quality_concern"},
            {"section": "dev_d4_analysis", "field": "quality_concern"},
        ],
    },
    {
        "id": "dev_overall_applicability",
        "label": "Overall applicability (development)",
        "rule": "worst_domain",
        "inputs": [
            {"section": "dev_d1_participants", "field": "applicability_concerns"},
            {"section": "dev_d2_predictors", "field": "applicability_concerns"},
            {"section": "dev_d3_outcome", "field": "applicability_concerns"},
        ],
    },
    {
        "id": "eval_overall_rob",
        "label": "Overall risk of bias (evaluation)",
        "rule": "worst_domain",
        "inputs": [
            {"section": "eval_d1_participants", "field": "risk_of_bias"},
            {"section": "eval_d2_predictors", "field": "risk_of_bias"},
            {"section": "eval_d3_outcome", "field": "risk_of_bias"},
            {
                "collapse": "worst_of",
                "label": "Evaluation D4: Analysis",
                "inputs": [
                    {"section": "eval_d4_analysis_apparent", "field": "risk_of_bias"},
                    {"section": "eval_d4_analysis_internal", "field": "risk_of_bias"},
                    {"section": "eval_d4_analysis_external", "field": "risk_of_bias"},
                ],
            },
        ],
    },
    {
        "id": "eval_overall_applicability",
        "label": "Overall applicability (evaluation)",
        "rule": "worst_domain",
        "inputs": [
            {"section": "eval_d1_participants", "field": "applicability_concerns"},
            {"section": "eval_d2_predictors", "field": "applicability_concerns"},
            {"section": "eval_d3_outcome", "field": "applicability_concerns"},
        ],
    },
]

NI: dict[str, Any] = {"value": None, "absent_reason": "no_information"}

# What `resolve_value` hands the xlsx export for the same stored marker. The
# run view passes the raw envelope above; both must read identically or the
# banner and the workbook disagree about the same run.
NI_RESOLVED = "No information"


def test_both_caller_shapes_agree() -> None:
    """The run view passes raw envelopes, the export passes resolved labels."""
    assert worst_domain(["Low", NI, "Low"]) == worst_domain(["Low", NI_RESOLVED, "Low"])
    assert worst_domain(["Low", NI_RESOLVED, "Low"]) == "Unclear"


def test_d4_collapse_excludes_no_information_as_not_reported() -> None:
    """A performance type the study did not report must not drag the domain
    down — the instrument says not to judge what the study did not do."""
    from app.services.derived_judgment_service import worst_of

    assert worst_of([NI, "Low", NI]) == "Low"
    assert worst_of([NI, NI, NI]) is None
    assert worst_of([NI, "Low", "High"]) == "High"


def _spec_values(**overrides: Any) -> dict[tuple[str, str], Any]:
    """All 16 PROBAST+AI domain judgments, defaulting to Low."""
    values: dict[tuple[str, str], Any] = {}
    for section in ("dev_d1_participants", "dev_d2_predictors", "dev_d3_outcome"):
        values[(section, "quality_concern")] = {"value": "Low"}
        values[(section, "applicability_concerns")] = {"value": "Low"}
    values[("dev_d4_analysis", "quality_concern")] = {"value": "Low"}
    for section in ("eval_d1_participants", "eval_d2_predictors", "eval_d3_outcome"):
        values[(section, "risk_of_bias")] = {"value": "Low"}
        values[(section, "applicability_concerns")] = {"value": "Low"}
    for section in (
        "eval_d4_analysis_apparent",
        "eval_d4_analysis_internal",
        "eval_d4_analysis_external",
    ):
        values[(section, "risk_of_bias")] = {"value": "Low"}
    for key, value in overrides.items():
        section, field = key.rsplit("__", 1)
        values[(section, field)] = value
    return values


def test_only_internal_validation_reported_is_not_penalised() -> None:
    """Through the REAL spec: apparent + external unreported must not push the
    evaluation overall above Low. This is where the two candidate readings of
    the marker diverge, so it is wired end-to-end rather than hand-composed."""
    values = _spec_values(
        eval_d4_analysis_apparent__risk_of_bias=NI,
        eval_d4_analysis_external__risk_of_bias=NI,
    )
    got = {d.id: d.value for d in compute_derived_judgments(_V1_DERIVED_JUDGMENTS, values)}
    assert got["eval_overall_rob"] == "Low"


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
    got = {d.id: d.value for d in compute_derived_judgments(_V1_DERIVED_JUDGMENTS, values)}
    assert got == {
        "dev_overall_quality": "Unclear",
        "dev_overall_applicability": "High",
        "eval_overall_rob": "High",
        "eval_overall_applicability": "High",
    }


# --- v2 end-to-end scenarios against the REAL seeded spec -------------------


def test_v2_internal_only_study_derives_low_from_the_internal_group() -> None:
    """Through the real v2 spec: gate=Y, apparent + external groups entirely
    unreported, internal group fully answered favourably — the eval-D4
    recommendation derives Low from the internal validation alone."""
    values: dict[tuple[str, str], Any] = {
        ("eval_d4_analysis_apparent", "q1_apparent_only_avoided"): {"value": "Y"},
    }
    for q in (
        "q2_reasonable_sample_size",
        "q3_missing_censored_handling",
        "q4_uncorrected_imbalance_evaluation",
        "q5_data_leakage_avoided",
        "q6_resampling_replicates_all_steps",
        "q7_appropriate_performance_measures",
    ):
        values[("eval_d4_analysis_internal", q)] = {"value": "Y"}
    got = {d.id: d.value for d in compute_derived_judgments(_V2_SPEC, values)}
    assert got["eval_d4_rob"] == "Low"


def test_v2_overalls_read_the_stored_judgments_not_the_recommendations() -> None:
    """The assessor's RECORD feeds the overalls: a stored High on the single
    eval-D4 judgment fires the overall even while every recommendation input
    is blank."""
    values: dict[tuple[str, str], Any] = {
        ("eval_d1_participants", "risk_of_bias"): {"value": "Low"},
        ("eval_d2_predictors", "risk_of_bias"): {"value": "Low"},
        ("eval_d3_outcome", "risk_of_bias"): {"value": "Low"},
        ("eval_d4_judgment", "risk_of_bias"): {"value": "High"},
    }
    got = {d.id: d.value for d in compute_derived_judgments(_V2_SPEC, values)}
    assert got["eval_overall_rob"] == "High"
    # The NI-on-a-judgment regression holds on v2 shapes too.
    values[("eval_d4_judgment", "risk_of_bias")] = NI
    got = {d.id: d.value for d in compute_derived_judgments(_V2_SPEC, values)}
    assert got["eval_overall_rob"] == "Unclear"
