"""Structure guards for the CHARMS + Multimodal seed template.

Runs without a database: ``seed_charms_mm`` only calls ``get`` + ``add``
(see :class:`tests.unit.conftest.CapturingSession`). The real-database
concerns the fake cannot reach — PG enum validity, FKs, and the deferred
``trg_check_model_section_parent_role`` trigger — are covered by CI's
``python -m app.seed`` run against a fresh database.

Design reference:
``docs/superpowers/specs/2026-07-25-charms-multimodal-template-design.md``
"""

from __future__ import annotations

import pytest

from app.models.extraction import (
    ExtractionEntityRole,
    ExtractionEntityType,
    ExtractionField,
    ExtractionTemplateGlobal,
)
from app.seed import seed_charms_mm
from tests.unit.conftest import CapturingSession, ExistingTemplateSession

# The authoritative roster: section -> field names, in seeded order.
#
# Asserting *names* rather than counts is deliberate. Per-section counts
# repeat across sections (5x2, 3x4, 2x3), so a field accidentally built
# with a neighbouring section's entity-type id would keep both counts
# correct and slip through a count-only check — the most likely defect
# when transcribing 66 rows by hand.
_ROSTER: dict[str, list[str]] = {
    "source_of_data": [
        "src_design",
        "src_data_source",
        "src_country",
        "src_recruit_period",
    ],
    "participants": [
        "par_eligibility",
        "par_setting",
        "par_n_centers",
        "par_inclusion",
        "par_exclusion",
    ],
    "outcome": [
        "out_definition",
        "out_type",
        "out_timing",
        "out_blinded",
        "out_hf_phenotype",
        "out_endpoint",
    ],
    "candidate_predictors": [
        "prd_list",
        "prd_n_candidates",
        "prd_timing",
        "prd_blinded",
        "prd_type",
    ],
    "sample_size": [
        "ss_n_participants",
        "ss_n_events",
        "ss_epv",
    ],
    "missing_data": [
        "miss_reported",
        "miss_method",
    ],
    "interpretation": [
        "intp_comparison",
        "intp_limitations",
        "intp_applicability",
    ],
    "prediction_models": [
        "mdl_name",
        "mdl_role",
    ],
    "model_development": [
        "dev_method",
        "dev_selection",
        "dev_hyperparam",
        "dev_internal_val",
    ],
    "model_performance": [
        "perf_discrimination",
        "perf_calibration",
        "perf_classification",
    ],
    "model_evaluation": [
        "eval_validation_type",
        "eval_external_source",
        "eval_comparator",
    ],
    "results": [
        "res_final_model",
        "res_coefficients",
    ],
    "multimodal_extension": [
        "mm_modalities",
        "mm_n_domains",
        "mm_fusion_type",
        "mm_representation_tier",
        "mm_encoders",
        "mm_provenance_flag",
        "mm_comparator_type",
    ],
    "numeric_performance": [
        "pnum_validation_type",
        "pnum_auc",
        "pnum_auc_ci_low",
        "pnum_auc_ci_high",
        "pnum_cindex",
        "pnum_cindex_ci_low",
        "pnum_cindex_ci_high",
        "pnum_sensitivity",
        "pnum_specificity",
        "pnum_accuracy",
        "pnum_calib_slope",
        "pnum_calib_intercept",
        "pnum_nri",
        "pnum_brier",
        "pnum_n",
        "pnum_events",
        "pnum_explainability",
    ],
}

_TOTAL_FIELDS = 66


async def _seed() -> CapturingSession:
    session = CapturingSession()
    await seed_charms_mm(session)
    return session


def _of(session: CapturingSession, cls: type) -> list:
    return [o for o in session.added if isinstance(o, cls)]


async def _fields_by_section() -> dict[str, list[ExtractionField]]:
    session = await _seed()
    names = {et.id: et.name for et in _of(session, ExtractionEntityType)}
    out: dict[str, list[ExtractionField]] = {}
    for f in _of(session, ExtractionField):
        out.setdefault(names[f.entity_type_id], []).append(f)
    return out


