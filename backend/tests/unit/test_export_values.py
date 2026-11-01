"""Unit tests for ``exports/values.py``: the typed export value projection."""

from __future__ import annotations

from dataclasses import replace
from uuid import uuid4

import pytest

from app.models.extraction import ExtractionFieldType
from app.services.exports.extraction_snapshot_reader import AllowedValue
from app.services.exports.values import (
    SCOPE_MARKER,
    build_option_labels,
    display_value,
    footnote_key,
    publication_footnotes,
    to_export_value,
)
from app.services.extraction_export_service import FieldDescriptor, SectionDescriptor
from app.services.value_semantics import ABSENT_REASON_LABELS
from tests.unit.helpers.export_layouts import export_value as _ev


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
    assert display_value(v, f, target="matrix") == "7394 participants"


def test_field_unit_is_a_display_fallback_only():  # D9
    f = _field(ExtractionFieldType.NUMBER, unit="kg")
    v = to_export_value({"value": 12}, f, {})
    assert v.unit is None and display_value(v, f, target="matrix") == "12 kg"


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
    assert (v.value_text, v.value_label) == ("L", "Low") and display_value(
        v, f, target="matrix"
    ) == "Low"


def test_unknown_select_code_falls_back_to_the_code():
    f = _field(ExtractionFieldType.SELECT, options=(("L", "Low"),))
    v = to_export_value({"value": "X"}, f, _labels(f))
    assert (v.status, v.value_label, display_value(v, f, target="matrix")) == ("answered", "X", "X")


def test_multiselect_and_other():  # D9 for the single `other`
    f = _field(ExtractionFieldType.MULTISELECT, options=(("a", "A"), ("b", "B")), allow_other=True)
    raw = {"value": {"selected": ["a"], "other_texts": ["t1", "t2"]}}
    v = to_export_value(raw, f, _labels(f))
    assert (v.value_text, v.value_label, v.other_text) == ("a", "A", "t1; t2")
    assert display_value(v, f, target="matrix") == "A; Other: t1; Other: t2"
    s = _field(ExtractionFieldType.SELECT, options=(("x", "X"),), allow_other=True)
    raw = {"value": {"selected": "other", "other_text": "Cohort"}}
    one = to_export_value(raw, s, _labels(s))
    assert (one.value_text, one.other_text, display_value(one, s, target="matrix")) == (
        None,
        "Cohort",
        "Other: Cohort",
    )


def test_boolean_and_date():
    b = _field(ExtractionFieldType.BOOLEAN)
    v = to_export_value({"value": False}, b, {})
    assert (v.value_bool, display_value(v, b, target="matrix")) == (False, "No")
    d = _field(ExtractionFieldType.DATE)
    assert to_export_value({"value": "2020-01-31"}, d, {}).value_text == "2020-01-31"


@pytest.mark.parametrize("code", ["no_information", "not_applicable", "not_evaluated"])
def test_absent_marker(code):
    f = _field(ExtractionFieldType.TEXT)
    v = to_export_value({"value": None, "absent_reason": code}, f, {})
    assert (v.status, v.absent_code, display_value(v, f, target="matrix")) == (
        "absent",
        code,
        ABSENT_REASON_LABELS[code],
    )


@pytest.mark.parametrize("raw", [{"value": None}, {"value": ""}, {"value": []}, None])
def test_cleared(raw):
    f = _field(ExtractionFieldType.TEXT)
    v = to_export_value(raw, f, {})
    assert (v.status, display_value(v, f, target="matrix")) == ("cleared", None)


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
    assert display_value(v, f, target="matrix") is None


def test_rejected_keeps_raw_and_renders_blank():
    f = _field(ExtractionFieldType.TEXT)
    raw = {"value": "x"}
    v = to_export_value(raw, f, {}, rejected=True)
    assert (v.status, v.value_text, v.raw, display_value(v, f, target="matrix")) == (
        "rejected",
        None,
        raw,
        None,
    )


def test_out_of_scope_renders_the_scope_marker():
    f = _field(ExtractionFieldType.TEXT)
    v = replace(to_export_value({"value": "High"}, f, {}), out_of_scope=True)
    assert (v.value_text, display_value(v, f, target="matrix")) == ("High", "Not applicable")


