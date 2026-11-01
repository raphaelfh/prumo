"""Unit tests for ``exports/values.py``: the typed export value projection."""

from __future__ import annotations

from dataclasses import replace
from uuid import uuid4

import pytest

from app.models.extraction import ExtractionFieldType
from app.services.exports.extraction_snapshot_reader import AllowedValue
from app.services.exports.values import build_option_labels, display_value, to_export_value
from app.services.extraction_export_service import FieldDescriptor, SectionDescriptor
from app.services.value_semantics import ABSENT_REASON_LABELS


def _field(ftype, *, options=(), unit=None, allow_other=False) -> FieldDescriptor:
    return FieldDescriptor(
        field_id=uuid4(),
        label="F",
        type=ftype,
        allowed_values=tuple(AllowedValue(c, lbl) for c, lbl in options),
        unit=unit,
        allow_other=allow_other,
    )


def _labels(f):
    return build_option_labels(
        [
            SectionDescriptor(
                entity_type_id=uuid4(), label="S", parent_entity_type_id=None, fields=(f,)
            )
        ]
    )


def test_number_and_unit_are_split():
    f = _field(ExtractionFieldType.NUMBER)
    v = to_export_value({"value": 7394, "unit": "participants"}, f, {})
    assert (v.status, v.value_num, v.unit, v.value_text) == ("answered", 7394, "participants", None)
    assert display_value(v, f) == "7394 participants"


def test_field_unit_is_a_display_fallback_only():  # D9
    f = _field(ExtractionFieldType.NUMBER, unit="kg")
    v = to_export_value({"value": 12}, f, {})
    assert v.unit is None and display_value(v, f) == "12 kg"


def test_double_wrap_and_verification_are_peeled():
    f = _field(ExtractionFieldType.NUMBER)
    raw = {"value": {"value": 5, "unit": "mg"}, "verification": {"verdict": "confirmed"}}
    v = to_export_value(raw, f, {})
    assert (v.value_num, v.unit) == (5, "mg")


def test_numeric_text_parses_and_garbage_is_nonconforming():
    f = _field(ExtractionFieldType.NUMBER)
    assert to_export_value({"value": "22"}, f, {}).value_num == 22
    for text in ("approx 5", "nan", "inf"):  # Review Focus 1
        v = to_export_value({"value": text}, f, {})
        assert (v.status, v.value_num, v.value_text) == ("nonconforming", None, text)


def test_bool_in_a_number_field_is_nonconforming():  # Review Focus 2
    v = to_export_value({"value": True}, _field(ExtractionFieldType.NUMBER), {})
    assert (v.status, v.value_num, v.value_text) == ("nonconforming", None, "True")


def test_select_code_differs_from_label():
    f = _field(ExtractionFieldType.SELECT, options=(("L", "Low"), ("H", "High")))
    v = to_export_value({"value": "L"}, f, _labels(f))
    assert (v.value_text, v.value_label) == ("L", "Low") and display_value(v, f) == "Low"


def test_unknown_select_code_falls_back_to_the_code():
    f = _field(ExtractionFieldType.SELECT, options=(("L", "Low"),))
    v = to_export_value({"value": "X"}, f, _labels(f))
    assert (v.status, v.value_label, display_value(v, f)) == ("answered", "X", "X")


def test_multiselect_and_other():  # D9 for the single `other`
    f = _field(ExtractionFieldType.MULTISELECT, options=(("a", "A"), ("b", "B")), allow_other=True)
    raw = {"value": {"selected": ["a"], "other_texts": ["t1", "t2"]}}
    v = to_export_value(raw, f, _labels(f))
    assert (v.value_text, v.value_label, v.other_text) == ("a", "A", "t1; t2")
    assert display_value(v, f) == "A; Other: t1; Other: t2"
    s = _field(ExtractionFieldType.SELECT, options=(("x", "X"),), allow_other=True)
    raw = {"value": {"selected": "other", "other_text": "Cohort"}}
    one = to_export_value(raw, s, _labels(s))
    assert (one.value_text, one.other_text, display_value(one, s)) == (
        None,
        "Cohort",
        "Other: Cohort",
    )


def test_boolean_and_date():
    b = _field(ExtractionFieldType.BOOLEAN)
    v = to_export_value({"value": False}, b, {})
    assert (v.value_bool, display_value(v, b)) == (False, "No")
    d = _field(ExtractionFieldType.DATE)
    assert to_export_value({"value": "2020-01-31"}, d, {}).value_text == "2020-01-31"


