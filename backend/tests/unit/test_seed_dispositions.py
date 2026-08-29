"""Seed disposition-string retirement (ADR-0016 Phase 2).

The in-band disposition strings ("No information" / "Not applicable" /
"Not evaluated" / PROBAST "NI" / "NA") are retired as select ``allowed_values``;
all three dispositions are per-field opt-in flags. "Unclear" stays a
substantive value.

Amended by migration 0062 / PROBAST+AI 2.1.0: "NI" returns on that ONE
template as the instrument's own fifth signaling answer, with
``allows_no_information`` switched off there. The invariant is unchanged — one
concept, one control — so the rule is asserted per field ("never both") rather
than as a global ban on the string.
"""

from __future__ import annotations

import pytest

from app.llm.schema import _enum_values
from app.models.extraction import ExtractionField
from app.seed import (
    _PROBAST_JUDGMENT,
    _PROBAST_SIGNALING,
    _QUADAS2_SIGNALING,
    _YES_NO,
    _YES_NO_UNCLEAR,
    _field,
    _signaling,
    seed_charms,
    seed_charms_mm,
    seed_probast,
    seed_quadas2,
)
from app.seed_probast_ai import seed_probast_ai
from app.seed_probast_ai_data import _PAI_SIGNALING
from tests.unit.conftest import CapturingSession

_DISPOSITION_STRINGS = {"No information", "Not applicable", "Not evaluated", "NI", "NA"}
_SENTINEL_EID = "00000000-0000-0000-0000-000000000000"


async def _seeded_fields(seed_fn) -> list[ExtractionField]:
    session = CapturingSession()
    await seed_fn(session)
    return [obj for obj in session.added if isinstance(obj, ExtractionField)]


def test_yes_no_constants_carry_no_dispositions() -> None:
    assert _YES_NO == ["Yes", "No"]
    # "Unclear" is substantive and stays; no disposition string survives.
    assert _YES_NO_UNCLEAR == ["Yes", "No", "Unclear"]
    for const in (_YES_NO, _YES_NO_UNCLEAR, _PROBAST_SIGNALING, _QUADAS2_SIGNALING):
        assert _DISPOSITION_STRINGS.isdisjoint(const), const


def test_probast_signaling_set_dropped_ni_na() -> None:
    assert _PROBAST_SIGNALING == ["Y", "PY", "PN", "N"]


def test_signaling_sets_not_applicable_for_probast() -> None:
    field = _signaling(_SENTINEL_EID, "q", "Question?", 0, _PROBAST_SIGNALING)
    assert field.allows_not_applicable is True
    # not_evaluated is not a PROBAST option; no_information defaults on (0062).
    assert field.allows_not_evaluated is False
    assert field.allowed_values == _PROBAST_SIGNALING


def test_signaling_no_flag_for_quadas() -> None:
    field = _signaling(_SENTINEL_EID, "q", "Question?", 0, _QUADAS2_SIGNALING)
    assert field.allows_not_applicable is False
    assert field.allows_not_evaluated is False


@pytest.mark.asyncio
@pytest.mark.parametrize("seed_fn", [seed_charms, seed_charms_mm, seed_probast, seed_quadas2])
async def test_no_seeded_field_carries_a_disposition_value(seed_fn) -> None:
    """No seeded field's allowed_values may contain any in-band disposition
    string in any encoding (full-word or PROBAST abbreviation). Catches inline
    ``allowed=[...]`` lists the constant sweep would miss.

    ``seed_probast_ai`` is excluded and gets its own assertion below: 2.1.0
    restores "NI" as the instrument's own fifth signaling ANSWER, which is a
    different thing from the retired in-band disposition string this test
    guards against."""
    fields = await _seeded_fields(seed_fn)
    assert fields, "seed produced no fields"
    for f in fields:
        values = {v["value"] if isinstance(v, dict) else v for v in (f.allowed_values or [])}
        assert _DISPOSITION_STRINGS.isdisjoint(values), (f.name, values)


@pytest.mark.asyncio
async def test_probast_ai_owns_ni_as_an_answer_with_the_marker_turned_off() -> None:
    """The narrow, deliberate exception to the rule above (spec 2026-08-26 §1b).

    ADR-0016 Phase 2 retired in-band disposition strings because a field
    offering BOTH the string and the marker encodes one concept twice. 2.1.0
    keeps that invariant from the other side: "NI" comes back as the
    instrument's own answer and the marker is switched OFF on those fields, so
    there is still exactly one control. What must never exist is a field
    carrying both — that is what this asserts, per field rather than globally,
    and it is also what keeps ``disposition_to_marker`` from rewriting the
    answer into a marker the form refuses to render.
    """
    fields = await _seeded_fields(seed_probast_ai)
    assert fields, "seed produced no fields"
    carrying_ni = []
    for f in fields:
        values = {v["value"] if isinstance(v, dict) else v for v in (f.allowed_values or [])}
        offending = values & (_DISPOSITION_STRINGS - {"NI"})
        assert not offending, (f.name, offending)
        if "NI" in values:
            carrying_ni.append(f)
            assert f.allows_no_information is False, f.name
    assert len(carrying_ni) == 42
    # The Step-2 classifier is the ONLY field that keeps the marker: it is
    # required and none of its three options means "the article does not say".
    assert [f.name for f in fields if f.allows_no_information] == ["study_type"]