def test_unexpected_shapes_are_nonconforming_json():
    f = _field(ExtractionFieldType.TEXT)
    v = to_export_value({"value": {"b": 1, "a": "é"}}, f, {})
    assert (v.status, v.value_text) == ("nonconforming", '{"a": "é", "b": 1}')
    assert display_value(v, f, target="matrix") == '{"a": "é", "b": 1}'


def test_number_without_unit_renders_bare():
    f = _field(ExtractionFieldType.NUMBER)
    assert display_value(to_export_value({"value": 3.5}, f, {}), f, target="matrix") == 3.5


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


def _f(t, **kw) -> FieldDescriptor:
    return FieldDescriptor(field_id=uuid4(), label="Sample size", type=t, allowed_values=(), **kw)


def test_publication_number_is_the_bare_number_with_fixed_unit():
    f = _f(ExtractionFieldType.NUMBER, unit="participants")
    assert display_value(_ev(value_num=7394), f, target="publication") == 7394
    assert display_value(_ev(value_num=7394), f, target="matrix") == "7394 participants"


def test_publication_number_with_allowed_units_carries_unit_in_cell():
    f = _f(ExtractionFieldType.NUMBER, allowed_units=("mg", "g"))
    assert display_value(_ev(value_num=5, unit="mg"), f, target="publication") == "5 mg"


def test_publication_nonconforming_number_keeps_raw_text():
    v = _ev("nonconforming", value_text="approx 50")
    assert display_value(v, _f(ExtractionFieldType.NUMBER), target="publication") == "approx 50"


@pytest.mark.parametrize(
    ("code", "abbr"),
    [("no_information", "NI"), ("not_applicable", "NA"), ("not_evaluated", "NE")],
)
def test_absent_marker_is_abbreviated_only_in_publication(code, abbr):
    v = _ev("absent", absent_code=code)
    f = _f(ExtractionFieldType.TEXT)
    assert display_value(v, f, target="publication") == abbr
    assert display_value(v, f, target="matrix") == ABSENT_REASON_LABELS[code]
    assert footnote_key(v) == abbr


def test_scope_stamp_on_empty_cell_is_plain_na():  # Review Focus 2
    v = _ev("absent", absent_code="not_applicable", out_of_scope=True)
    assert display_value(v, _f(ExtractionFieldType.NUMBER), target="publication") == "NA"
    assert footnote_key(v) == "NA"


def test_out_of_scope_recorded_value_shows_scope_marker():
    v = _ev(value_num=12, out_of_scope=True)
    assert (
        display_value(v, _f(ExtractionFieldType.NUMBER), target="publication")
        == SCOPE_MARKER
        == "NA*"
    )
    assert footnote_key(v) == SCOPE_MARKER


def test_publication_select_multiselect_other_date_rejected():
    sel = _f(ExtractionFieldType.SELECT)
    assert display_value(_ev(value_text="L", value_label="Low"), sel, target="publication") == "Low"
    assert display_value(_ev(value_text="L"), sel, target="publication") == "L"
    multi = _f(ExtractionFieldType.MULTISELECT)
    assert (
        display_value(
            _ev(value_text="a; b", value_label="Alpha; Beta"), multi, target="publication"
        )
        == "Alpha; Beta"
    )
    assert display_value(_ev(other_text="custom"), sel, target="publication") == "Other: custom"
    date = _f(ExtractionFieldType.DATE)
    assert display_value(_ev(value_text="2024-01-31"), date, target="publication") == "2024-01-31"
    assert display_value(_ev("rejected"), sel, target="publication") is None
    assert display_value(_ev("cleared", out_of_scope=True), sel, target="publication") is None
    assert footnote_key(_ev("cleared", out_of_scope=True)) is None


def test_publication_falsy_values_are_not_blank():  # Review Focus 1
    assert (
        display_value(_ev(value_num=0), _f(ExtractionFieldType.NUMBER), target="publication") == 0
    )
    assert (
        display_value(_ev(value_bool=False), _f(ExtractionFieldType.BOOLEAN), target="publication")
        == "No"
    )


def test_footnotes_fixed_order_only_used():
    assert publication_footnotes({"NE", "NI"}) == ("NI = No information", "NE = Not evaluated")
    assert publication_footnotes(set()) == ()
    assert publication_footnotes({SCOPE_MARKER, "NA"})[0] == "NA = Not applicable"
    assert publication_footnotes({SCOPE_MARKER})[0].startswith("NA* = ")
