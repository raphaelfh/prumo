"""Shape of the seeded PROBAST+AI v2 template (no DB — capturing session).

The v2 seed is the instrument-exact 13-section / 95-field form
(spec 2026-08-22 §5; item map in docs/reference/templates/
probast-ai-instrument.md): describes → signaling questions → judgment →
rationale → (applicability describe → applicability → rationale), an
``assessment_scope`` section for Steps 2–3, the four Step-4 summary boxes,
NA restricted to the instrument's four conditional items (6 field rows
after triplication), and a ``derived_judgments`` spec of 8
``signaling_worst`` recommendations + 4 ``worst_domain`` overalls.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

import pytest

from app.models.extraction import (
    ExtractionEntityType,
    ExtractionField,
    ExtractionTemplateGlobal,
)
from app.seed import _PROBAST_JUDGMENT, _PROBAST_SIGNALING
from app.seed_probast_ai import seed_probast_ai
from app.services.derived_judgment_service import is_recommendation, spec_coordinates
from tests.unit.conftest import CapturingSession, ExistingTemplateSession


async def _seed() -> CapturingSession:
    session = CapturingSession()
    await seed_probast_ai(session)
    return session


def _of(session: CapturingSession, cls: type) -> list[Any]:
    return [o for o in session.added if isinstance(o, cls)]


def _fields_by_section(session: CapturingSession) -> dict[str, list[Any]]:
    ets = {et.id: et.name for et in _of(session, ExtractionEntityType)}
    out: dict[str, list[Any]] = {name: [] for name in ets.values()}
    for f in _of(session, ExtractionField):
        out[ets[f.entity_type_id]].append(f)
    for rows in out.values():
        rows.sort(key=lambda f: f.sort_order)
    return out


_EXPECTED_COUNTS: dict[str, int] = {
    "assessment_scope": 3,
    "dev_d1_participants": 9,
    "dev_d2_predictors": 9,
    "dev_d3_outcome": 10,
    "dev_d4_analysis": 11,
    "eval_d1_participants": 9,
    "eval_d2_predictors": 9,
    "eval_d3_outcome": 10,
    "eval_d4_analysis_apparent": 5,
    "eval_d4_analysis_internal": 6,
    "eval_d4_analysis_external": 4,
    "eval_d4_judgment": 6,
    "overall_judgement": 4,
}

# The instrument's four conditional items — six rows after triplication.
_NA_ROWS: set[tuple[str, str]] = {
    ("dev_d4_analysis", "q4_imbalance_recalibration"),
    ("eval_d4_analysis_apparent", "q4_uncorrected_imbalance_evaluation"),
    ("eval_d4_analysis_internal", "q4_uncorrected_imbalance_evaluation"),
    ("eval_d4_analysis_external", "q4_uncorrected_imbalance_evaluation"),
    ("eval_d4_analysis_internal", "q5_data_leakage_avoided"),
    ("eval_d4_analysis_internal", "q6_resampling_replicates_all_steps"),
}


@pytest.mark.asyncio
async def test_template_row() -> None:
    session = await _seed()
    [tpl] = _of(session, ExtractionTemplateGlobal)
    assert tpl.id == UUID("00ba0000-0000-0000-0000-000000000002")
    assert tpl.name == "PROBAST+AI"
    assert tpl.version == "2.0.0"
    assert tpl.kind == "quality_assessment"
    assert tpl.framework == "CUSTOM"


@pytest.mark.asyncio
async def test_thirteen_flat_sections_under_v2_uuids() -> None:
    session = await _seed()
    ets = sorted(_of(session, ExtractionEntityType), key=lambda e: e.sort_order)
    assert [et.name for et in ets] == list(_EXPECTED_COUNTS)
    assert [et.sort_order for et in ets] == list(range(1, 14))
    for et in ets:
        assert et.parent_entity_type_id is None
        assert et.cardinality == "one"
        # v2 entity ids reserve the FINAL uuid group for the version.
        assert str(et.id).endswith("-000000000002"), et.name


@pytest.mark.asyncio
async def test_field_counts_per_section() -> None:
    session = await _seed()
    by_section = _fields_by_section(session)
    assert {k: len(v) for k, v in by_section.items()} == _EXPECTED_COUNTS
    assert sum(_EXPECTED_COUNTS.values()) == 95


@pytest.mark.asyncio
async def test_sort_orders_are_dense_and_unique_per_section() -> None:
    session = await _seed()
    for name, rows in _fields_by_section(session).items():
        assert [f.sort_order for f in rows] == list(range(len(rows))), name


@pytest.mark.asyncio
async def test_na_restricted_to_the_six_conditional_rows() -> None:
    session = await _seed()
    flagged = {
        (sec, f.name)
        for sec, rows in _fields_by_section(session).items()
        for f in rows
        if f.allows_not_applicable
    }
    assert flagged == _NA_ROWS
    # not_evaluated is never seeded on this template.
    assert not any(f.allows_not_evaluated for f in _of(session, ExtractionField))


@pytest.mark.asyncio
async def test_signaling_rows_have_the_matching_answer_instruction() -> None:
    session = await _seed()
    for sec, rows in _fields_by_section(session).items():
        for f in rows:
            if f.allowed_values != _PROBAST_SIGNALING:
                continue
            assert f.llm_description, (sec, f.name)
            if (sec, f.name) in _NA_ROWS:
                assert "not applicable" in f.llm_description, (sec, f.name)
            else:
                assert f.llm_description.endswith(
                    "mark no information when the article is silent."
                ), (sec, f.name)


@pytest.mark.asyncio
async def test_assessor_owned_fields_carry_no_llm_description() -> None:
    """8 judgments + 8 judgment rationales + 4 summaries = 20 AI-excluded rows;
    every other field is AI-proposable and must carry a prompt."""
    session = await _seed()
    silent = {
        (sec, f.name)
        for sec, rows in _fields_by_section(session).items()
        for f in rows
        if not f.llm_description
    }
    judgments = {
        (s, "quality_concern")
        for s in ("dev_d1_participants", "dev_d2_predictors", "dev_d3_outcome", "dev_d4_analysis")
    } | {
        (s, "risk_of_bias")
        for s in (
            "eval_d1_participants",
            "eval_d2_predictors",
            "eval_d3_outcome",
            "eval_d4_judgment",
        )
    }
    rationales = {(s, f"{n}_rationale") for s, n in judgments}
    summaries = {
        ("overall_judgement", n)
        for n in (
            "summary_quality_development",
            "summary_rob_evaluation",
            "summary_applicability_development",
            "summary_applicability_evaluation",
        )
    }
    assert silent == judgments | rationales | summaries
    assert len(silent) == 20


@pytest.mark.asyncio
async def test_optionality() -> None:
    """Free-text boxes (describes, rationales, summaries) are optional; the
    scope select, signaling questions, judgments and applicability stay
    required."""
    session = await _seed()
    for sec, rows in _fields_by_section(session).items():
        for f in rows:
            if f.field_type == "text":
                assert f.is_required is False, (sec, f.name)
            else:
                assert f.is_required is True, (sec, f.name)


@pytest.mark.asyncio
async def test_scope_section_shape() -> None:
    session = await _seed()
    rows = _fields_by_section(session)["assessment_scope"]
    assert [f.name for f in rows] == ["study_type", "models_of_interest", "outcome_of_interest"]
    study_type = rows[0]
    assert study_type.field_type == "select"
    # {value,label} envelopes: spec-pinned machine codes + display labels.
    assert [o["value"] for o in study_type.allowed_values] == [
        "development_only",
        "evaluation_only",
        "combination",
    ]
    assert all(o["label"] for o in study_type.allowed_values)
    assert study_type.is_required is True
    assert study_type.llm_description


@pytest.mark.asyncio
async def test_field_order_mirrors_the_form() -> None:
    """describes → SQs → judgment → rationale → (applicability describe →
    applicability → rationale), per the instrument's page order."""
    session = await _seed()
    rows = _fields_by_section(session)["dev_d1_participants"]
    assert [f.name for f in rows] == [
        "desc_data_sources",
        "q1_appropriate_data_sources",
        "q2_appropriate_study_design",
        "q3_representative_dataset",
        "quality_concern",
        "quality_concern_rationale",
        "desc_setting_dates",
        "applicability_concerns",
        "applicability_concerns_rationale",
    ]
    d4 = _fields_by_section(session)["eval_d4_judgment"]
    assert [f.name for f in d4] == [
        "desc_sample_numbers",
        "desc_performance_measures",
        "desc_excluded_participants",
        "desc_missing_data",
        "risk_of_bias",
        "risk_of_bias_rationale",
    ]


