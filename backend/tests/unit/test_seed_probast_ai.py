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
from uuid import UUID, uuid5

import pytest

from app.models.extraction import (
    ExtractionEntityType,
    ExtractionField,
    ExtractionTemplateGlobal,
)
from app.seed import _PROBAST_JUDGMENT, _PROBAST_SIGNALING
from app.seed_probast_ai import seed_probast_ai
from app.seed_probast_ai_data import _PAI_SIGNALING
from app.services.derived_judgment_service import is_recommendation, spec_coordinates
from app.services.value_semantics import ABSENT_REASON_LABELS
from tests.unit.conftest import CapturingSession, ConvergingSession


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
    assert tpl.version == "2.1.0"
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


def _signaling_rows(session: CapturingSession) -> list[tuple[str, Any]]:
    """Every seeded signaling question, by (section, field).

    Selects on ``_PAI_SIGNALING`` — the v2-local five-answer list. The pre-2.1.0
    selector was ``_PROBAST_SIGNALING``, which after the swap matches nothing
    and makes an unchanged loop-body test pass vacuously.
    """
    return [
        (sec, f)
        for sec, rows in _fields_by_section(session).items()
        for f in rows
        if f.allowed_values == _PAI_SIGNALING
    ]


@pytest.mark.asyncio
async def test_signaling_selects_carry_the_instruments_five_answer_scale() -> None:
    """Y/PY/PN/N/NI on ONE control (spec 2026-08-26 §1b).

    NI is the instrument's own fifth answer, so it ships as a select option and
    the separate marker button is turned off per field — one concept, one
    control. The shared four-answer constant is untouched: the classic PROBAST
    seed still uses it, and ``_signaling``'s identity rule keys off it.
    """
    session = await _seed()
    rows = _signaling_rows(session)
    assert len(rows) == 42
    assert [o["value"] if isinstance(o, dict) else o for o in _PAI_SIGNALING] == [
        "Y",
        "PY",
        "PN",
        "N",
        "NI",
    ]
    assert _PROBAST_SIGNALING == ["Y", "PY", "PN", "N"]
    # The NI option's LABEL is load-bearing, not cosmetic: the export hands
    # ``derived_judgment_service`` a resolved label, which reaches Unclear only
    # by matching the marker-label table. Drift here breaks screen/workbook
    # parity silently.
    assert _PAI_SIGNALING[-1]["label"] in ABSENT_REASON_LABELS.values()


@pytest.mark.asyncio
async def test_signaling_rows_have_the_matching_answer_instruction() -> None:
    session = await _seed()
    rows = _signaling_rows(session)
    assert rows, "selector matched no signaling rows"
    for sec, f in rows:
        assert f.llm_description, (sec, f.name)
        assert "Answer Y, PY, PN, N or NI" in f.llm_description, (sec, f.name)
        if (sec, f.name) in _NA_ROWS:
            assert "not applicable" in f.llm_description, (sec, f.name)


#: Prompt phrasings that steer the model to the RETIRED marker. 2.1.0 made "no
#: information" an answer on the scale, and turned the marker off on every
#: field — a prompt still asking for it requests an encoding the field refuses.
_MARKER_PHRASINGS = ("mark no information", "lean to no information")


@pytest.mark.asyncio
async def test_no_prompt_still_steers_the_model_to_the_retired_marker() -> None:
    session = await _seed()
    for sec, rows in _fields_by_section(session).items():
        for f in rows:
            for phrase in _MARKER_PHRASINGS:
                assert phrase not in (f.llm_description or ""), (sec, f.name, phrase)


@pytest.mark.asyncio
async def test_the_no_information_marker_is_off_on_every_field() -> None:
    session = await _seed()
    fields = _of(session, ExtractionField)
    assert len(fields) == 95
    assert not any(f.allows_no_information for f in fields)


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
async def test_required_is_the_deliverable_not_the_scaffolding() -> None:
    """Required = what the assessment OWES: the Step-2 classifier, the 8 domain
    judgments, the 6 applicability judgments (spec 2026-08-26 §1b).

    Signaling questions and every text box are optional. Which part of the
    instrument applies is unknown until Step 2, so "all 95 fields owed" was
    unknowable up front and left a development-only study stuck at ~52%
    forever. ``signaling_worst`` is completeness-gated below High, so an
    unanswered SQ still withholds the derived default — the nudge survives
    without requiredness.
    """
    session = await _seed()
    required = {
        (sec, f.name)
        for sec, rows in _fields_by_section(session).items()
        for f in rows
        if f.is_required
    }
    assert {name for _, name in required} == {
        "study_type",
        "quality_concern",
        "risk_of_bias",
        "applicability_concerns",
    }
    assert len(required) == 15
    for sec, f in _signaling_rows(session):
        assert f.is_required is False, (sec, f.name)


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
async def test_scope_rules_declare_the_two_single_part_study_types() -> None:
    """The Step-2 classification stops being a display hint: which sections a
    study type excludes is DECLARED DATA beside ``derived_judgments``, so every
    layer reads one rule instead of re-deriving it from ``dev_``/``eval_`` name
    prefixes (spec 2026-08-26 §1). ``combination`` excludes nothing and is
    therefore absent — the conservative default for anything unrecognized.
    """
    session = await _seed()
    [tpl] = _of(session, ExtractionTemplateGlobal)
    rules = tpl.schema_["scope_rules"]
    assert set(rules["excludes"]) == {"development_only", "evaluation_only"}
    assert rules["excludes"]["development_only"] == [
        "eval_d1_participants",
        "eval_d2_predictors",
        "eval_d3_outcome",
        "eval_d4_analysis_apparent",
        "eval_d4_analysis_internal",
        "eval_d4_analysis_external",
        "eval_d4_judgment",
    ]
    assert rules["excludes"]["evaluation_only"] == [
        "dev_d1_participants",
        "dev_d2_predictors",
        "dev_d3_outcome",
        "dev_d4_analysis",
    ]
    # The classifier's own options are what the excludes keys must match.
    study_type = next(f for f in _fields_by_section(session)["assessment_scope"])
    codes = {o["value"] for o in study_type.allowed_values}
    assert set(rules["excludes"]) <= codes


