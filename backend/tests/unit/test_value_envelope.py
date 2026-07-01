"""Unit tests for the envelope-aware export value resolver.

Pure-function tests — no DB, no openpyxl. Each case maps to one row of
the §6 / §6.2-A1 envelope contract in the redesign spec.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.models.extraction import ExtractionFieldType
from app.services.exports.value_envelope import resolve_value


@dataclass(frozen=True)
class _Field:
    """Minimal structural stand-in for FieldDescriptor (type + unit)."""

    type: ExtractionFieldType
    unit: str | None = None


def test_none_returns_none() -> None:
    assert resolve_value(None) is None


def test_scalar_passthrough() -> None:
    assert resolve_value("hello") == "hello"
    assert resolve_value(5) == 5
    assert resolve_value(3.14) == 3.14


def test_single_wrap_value() -> None:
    assert resolve_value({"value": "x"}) == "x"
    assert resolve_value({"value": 7}) == 7


def test_double_wrapped_value() -> None:
    # Decisions/proposals write path wraps {"value": inner}; inner may be
    # itself a {"value": ...} or a {"value", "unit"} envelope.
    assert resolve_value({"value": {"value": "deep"}}) == "deep"


def test_value_unit_appends_unit() -> None:
    field = _Field(type=ExtractionFieldType.NUMBER, unit=None)
    assert resolve_value({"value": 5, "unit": "mg"}, field=field) == "5 mg"


def test_double_wrapped_value_unit() -> None:
    field = _Field(type=ExtractionFieldType.NUMBER)
    assert resolve_value({"value": {"value": 5, "unit": "mg"}}, field=field) == "5 mg"


def test_value_unit_falls_back_to_field_unit() -> None:
    field = _Field(type=ExtractionFieldType.NUMBER, unit="kg")
    # Envelope omits unit → field.unit is used.
    assert resolve_value({"value": 12}, field=field) == "12 kg"


def test_envelope_unit_wins_over_field_unit() -> None:
    field = _Field(type=ExtractionFieldType.NUMBER, unit="kg")
    assert resolve_value({"value": 5, "unit": "mg"}, field=field) == "5 mg"


def test_empty_unit_yields_bare_scalar() -> None:
    field = _Field(type=ExtractionFieldType.NUMBER, unit=None)
    assert resolve_value({"value": 9, "unit": ""}, field=field) == 9
    assert resolve_value({"value": 9, "unit": None}, field=field) == 9


def test_single_other() -> None:
    assert resolve_value({"selected": "other", "other_text": "freetext"}) == "freetext"


def test_multi_other_joins_labels_and_texts() -> None:
    raw = {"selected": ["a", "b"], "other_texts": ["c", "d"]}
    assert resolve_value(raw) == "a; b; c; d"


def test_multi_other_empty_other_texts() -> None:
    raw = {"selected": ["a", "b"], "other_texts": []}
    assert resolve_value(raw) == "a; b"


def test_list_multiselect_joins() -> None:
    assert resolve_value(["a", "b", None, "c"]) == "a; b; c"


def test_boolean_rendering_with_field() -> None:
    field = _Field(type=ExtractionFieldType.BOOLEAN)
    assert resolve_value({"value": True}, field=field) == "Yes"
    assert resolve_value({"value": False}, field=field) == "No"


def test_boolean_without_field_is_native_bool() -> None:
    # No field context → leave the native bool for the format helper.
    assert resolve_value({"value": True}) is True


def test_no_information_sentinel_preserved() -> None:
    # Legacy pre-migration select string (no absent_reason sibling) still
    # resolves to its literal — the marker guard must NOT intercept it.
    assert resolve_value("No information") == "No information"
    assert resolve_value({"value": "No information"}) == "No information"


def test_absent_reason_marker_renders_stable_label() -> None:
    # ADR-0016: a coded disposition marker ({value: null, absent_reason: X})
    # resolves to its stable label — NOT to a dict-stringify. Guard is pulled
    # forward from Phase 4 so Phase-1 marker writes never leak into a cell.
    assert resolve_value({"value": None, "absent_reason": "no_information"}) == "No information"
    assert resolve_value({"value": None, "absent_reason": "not_applicable"}) == "Not applicable"
    assert resolve_value({"value": None, "absent_reason": "not_evaluated"}) == "Not evaluated"


def test_absent_reason_marker_never_dict_stringifies() -> None:
    # The exact leak this guard prevents: without it, the {value, absent_reason}
    # key-set matches no branch and falls to the catch-all "; ".join dict
    # rendering → "value: None; absent_reason: no_information" in a cell.
    out = resolve_value({"value": None, "absent_reason": "no_information"})
    assert out == "No information"
    assert "absent_reason" not in str(out)
    assert not isinstance(out, dict)


def test_absent_reason_marker_wins_over_value_keyset() -> None:
    # Defensive: even if a marker somehow carried a non-null value, the
    # disposition label takes precedence over the {"value"} unwrap (the branch
    # is placed at the top of resolve_value).
    assert resolve_value({"value": "stray", "absent_reason": "no_information"}) == "No information"


def test_every_absent_reason_code_has_a_label() -> None:
    # Drift guard: a new AbsentReason member without an export label would
    # otherwise KeyError into a cell. Fail loudly here instead. The label map is
    # the single source in value_semantics (ADR-0016 Phase 4); resolve_value reads
    # it, so this guard protects the cell resolver too.
    from app.services.value_semantics import ABSENT_REASON_LABELS, AbsentReason

    for code in AbsentReason:
        assert code.value in ABSENT_REASON_LABELS
        assert isinstance(ABSENT_REASON_LABELS[code.value], str)


def test_out_of_vocab_absent_reason_is_not_treated_as_marker() -> None:
    # A garbage absent_reason is not a resolution: value_absent_reason returns
    # None, so this falls through to the catch-all (still a clean string, never
    # a dict) — it must NOT render a fabricated disposition label.
    out = resolve_value({"value": None, "absent_reason": "lol"})
    assert not isinstance(out, dict)
    assert out not in {"No information", "Not applicable", "Not evaluated"}


def test_never_returns_dict() -> None:
    # Any unexpected dict shape must NOT leak as a Python-repr str of dict;
    # it collapses to a deterministic key:value rendering.
    out = resolve_value({"unexpected": 1, "shape": 2})
    assert not isinstance(out, dict)
    assert isinstance(out, str)


def test_double_wrapped_value_unit_not_double_decorated() -> None:
    # Regression: the inner {value, unit} already produces "5 mg"; the
    # outer single-wrap must NOT re-append field.unit ("5 mg kg").
    field = _Field(type=ExtractionFieldType.NUMBER, unit="kg")
    assert resolve_value({"value": {"value": 5, "unit": "mg"}}, field=field) == "5 mg"


def test_single_wrap_boolean_not_unit_decorated() -> None:
    # Regression: a unit-bearing field must NOT decorate a boolean
    # ("Yes kg"); booleans are not numeric.
    field = _Field(type=ExtractionFieldType.BOOLEAN, unit="kg")
    assert resolve_value({"value": True}, field=field) == "Yes"
    assert resolve_value({"value": False}, field=field) == "No"


def test_single_wrap_nonnumeric_scalar_not_unit_decorated() -> None:
    # Regression: a non-numeric free-text scalar under a unit-bearing
    # field must NOT be decorated ("approx mg").
    field = _Field(type=ExtractionFieldType.NUMBER, unit="mg")
    assert resolve_value({"value": "approx"}, field=field) == "approx"


def test_value_unit_does_not_decorate_nonnumeric_scalar() -> None:
    # Regression: even an explicit envelope unit must not decorate a
    # non-numeric inner (the unit only makes sense for numbers).
    field = _Field(type=ExtractionFieldType.NUMBER)
    assert resolve_value({"value": "approx", "unit": "mg"}, field=field) == "approx"


def test_resolves_with_real_field_descriptor_unit() -> None:
    from uuid import uuid4

    from app.services.extraction_export_service import FieldDescriptor

    fd = FieldDescriptor(
        field_id=uuid4(),
        label="Dose",
        type=ExtractionFieldType.NUMBER,
        allowed_values=(),
        parent_section_id=uuid4(),
        unit="mg",
    )
    # Envelope omits unit → FieldDescriptor.unit fills it in.
    assert resolve_value({"value": 5}, field=fd) == "5 mg"


def test_format_export_scalar_boolean_with_field() -> None:
    from app.services.exports.value_envelope import format_export_scalar

    field = _Field(type=ExtractionFieldType.BOOLEAN)
    assert format_export_scalar(True, field=field) == "Yes"
    assert format_export_scalar(False, field=field) == "No"


def test_format_export_scalar_strips_tzinfo() -> None:
    from datetime import UTC, datetime

    from app.services.exports.value_envelope import format_export_scalar

    aware = datetime(2026, 6, 14, 12, 0, tzinfo=UTC)
    out = format_export_scalar(aware)
    assert out.tzinfo is None


def test_format_export_scalar_passthrough_scalar() -> None:
    from app.services.exports.value_envelope import format_export_scalar

    assert format_export_scalar("5 mg") == "5 mg"
    assert format_export_scalar(7) == 7
    assert format_export_scalar(None) is None