@pytest.mark.asyncio
async def test_judgments_use_the_probast_vocabulary() -> None:
    session = await _seed()
    for sec, rows in _fields_by_section(session).items():
        for f in rows:
            if f.name in ("quality_concern", "risk_of_bias", "applicability_concerns"):
                assert f.allowed_values == _PROBAST_JUDGMENT, (sec, f.name)
                assert not f.allows_not_applicable, (sec, f.name)


@pytest.mark.asyncio
async def test_applicability_is_ai_proposable_with_first_order_prompt() -> None:
    session = await _seed()
    for sec in ("dev_d1_participants", "eval_d3_outcome"):
        rows = {f.name: f for f in _fields_by_section(session)[sec]}
        assert rows["applicability_concerns"].llm_description
        assert "review question" in rows["applicability_concerns"].llm_description
        assert rows["applicability_concerns_rationale"].llm_description


@pytest.mark.asyncio
async def test_derived_spec_shape() -> None:
    session = await _seed()
    [tpl] = _of(session, ExtractionTemplateGlobal)
    spec = tpl.schema_["derived_judgments"]
    assert len(spec) == 12
    recommendations = [e for e in spec if is_recommendation(e)]
    overalls = [e for e in spec if not is_recommendation(e)]
    assert len(recommendations) == 8
    assert len(overalls) == 4
    assert all(e["rule"] == "signaling_worst" for e in recommendations)
    assert all(e["rule"] == "worst_domain" for e in overalls)
    assert all("rationale" in e for e in recommendations)
    assert all("summary" in e for e in overalls)
    # The eval-D4 recommendation: the gate as a PLAIN input + three groups.
    [d4] = [e for e in recommendations if e["id"] == "eval_d4_rob"]
    plain = [i for i in d4["inputs"] if "collapse" not in i]
    groups = [i for i in d4["inputs"] if "collapse" in i]
    assert plain == [{"section": "eval_d4_analysis_apparent", "field": "q1_apparent_only_avoided"}]
    assert [g["label"] for g in groups] == [
        "Apparent performance",
        "Internal validation",
        "External validation",
    ]
    # Pin the group MEMBERSHIP, not just the labels — a member swapped into
    # the wrong performance type would still pass a label/count check while
    # deriving the domain default from the wrong section's answers.
    core = [
        "q2_reasonable_sample_size",
        "q3_missing_censored_handling",
        "q4_uncorrected_imbalance_evaluation",
    ]
    performance = ["q7_appropriate_performance_measures"]
    internal_only = ["q5_data_leakage_avoided", "q6_resampling_replicates_all_steps"]
    expected_members = {
        "Apparent performance": [("eval_d4_analysis_apparent", q) for q in core + performance],
        "Internal validation": [
            ("eval_d4_analysis_internal", q) for q in core + internal_only + performance
        ],
        "External validation": [("eval_d4_analysis_external", q) for q in core + performance],
    }
    for group in groups:
        members = [(i["section"], i["field"]) for i in group["inputs"]]
        assert members == expected_members[group["label"]], group["label"]
    # Overalls read the STORED judgments — no collapse anywhere.
    for e in overalls:
        assert all("collapse" not in i for i in e["inputs"]), e["id"]
    [eval_rob] = [e for e in overalls if e["id"] == "eval_overall_rob"]
    assert {(i["section"], i["field"]) for i in eval_rob["inputs"]} == {
        ("eval_d1_participants", "risk_of_bias"),
        ("eval_d2_predictors", "risk_of_bias"),
        ("eval_d3_outcome", "risk_of_bias"),
        ("eval_d4_judgment", "risk_of_bias"),
    }


@pytest.mark.asyncio
async def test_every_spec_coordinate_resolves_to_a_seeded_field() -> None:
    """Inputs AND the target/rationale/summary pointers: a dangling ref
    silently nulls a judgment forever, because the seed never UPDATEs an
    existing template."""
    session = await _seed()
    [tpl] = _of(session, ExtractionTemplateGlobal)
    seeded = {(sec, f.name) for sec, rows in _fields_by_section(session).items() for f in rows}
    for coord in spec_coordinates(tpl.schema_["derived_judgments"]):
        assert coord in seeded, coord


@pytest.mark.asyncio
async def test_idempotent_when_template_exists() -> None:
    session = ExistingTemplateSession()
    await seed_probast_ai(session)
    assert session.added == []