# --------------------------------------------------------------------------
# Template + entity-type tree
# --------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_seeds_exactly_one_template() -> None:
    templates = _of(await _seed(), ExtractionTemplateGlobal)
    assert len(templates) == 1
    assert templates[0].framework == "CHARMS"


@pytest.mark.asyncio
async def test_entity_type_tree_shape() -> None:
    ets = _of(await _seed(), ExtractionEntityType)
    assert len(ets) == 14

    by_role: dict[str, list[ExtractionEntityType]] = {}
    for et in ets:
        by_role.setdefault(et.role, []).append(et)

    assert len(by_role[ExtractionEntityRole.STUDY_SECTION.value]) == 7
    assert len(by_role[ExtractionEntityRole.MODEL_CONTAINER.value]) == 1
    assert len(by_role[ExtractionEntityRole.MODEL_SECTION.value]) == 6


@pytest.mark.asyncio
async def test_role_parent_coherence() -> None:
    """Mirrors the DB CHECK ``ck_extraction_entity_types_role_parent`` and the
    deferred ``trg_check_model_section_parent_role`` trigger, neither of which
    the DB-free fake can reach."""
    ets = _of(await _seed(), ExtractionEntityType)
    container = next(e for e in ets if e.role == ExtractionEntityRole.MODEL_CONTAINER.value)

    assert container.parent_entity_type_id is None
    assert container.cardinality == "many"

    for et in ets:
        if et.role == ExtractionEntityRole.STUDY_SECTION.value:
            assert et.parent_entity_type_id is None, et.name
        if et.role == ExtractionEntityRole.MODEL_SECTION.value:
            assert et.parent_entity_type_id == container.id, et.name


@pytest.mark.asyncio
async def test_numeric_performance_is_the_only_repeating_model_section() -> None:
    """It repeats per validation type (apparent / internal / external); every
    other per-model section is 1:1 with the model."""
    ets = _of(await _seed(), ExtractionEntityType)
    many = [
        e
        for e in ets
        if e.role == ExtractionEntityRole.MODEL_SECTION.value and e.cardinality == "many"
    ]
    assert [e.name for e in many] == ["numeric_performance"]


@pytest.mark.asyncio
async def test_entity_types_are_not_required() -> None:
    ets = _of(await _seed(), ExtractionEntityType)
    assert ets, "seed produced no entity types"
    assert all(not et.is_required for et in ets)


@pytest.mark.asyncio
async def test_idempotent_when_template_already_exists() -> None:
    session = ExistingTemplateSession()
    await seed_charms_mm(session)
    assert session.added == []


# --------------------------------------------------------------------------
# Field roster
# --------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_field_roster_matches_the_spec() -> None:
    """Exact names, per section, in order — subsumes counts and identity."""
    by_section = await _fields_by_section()
    assert {k: [f.name for f in v] for k, v in by_section.items()} == _ROSTER


@pytest.mark.asyncio
async def test_total_field_count() -> None:
    assert len(_of(await _seed(), ExtractionField)) == _TOTAL_FIELDS


@pytest.mark.asyncio
async def test_sort_order_is_dense_and_zero_based_per_section() -> None:
    for section, fields in (await _fields_by_section()).items():
        assert [f.sort_order for f in fields] == list(range(len(fields))), section


@pytest.mark.asyncio
async def test_choice_fields_have_allowed_values_and_others_do_not() -> None:
    fields = _of(await _seed(), ExtractionField)
    assert fields, "seed produced no fields"
    for f in fields:
        if f.field_type in ("select", "multiselect"):
            assert f.allowed_values, f.name
        else:
            assert f.allowed_values is None, f.name