@pytest.mark.parametrize("code", ["no_information", "not_applicable", "not_evaluated"])
def test_absent_marker(code):
    f = _field(ExtractionFieldType.TEXT)
    v = to_export_value({"value": None, "absent_reason": code}, f, {})
    assert (v.status, v.absent_code, display_value(v, f)) == (
        "absent",
        code,
        ABSENT_REASON_LABELS[code],
    )


@pytest.mark.parametrize("raw", [{"value": None}, {"value": ""}, {"value": []}, None])
def test_cleared(raw):
    f = _field(ExtractionFieldType.TEXT)
    v = to_export_value(raw, f, {})
    assert (v.status, display_value(v, f)) == ("cleared", None)


@pytest.mark.parametrize(
    ("ftype", "raw"),
    [
        (ExtractionFieldType.MULTISELECT, {"selected": [], "other_texts": []}),
        (ExtractionFieldType.MULTISELECT, {"value": {"selected": [], "other_texts": []}}),
        (ExtractionFieldType.MULTISELECT, {"value": []}),
        (ExtractionFieldType.SELECT, {"value": {"selected": "other", "other_text": ""}}),
    ],
)
def test_empty_select_shapes_are_cleared(ftype, raw):
    f = _field(ftype)
    v = to_export_value(raw, f, {})
    assert v.status == "cleared"
    assert (v.value_text, v.value_label, v.other_text) == (None, None, None)
    assert display_value(v, f) is None


def test_rejected_keeps_raw_and_renders_blank():
    f = _field(ExtractionFieldType.TEXT)
    raw = {"value": "x"}
    v = to_export_value(raw, f, {}, rejected=True)
    assert (v.status, v.value_text, v.raw, display_value(v, f)) == ("rejected", None, raw, None)


def test_out_of_scope_renders_the_scope_marker():
    f = _field(ExtractionFieldType.TEXT)
    v = replace(to_export_value({"value": "High"}, f, {}), out_of_scope=True)
    assert (v.value_text, display_value(v, f)) == ("High", "Not applicable")


def test_unexpected_shapes_are_nonconforming_json():
    f = _field(ExtractionFieldType.TEXT)
    v = to_export_value({"value": {"b": 1, "a": "é"}}, f, {})
    assert (v.status, v.value_text) == ("nonconforming", '{"a": "é", "b": 1}')
    assert display_value(v, f) == '{"a": "é", "b": 1}'


def test_number_without_unit_renders_bare():
    f = _field(ExtractionFieldType.NUMBER)
    assert display_value(to_export_value({"value": 3.5}, f, {}), f) == 3.5


@pytest.mark.parametrize("payload", [10**400, "9" * 400])
def test_oversized_number_is_nonconforming(payload):
    v = to_export_value({"value": payload}, _field(ExtractionFieldType.NUMBER), {})
    assert (v.status, v.value_num, v.value_text) == ("nonconforming", None, str(payload))


@pytest.mark.parametrize("ftype", [ExtractionFieldType.TEXT, ExtractionFieldType.DATE])
def test_bool_in_a_text_or_date_field_is_nonconforming(ftype):
    v = to_export_value({"value": True}, _field(ftype), {})
    assert (v.status, v.value_text) == ("nonconforming", "True")


def _sel_section(sid, fid, *options) -> SectionDescriptor:
    f = FieldDescriptor(
        field_id=fid,
        label="C",
        type=ExtractionFieldType.SELECT,
        allowed_values=tuple(AllowedValue(c, lbl) for c, lbl in options),
    )
    return SectionDescriptor(entity_type_id=sid, label="S", parent_entity_type_id=None, fields=(f,))


def test_option_labels_fill_pinned_only_codes_latest_first():
    fid, sid = uuid4(), uuid4()
    active = (_sel_section(sid, fid, ("A", "Alpha")),)
    v2 = (_sel_section(sid, fid, ("A", "a2"), ("B", "Bee v2")),)
    v1 = (_sel_section(sid, fid, ("B", "Bee v1"), ("C", "Cee")),)
    labels = build_option_labels(active, [v2, v1])
    assert (labels[(fid, "A")], labels[(fid, "B")], labels[(fid, "C")]) == (
        "Alpha",
        "Bee v2",
        "Cee",
    )