@pytest.mark.asyncio
async def test_charms_opt_in_flags_set_on_former_disposition_fields() -> None:
    """The two CHARMS fields that used the Not-applicable set and the three that
    used the Not-evaluated set carry the matching opt-in flag; no CHARMS field
    accidentally enables both."""
    fields = await _seeded_fields(seed_charms)
    assert sum(f.allows_not_applicable for f in fields) == 2
    assert sum(f.allows_not_evaluated for f in fields) == 3


@pytest.mark.asyncio
async def test_probast_signaling_fields_allow_not_applicable() -> None:
    """Every PROBAST signaling question (which historically offered NA) enables
    the not_applicable disposition; the domain-judgment fields do not."""
    fields = await _seeded_fields(seed_probast)
    signaling = [f for f in fields if f.allowed_values == _PROBAST_SIGNALING]
    assert signaling, "expected PROBAST signaling fields"
    assert all(f.allows_not_applicable for f in signaling)


@pytest.mark.asyncio
async def test_probast_ai_na_restricted_to_conditional_rows() -> None:
    """PROBAST+AI v2: NA is official on exactly the instrument's four
    conditional (asterisked) items — six field rows after triplication
    (spec 2026-08-22 §5). The other 36 signaling rows and every judgment
    field carry no disposition flag."""
    fields = await _seeded_fields(seed_probast_ai)
    # 2.1.0's answer set is v2-local (five answers, NI included), so selecting
    # on the shared four-answer constant would match nothing and pass vacuously.
    signaling = [f for f in fields if f.allowed_values == _PAI_SIGNALING]
    assert len(signaling) == 42
    flagged = sorted(f.name for f in signaling if f.allows_not_applicable)
    assert flagged == [
        "q4_imbalance_recalibration",
        "q4_uncorrected_imbalance_evaluation",
        "q4_uncorrected_imbalance_evaluation",
        "q4_uncorrected_imbalance_evaluation",
        "q5_data_leakage_avoided",
        "q6_resampling_replicates_all_steps",
    ]
    judgments = [f for f in fields if f.allowed_values == _PROBAST_JUDGMENT]
    assert judgments
    assert not any(f.allows_not_applicable or f.allows_not_evaluated for f in judgments)


@pytest.mark.asyncio
async def test_quadas2_has_no_disposition_flags() -> None:
    """QUADAS-2 never offered NA/NI (it uses substantive Unclear), so no field
    opts into a disposition flag."""
    fields = await _seeded_fields(seed_quadas2)
    assert fields
    assert not any(f.allows_not_applicable or f.allows_not_evaluated for f in fields)


def test_llm_enum_values_exclude_disposition_codes() -> None:
    """The LLM output-model Literal is built from ``_enum_values`` over a field's
    allowed_values. With the disposition codes gone from the seed, the model can
    no longer express NI/NA — no_information is only expressible via a not_found
    status (Phase 1). Locks the seed→schema consequence explicitly."""
    field = _signaling(_SENTINEL_EID, "q", "Question?", 0, _PROBAST_SIGNALING)
    assert _enum_values(field) == ["Y", "PY", "PN", "N"]
    assert _DISPOSITION_STRINGS.isdisjoint(_enum_values(field))


# --- explicit helper knobs (spec 2026-08-22 §5: the v2 seed needs optional
# fields, llm-less assessor-owned fields, and NA on exactly 6 of 42 rows) ---


def test_field_accepts_optional_and_llm_none() -> None:
    f = _field(_SENTINEL_EID, "x", "X", "d", "text", 0, llm=None, is_required=False)
    assert f.is_required is False
    assert f.llm_description is None


def test_field_defaults_stay_required_with_llm() -> None:
    f = _field(_SENTINEL_EID, "x", "X", "d", "text", 0, llm="prompt")
    assert f.is_required is True
    assert f.llm_description == "prompt"


def test_signaling_explicit_na_override_beats_identity() -> None:
    f = _signaling(_SENTINEL_EID, "q", "Q?", 0, _PROBAST_SIGNALING, allows_not_applicable=False)
    assert f.allows_not_applicable is False


def test_signaling_explicit_na_true_on_a_copy() -> None:
    f = _signaling(
        _SENTINEL_EID, "q", "Q?", 0, list(_PROBAST_SIGNALING), allows_not_applicable=True
    )
    assert f.allows_not_applicable is True


def test_signaling_default_keeps_the_identity_rule() -> None:
    assert _signaling(_SENTINEL_EID, "q", "Q?", 0, _PROBAST_SIGNALING).allows_not_applicable
    assert not _signaling(
        _SENTINEL_EID, "q", "Q?", 0, list(_PROBAST_SIGNALING)
    ).allows_not_applicable
