"""The write-time value contract (pure, no DB).

Every rule of ``canonicalize_value`` has one case here, and every value shape
the reviewer UI sends today is accepted for its field (``UI_SHAPES``).
"""

from __future__ import annotations

from typing import Any
from uuid import uuid4

import pytest

from app.core.error_handler import AppError
from app.schemas.extraction_run import RunViewField
from app.services.value_contract import ValueContractError, canonicalize_value

_SELECT_OPTIONS = [
    {"value": "dev", "label": "Development only"},
    {"value": "val", "label": "Validation"},
    {"value": "Y", "label": "Yes"},
    {"value": "A", "label": "A"},
    {"value": "B", "label": "B"},
]


def _field(field_type: str, **over: Any) -> RunViewField:
    return RunViewField.model_validate(
        {
            "id": uuid4(),
            "name": "f",
            "label": "F",
            "is_required": False,
            "sort_order": 0,
            "field_type": field_type,
            **over,
        }
    )


def _reason(raw: Any, field: RunViewField) -> str:
    with pytest.raises(ValueContractError) as raised:
        canonicalize_value(raw, field)
    assert raised.value.details is not None
    return str(raised.value.details["reason"])


_NUMBER_MG = {"unit": "mg", "allowed_units": ["mg", "g"]}


# --- Rule 1: envelope ---------------------------------------------------------


def test_double_wrapped_number_with_unit_is_merged_up() -> None:
    field = _field("number", **_NUMBER_MG)
    assert canonicalize_value({"value": {"value": "22", "unit": "mg"}}, field) == {
        "value": 22,
        "unit": "mg",
    }


def test_extra_envelope_key_is_malformed() -> None:
    assert _reason({"value": 1, "extra": 2}, _field("number")) == "MALFORMED_ENVELOPE"


def test_bare_value_is_malformed() -> None:
    assert _reason("bare", _field("text")) == "MALFORMED_ENVELOPE"


def test_dict_without_value_key_is_malformed() -> None:
    assert _reason({"unit": "mg"}, _field("number")) == "MALFORMED_ENVELOPE"


def test_triple_wrap_is_malformed() -> None:
    raw = {"value": {"value": {"value": "22"}}}
    assert _reason(raw, _field("number")) == "MALFORMED_ENVELOPE"


def test_inner_envelope_with_extra_key_is_malformed() -> None:
    raw = {"value": {"value": "22", "extra": 1}}
    assert _reason(raw, _field("number")) == "MALFORMED_ENVELOPE"


# --- Rules 2-3: disposition and absent marker ---------------------------------


def test_na_marker_refused_when_field_disallows() -> None:
    raw = {"value": None, "absent_reason": "not_applicable"}
    assert _reason(raw, _field("number", allows_not_applicable=False)) == "MARKER_NOT_ALLOWED"


def test_na_marker_accepted_when_field_allows() -> None:
    raw = {"value": None, "absent_reason": "not_applicable"}
    assert canonicalize_value(raw, _field("number", allows_not_applicable=True)) == raw


def test_unknown_absent_reason_is_refused() -> None:
    raw = {"value": None, "absent_reason": "bogus"}
    assert _reason(raw, _field("text")) == "MARKER_NOT_ALLOWED"


def test_marker_with_a_value_is_refused() -> None:
    raw = {"value": "x", "absent_reason": "no_information"}
    assert _reason(raw, _field("text")) == "MARKER_NOT_ALLOWED"


def test_no_information_marker_refused_when_field_opts_out() -> None:
    raw = {"value": None, "absent_reason": "no_information"}
    assert _reason(raw, _field("text", allows_no_information=False)) == "MARKER_NOT_ALLOWED"


def test_null_absent_reason_means_no_marker() -> None:
    raw = {"value": "x", "absent_reason": None}
    assert canonicalize_value(raw, _field("text")) == {"value": "x"}


