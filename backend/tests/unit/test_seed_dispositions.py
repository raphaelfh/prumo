"""Seed disposition-string retirement (ADR-0016 Phase 2).

The in-band disposition strings ("No information" / "Not applicable" /
"Not evaluated" / PROBAST "NI" / "NA") are retired as select ``allowed_values``;
no_information is the universal marker and not_applicable / not_evaluated are
per-field opt-in flags. "Unclear" stays a substantive value.
"""

from __future__ import annotations

import pytest

from app.models.extraction import ExtractionField
from app.seed import (
    _PROBAST_SIGNALING,
    _QUADAS2_SIGNALING,
    _YES_NO,
    _YES_NO_UNCLEAR,
    _signaling,
    seed_charms,
    seed_probast,
    seed_quadas2,
)

_DISPOSITION_STRINGS = {"No information", "Not applicable", "Not evaluated", "NI", "NA"}
_SENTINEL_EID = "00000000-0000-0000-0000-000000000000"


class _CapturingSession:
    """A fake AsyncSession that forces the seed build path (``get`` → None) and
    records every ``add``ed ORM object. The seed functions only use ``get`` +
    ``add`` (no execute/flush/commit), so this needs no DB — it lets us assert
    the *new* seed field shape independent of whatever an old ``make db-seed``
    left in the shared local DB."""

    def __init__(self) -> None:
        self.added: list[object] = []

    async def get(self, *_a: object, **_k: object) -> None:
        return None

    def add(self, obj: object) -> None:
        self.added.append(obj)


async def _seeded_fields(seed_fn) -> list[ExtractionField]:
    session = _CapturingSession()
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
    # no_information is universal (no flag); not_evaluated is not a PROBAST option.
    assert field.allows_not_evaluated is False
    assert field.allowed_values == _PROBAST_SIGNALING


def test_signaling_no_flag_for_quadas() -> None:
    field = _signaling(_SENTINEL_EID, "q", "Question?", 0, _QUADAS2_SIGNALING)
    assert field.allows_not_applicable is False
    assert field.allows_not_evaluated is False


@pytest.mark.asyncio
@pytest.mark.parametrize("seed_fn", [seed_charms, seed_probast, seed_quadas2])
async def test_no_seeded_field_carries_a_disposition_value(seed_fn) -> None:
    """No seeded field's allowed_values may contain any in-band disposition
    string in any encoding (full-word or PROBAST abbreviation). Catches inline
    ``allowed=[...]`` lists the constant sweep would miss."""
    fields = await _seeded_fields(seed_fn)
    assert fields, "seed produced no fields"
    for f in fields:
        values = set(f.allowed_values or [])
        assert _DISPOSITION_STRINGS.isdisjoint(values), (f.name, values)


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
async def test_quadas2_has_no_disposition_flags() -> None:
    """QUADAS-2 never offered NA/NI (it uses substantive Unclear), so no field
    opts into a disposition flag."""
    fields = await _seeded_fields(seed_quadas2)
    assert fields
    assert not any(f.allows_not_applicable or f.allows_not_evaluated for f in fields)