@pytest.mark.asyncio
async def test_scope_rule_coordinates_resolve_to_seeded_sections() -> None:
    """Dangling-ref guard, the ``derived_judgments`` assertion's sibling. A
    section name that resolves to nothing simply stops being excluded, which is
    invisible on screen; and a classifier that excluded its OWN section would
    hide the form's entry point, making the classification unreachable.
    """
    session = await _seed()
    [tpl] = _of(session, ExtractionTemplateGlobal)
    by_section = _fields_by_section(session)
    seeded_fields = {(sec, f.name) for sec, rows in by_section.items() for f in rows}
    rules = tpl.schema_["scope_rules"]

    classifier = rules["classifier"]
    assert (classifier["section"], classifier["field"]) in seeded_fields

    for study_type, excluded in rules["excludes"].items():
        assert excluded, study_type
        assert len(set(excluded)) == len(excluded), study_type
        for section in excluded:
            assert section in by_section, (study_type, section)
        assert classifier["section"] not in excluded, study_type


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
async def test_field_ids_are_deterministic() -> None:
    """Converging replaces the children every boot, so their identity must be
    derived, not random: ``_field`` leaves ``id`` to ``uuid4``, which would
    churn 95 global UUIDs per deploy and make "same data → same rows" false."""
    first = _of(await _seed(), ExtractionField)
    second = _of(await _seed(), ExtractionField)
    ids = [f.id for f in first]
    assert ids == [f.id for f in second]
    assert len(set(ids)) == 95
    for f in first:
        assert f.id == uuid5(f.entity_type_id, f.name), f.name


@pytest.mark.asyncio
async def test_converges_onto_an_existing_row_instead_of_skipping() -> None:
    """The delivery vehicle for every future template correction.

    Before 2.1.0 the seeder early-returned on an existing row, so a corrected
    ``derived_judgments`` spec could never reach a database that already had
    the template and ``version`` was decorative. Now it UPDATEs the row in
    place and replaces its children — unconditionally, because gating on a
    version bump would reintroduce the forgotten-bump silent no-op.
    """
    session = ConvergingSession()
    await seed_probast_ai(session)

    # The row is mutated, never re-added: deleting and re-inserting it would
    # SET NULL every clone's global_template_id and break clone dedupe.
    assert _of(session, ExtractionTemplateGlobal) == []
    assert session.existing.version == "2.1.0"
    assert "scope_rules" in session.existing.schema_
    assert "derived_judgments" in session.existing.schema_
    # ...and the manager-customized ✨ instruction is never written here.
    assert not hasattr(session.existing, "llm_template_instruction")

    # Children are REPLACED: one delete, then the full tree re-inserted.
    deletes = [s for s in session.executed if "DELETE" in str(s).upper()]
    assert len(deletes) == 1
    assert len(_of(session, ExtractionEntityType)) == 13
    assert len(_of(session, ExtractionField)) == 95


@pytest.mark.asyncio
async def test_converging_produces_the_same_tree_as_a_fresh_insert() -> None:
    """Idempotence, stated as identity rather than as counts: the row the
    convergence path writes must be indistinguishable from the insert path's."""
    fresh = await _seed()
    converged = ConvergingSession()
    await seed_probast_ai(converged)

    def _shape(ets: list[Any], fields: list[Any]) -> Any:
        return (
            sorted((et.id, et.name, et.sort_order) for et in ets),
            sorted((f.id, f.name, f.is_required, f.allows_no_information) for f in fields),
        )

    assert _shape(_of(converged, ExtractionEntityType), _of(converged, ExtractionField)) == _shape(
        _of(fresh, ExtractionEntityType), _of(fresh, ExtractionField)
    )
    [tpl] = _of(fresh, ExtractionTemplateGlobal)
    assert converged.existing.schema_ == tpl.schema_
    assert converged.existing.version == tpl.version


@pytest.mark.asyncio
async def test_convergence_is_serialized_by_an_advisory_lock() -> None:
    """The boot runs this before gunicorn starts; two containers starting at
    once would otherwise race one's DELETE against the other's re-INSERT and
    abort a deploy on a duplicate key."""
    session = ConvergingSession()
    await seed_probast_ai(session)
    assert "pg_advisory_xact_lock" in str(session.executed[0])