def test_in_band_na_option_becomes_the_marker() -> None:
    field = _field(
        "select",
        allowed_values=[{"value": "Y", "label": "Yes"}, {"value": "NA", "label": "NA"}],
        allows_not_applicable=True,
    )
    assert canonicalize_value({"value": "NA"}, field) == {
        "value": None,
        "absent_reason": "not_applicable",
    }


# --- Rule 4: cleared ----------------------------------------------------------


@pytest.mark.parametrize(
    ("field_type", "raw"),
    [("text", None), ("select", None), ("number", ""), ("date", "")],
    ids=["text-none", "select-none", "number-empty", "date-empty"],
)
def test_cleared_value_is_stored_as_null(field_type: str, raw: Any) -> None:
    assert canonicalize_value({"value": raw}, _field(field_type)) == {"value": None}


# --- Rule 5: per field type ---------------------------------------------------


def test_numeric_string_is_stored_as_int() -> None:
    assert canonicalize_value({"value": "22"}, _field("number")) == {"value": 22}


def test_fractional_number_stays_float() -> None:
    assert canonicalize_value({"value": 22.5}, _field("number")) == {"value": 22.5}


def test_whole_float_is_stored_as_int() -> None:
    result = canonicalize_value({"value": 3.0}, _field("number"))
    assert result == {"value": 3}
    assert isinstance(result["value"], int)


@pytest.mark.parametrize("raw", [2**53 + 1, str(2**53 + 1)], ids=["int", "integer-string"])
def test_large_integers_are_stored_exactly(raw: Any) -> None:
    result = canonicalize_value({"value": raw}, _field("number"))
    assert result == {"value": 9007199254740993}
    assert isinstance(result["value"], int)


@pytest.mark.parametrize(
    "raw",
    ["abc", float("inf"), True, "nan", [1]],
    ids=["text", "inf", "bool", "nan-string", "list"],
)
def test_non_number_is_refused(raw: Any) -> None:
    assert _reason({"value": raw}, _field("number")) == "NOT_A_NUMBER"


def test_unit_outside_allowed_units_is_refused() -> None:
    raw = {"value": "5", "unit": "kg"}
    assert _reason(raw, _field("number", **_NUMBER_MG)) == "UNIT_NOT_ALLOWED"


def test_unit_equal_to_field_unit_is_kept() -> None:
    field = _field("number", unit="mg")
    assert canonicalize_value({"value": 5, "unit": "mg"}, field) == {"value": 5, "unit": "mg"}


def test_none_unit_is_dropped() -> None:
    field = _field("number", unit="mg")
    assert canonicalize_value({"value": 5, "unit": None}, field) == {"value": 5}


def test_select_option_code_is_accepted() -> None:
    field = _field("select", allowed_values=_SELECT_OPTIONS)
    assert canonicalize_value({"value": "dev"}, field) == {"value": "dev"}


def test_select_label_is_not_an_option() -> None:
    field = _field("select", allowed_values=_SELECT_OPTIONS)
    assert _reason({"value": "Development only"}, field) == "NOT_AN_OPTION"


def test_select_other_refused_without_allow_other() -> None:
    field = _field("select", allowed_values=_SELECT_OPTIONS, allow_other=False)
    raw = {"value": {"selected": "other", "other_text": "Registry"}}
    assert _reason(raw, field) == "NOT_AN_OPTION"


def test_multiselect_duplicates_are_refused() -> None:
    field = _field("multiselect", allowed_values=_SELECT_OPTIONS)
    assert _reason({"value": ["A", "A"]}, field) == "NOT_AN_OPTION"


def test_multiselect_drops_empty_strings() -> None:
    field = _field("multiselect", allowed_values=_SELECT_OPTIONS)
    assert canonicalize_value({"value": ["A", "", "B"]}, field) == {"value": ["A", "B"]}


def test_multiselect_other_drops_empty_other_texts() -> None:
    field = _field("multiselect", allowed_values=_SELECT_OPTIONS, allow_other=True)
    raw = {"value": {"selected": ["A"], "other_texts": ["", "x"]}}
    assert canonicalize_value(raw, field) == {"value": {"selected": ["A"], "other_texts": ["x"]}}