@pytest.mark.asyncio
async def test_every_field_carries_an_llm_prompt() -> None:
    fields = _of(await _seed(), ExtractionField)
    assert fields, "seed produced no fields"
    for f in fields:
        assert f.llm_description, f.name


@pytest.mark.asyncio
async def test_every_field_is_required() -> None:
    """Matches CHARMS / PROBAST / QUADAS-2. A required field turns the
    instrument's "if absent, NI" into an explicitly recorded answer rather
    than a silent blank (constitution IX); the finalize gate counts a
    no_information marker as filled."""
    fields = _of(await _seed(), ExtractionField)
    assert fields, "seed produced no fields"
    assert all(f.is_required for f in fields)


@pytest.mark.asyncio
async def test_disposition_opt_ins_are_minimal_and_targeted() -> None:
    """ADR-0016: no_information is universal and needs no flag. Only the
    fields whose prompts genuinely invoke NA / not-evaluated opt in."""
    fields = {f.name: f for f in _of(await _seed(), ExtractionField)}

    assert fields["eval_external_source"].allows_not_applicable
    for name in ("perf_calibration", "pnum_calib_slope", "pnum_calib_intercept"):
        assert fields[name].allows_not_evaluated, name

    assert sum(f.allows_not_applicable for f in fields.values()) == 1
    assert sum(f.allows_not_evaluated for f in fields.values()) == 3


@pytest.mark.asyncio
async def test_confidence_intervals_are_paired_number_fields() -> None:
    """Spec decision: prumo has no ``number_ci`` type, so each interval is a
    point estimate plus two bound fields."""
    fields = {f.name: f for f in _of(await _seed(), ExtractionField)}
    for stem in ("pnum_auc", "pnum_cindex"):
        assert fields[stem].field_type == "number", stem
        for bound in ("_ci_low", "_ci_high"):
            assert fields[stem + bound].field_type == "number", stem + bound


@pytest.mark.asyncio
async def test_controlled_vocabularies_match_the_protocol() -> None:
    fields = {f.name: f for f in _of(await _seed(), ExtractionField)}

    modalities = fields["mm_modalities"]
    assert modalities.field_type == "multiselect"
    assert modalities.allowed_values == [
        "ecg",
        "pcg",
        "cxr",
        "echo",
        "cmr",
        "clinical-text",
        "tabular-ehr",
        "ehr-timeseries",
        "omics",
        "hrv",
        "wearable-iot",
    ]

    assert fields["mm_fusion_type"].allowed_values == [
        "early",
        "intermediate",
        "late",
        "none",
    ]
    assert fields["mm_representation_tier"].allowed_values == [
        "tier-1",
        "tier-2",
        "tier-3",
    ]
    assert fields["mm_provenance_flag"].allowed_values == [
        "separate-stream",
        "single-field-imaging-origin",
        "na",
    ]
    assert fields["mm_comparator_type"].allowed_values == [
        "guideline-score",
        "unimodal-ml",
        "logistic-linear",
        "human-expert",
        "none",
    ]
    assert fields["mdl_role"].allowed_values == [
        "multimodal",
        "unimodal-comparator",
        "baseline",
        "guideline-score",
    ]
    assert fields["pnum_validation_type"].allowed_values == [
        "apparent",
        "internal",
        "external",
    ]
    assert fields["pnum_explainability"].field_type == "multiselect"


@pytest.mark.asyncio
async def test_modality_prompts_embed_the_protocol_definition() -> None:
    """``mm_modalities`` / ``mm_n_domains`` carry the modality definition
    inline so the classification does not depend on the extraction wrapper
    retrieving the right passage of the protocol."""
    fields = {f.name: f for f in _of(await _seed(), ExtractionField)}
    for name in ("mm_modalities", "mm_n_domains"):
        prompt = fields[name].llm_description.lower()
        assert "provenance" in prompt, name
        assert "tabular-ehr" in prompt, name
        assert "single acquisition" in prompt, name
