"""Shape of the seeded PROBAST+AI template (no DB — capturing session)."""

from __future__ import annotations

from typing import Any

import pytest

from app.models.extraction import (
    ExtractionEntityType,
    ExtractionField,
    ExtractionTemplateGlobal,
)
from app.seed import _PROBAST_JUDGMENT, _PROBAST_SIGNALING
from app.seed_probast_ai import seed_probast_ai
from tests.unit.conftest import CapturingSession


async def _seed() -> CapturingSession:
    session = CapturingSession()
    await seed_probast_ai(session)
    return session


def _of(session: CapturingSession, cls: type) -> list[Any]:
    return [o for o in session.added if isinstance(o, cls)]


@pytest.mark.asyncio
async def test_template_row() -> None:
    tpl = _of(await _seed(), ExtractionTemplateGlobal)
    assert len(tpl) == 1
    assert tpl[0].name == "PROBAST+AI"
    assert tpl[0].kind == "quality_assessment"
    assert tpl[0].framework == "CUSTOM"


@pytest.mark.asyncio
async def test_ten_flat_sections() -> None:
    ets = _of(await _seed(), ExtractionEntityType)
    assert len(ets) == 10
    # Flat: a grouping parent is unrepresentable (0016 role CHECK + the
    # one-model_container-per-template partial unique index).
    assert all(et.parent_entity_type_id is None for et in ets)
    assert all(et.role == "study_section" for et in ets)
    assert all(et.cardinality == "one" for et in ets)
    assert sorted(et.sort_order for et in ets) == list(range(1, 11))


@pytest.mark.asyncio
async def test_field_counts_per_section() -> None:
    session = await _seed()
    names = {et.id: et.name for et in _of(session, ExtractionEntityType)}
    counts: dict[str, int] = {}
    for f in _of(session, ExtractionField):
        counts[names[f.entity_type_id]] = counts.get(names[f.entity_type_id], 0) + 1
    assert counts == {
        "dev_d1_participants": 5,
        "dev_d2_predictors": 6,
        "dev_d3_outcome": 6,
        "dev_d4_analysis": 6,
        "eval_d1_participants": 5,
        "eval_d2_predictors": 6,
        "eval_d3_outcome": 6,
        "eval_d4_analysis_apparent": 6,
        "eval_d4_analysis_internal": 7,
        "eval_d4_analysis_external": 5,
    }
    assert sum(counts.values()) == 58


@pytest.mark.asyncio
async def test_sort_orders_are_dense_and_unique_per_section() -> None:
    """Guards the enumerate-driven emission against duplicate/missing orders."""
    session = await _seed()
    per_section: dict[Any, list[int]] = {}
    for f in _of(session, ExtractionField):
        per_section.setdefault(f.entity_type_id, []).append(f.sort_order)
    for eid, orders in per_section.items():
        assert sorted(orders) == list(range(len(orders))), (eid, sorted(orders))


@pytest.mark.asyncio
async def test_signaling_fields_allow_not_applicable() -> None:
    fields = _of(await _seed(), ExtractionField)
    signaling = [f for f in fields if f.allowed_values == _PROBAST_SIGNALING]
    assert len(signaling) == 42
    assert all(f.allows_not_applicable for f in signaling)
    assert not any(f.allows_not_evaluated for f in signaling)


@pytest.mark.asyncio
async def test_signaling_prompts_are_question_specific() -> None:
    """Each question carries its own criterion, not the generic default."""
    fields = _of(await _seed(), ExtractionField)
    signaling = [f for f in fields if f.allowed_values == _PROBAST_SIGNALING]
    assert all(f.llm_description for f in signaling)
    assert not any(
        (f.llm_description or "").startswith("Answer the signaling question:") for f in signaling
    )


@pytest.mark.asyncio
async def test_judgment_fields() -> None:
    fields = _of(await _seed(), ExtractionField)
    judgments = [f for f in fields if f.allowed_values == _PROBAST_JUDGMENT]
    assert len(judgments) == 16
    assert not any(f.allows_not_applicable or f.allows_not_evaluated for f in judgments)
    assert sorted({f.name for f in judgments}) == [
        "applicability_concerns",
        "quality_concern",
        "risk_of_bias",
    ]


@pytest.mark.asyncio
async def test_na_defaults_expressed_by_omission() -> None:
    """d4_q5 (leakage) and d4_q6 (resampling) are NA for apparent + external,
    so they exist ONLY in the internal-validation section; the gate q1 exists
    exactly once."""
    session = await _seed()
    names = {et.id: et.name for et in _of(session, ExtractionEntityType)}
    where: dict[str, set[str]] = {}
    for f in _of(session, ExtractionField):
        where.setdefault(f.name, set()).add(names[f.entity_type_id])
    assert where["q5_data_leakage_avoided"] == {"eval_d4_analysis_internal"}
    assert where["q6_resampling_replicates_all_steps"] == {"eval_d4_analysis_internal"}
    assert where["q1_apparent_only_avoided"] == {"eval_d4_analysis_apparent"}


@pytest.mark.asyncio
async def test_derived_judgment_spec_on_template_schema() -> None:
    tpl = _of(await _seed(), ExtractionTemplateGlobal)[0]
    spec = tpl.schema_["derived_judgments"]
    assert [d["id"] for d in spec] == [
        "dev_overall_quality",
        "dev_overall_applicability",
        "eval_overall_rob",
        "eval_overall_applicability",
    ]
    assert all(d["rule"] == "worst_domain" for d in spec)
    rob = next(d for d in spec if d["id"] == "eval_overall_rob")
    collapse = [i for i in rob["inputs"] if "collapse" in i]
    assert len(collapse) == 1
    assert collapse[0]["collapse"] == "worst_of"
    assert len(collapse[0]["inputs"]) == 3


@pytest.mark.asyncio
async def test_every_spec_input_resolves_to_a_seeded_field() -> None:
    """No dangling (section, field) reference — a dangling ref silently nulls
    an overall forever, because the seed never UPDATEs an existing template."""
    session = await _seed()
    names = {et.id: et.name for et in _of(session, ExtractionEntityType)}
    real = {(names[f.entity_type_id], f.name) for f in _of(session, ExtractionField)}
    tpl = _of(session, ExtractionTemplateGlobal)[0]

    def _refs(inputs: list[dict[str, Any]]) -> list[tuple[str, str]]:
        out: list[tuple[str, str]] = []
        for item in inputs:
            if "collapse" in item:
                out.extend(_refs(item["inputs"]))
            else:
                out.append((item["section"], item["field"]))
        return out

    for derived in tpl.schema_["derived_judgments"]:
        for ref in _refs(derived["inputs"]):
            assert ref in real, f"{derived['id']} references missing field {ref}"


@pytest.mark.asyncio
async def test_idempotent_when_template_exists() -> None:
    class _Existing(CapturingSession):
        async def get(self, *_a: Any, **_k: Any) -> Any:
            return object()

    session = _Existing()
    await seed_probast_ai(session)
    assert session.added == []
