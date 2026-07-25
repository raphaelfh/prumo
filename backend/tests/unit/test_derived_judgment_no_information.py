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

from app.seed_probast_ai import _PAI_DERIVED_JUDGMENTS
from app.services.derived_judgment_service import compute_derived_judgments, worst_domain

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
    got = {d.id: d.value for d in compute_derived_judgments(_PAI_DERIVED_JUDGMENTS, values)}
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
    got = {d.id: d.value for d in compute_derived_judgments(_PAI_DERIVED_JUDGMENTS, values)}
    assert got == {
        "dev_overall_quality": "Unclear",
        "dev_overall_applicability": "High",
        "eval_overall_rob": "High",
        "eval_overall_applicability": "High",
    }