def test_multiselect_unknown_code_is_refused() -> None:
    field = _field("multiselect", allowed_values=_SELECT_OPTIONS)
    assert _reason({"value": ["A", "zzz"]}, field) == "NOT_AN_OPTION"


def test_impossible_date_is_refused() -> None:
    assert _reason({"value": "2024-02-30"}, _field("date")) == "NOT_A_DATE"


def test_non_iso_date_is_refused() -> None:
    assert _reason({"value": "20240131"}, _field("date")) == "NOT_A_DATE"


def test_boolean_string_is_refused() -> None:
    assert _reason({"value": "true"}, _field("boolean")) == "NOT_A_BOOLEAN"


def test_text_number_is_refused() -> None:
    assert _reason({"value": 5}, _field("text")) == "NOT_TEXT"


# --- Error shape --------------------------------------------------------------


def test_error_shape_names_field_and_reason_without_echoing_value() -> None:
    field = _field("select", label="Study type", allowed_values=_SELECT_OPTIONS)
    with pytest.raises(ValueContractError) as raised:
        canonicalize_value({"value": "secret-raw-value"}, field)
    exc = raised.value
    assert isinstance(exc, AppError)
    assert exc.code == "VALUE_CONTRACT_VIOLATION"
    assert exc.status_code == 422
    assert exc.details == {"field_id": str(field.id), "reason": "NOT_AN_OPTION"}
    assert "Study type" in exc.message
    assert "secret-raw-value" not in exc.message


# --- Every shape the reviewer UI sends today ----------------------------------

_NUMBER = _field("number", **_NUMBER_MG)
_SELECT = _field("select", allowed_values=_SELECT_OPTIONS, allow_other=True)
_MULTI = _field("multiselect", allowed_values=_SELECT_OPTIONS)
_MULTI_OTHER = _field("multiselect", allowed_values=_SELECT_OPTIONS, allow_other=True)

UI_SHAPES: list[tuple[dict[str, Any], RunViewField]] = [
    # FieldValueEditor number input: a numeric string.
    ({"value": "22"}, _NUMBER),
    # FieldValueEditor number input with a unit (useAutoSaveProposals wraps once more).
    ({"value": {"value": "22", "unit": "mg"}}, _NUMBER),
    # Any cleared field (useRunValues writeValue with an empty input).
    ({"value": None}, _field("text")),
    # SelectWithOther: a plain option.
    ({"value": "Y"}, _SELECT),
    # SelectWithOther: "Other" picked, text not typed yet.
    ({"value": {"selected": "other", "other_text": ""}}, _SELECT),
    # SelectWithOther: "Other" with its text.
    ({"value": {"selected": "other", "other_text": "Registry"}}, _SELECT),
    # MultiSelectWithOther without allow_other: a bare list of codes.
    ({"value": ["A", "B"]}, _MULTI),
    # MultiSelectWithOther with allow_other: an empty other text while typing.
    ({"value": {"selected": ["A"], "other_texts": [""]}}, _MULTI_OTHER),
    # MultiSelectWithOther with allow_other: only an other text.
    ({"value": {"selected": [], "other_texts": ["x"]}}, _MULTI_OTHER),
    # Boolean switch.
    ({"value": True}, _field("boolean")),
    # Date input.
    ({"value": "2024-01-31"}, _field("date")),
    # Text input.
    ({"value": "free text"}, _field("text")),
    # FieldInput marker button.
    ({"value": None, "absent_reason": "no_information"}, _field("text")),
]


@pytest.mark.parametrize(("raw", "field"), UI_SHAPES, ids=[str(i) for i in range(len(UI_SHAPES))])
def test_every_ui_shape_is_accepted(raw: dict[str, Any], field: RunViewField) -> None:
    result = canonicalize_value(raw, field)
    assert "value" in result
