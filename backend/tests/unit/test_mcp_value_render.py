"""`get_extractions` detailed-row values: one envelope peel shared with the
export resolver, rendered as a typed `McpValue` with labels and units."""

from __future__ import annotations

from typing import Any
from uuid import uuid4

import pytest

from app.services.exports.value_envelope import PeeledValue, peel_envelope
from app.services.mcp_value_render import McpFieldInfo, mcp_value
from app.services.value_semantics import ABSENT_REASON_LABELS


def _field(field_type: str, *, options: dict[str, str] | None = None, unit: str | None = None):
    return McpFieldInfo(
        field_id=uuid4(),
        et_id=uuid4(),
        label="Q",
        field_type=field_type,
        options=options or {},
        unit=unit,
    )


def _render(raw: Any, field: McpFieldInfo, *, text_cap: int = 1_000) -> dict[str, Any]:
    return mcp_value(raw, field, text_cap=text_cap).model_dump(mode="json")


_SELECT = _field("select", options={"dev": "Development only", "Yes": "Yes"})
_MULTI = _field("multiselect", options={"a": "Alpha", "b": "Beta"})
_NUMBER = _field("number", unit="mg")


@pytest.mark.parametrize(
    ("raw", "field", "expected"),
    [
        (None, _field("text"), {"value": None}),
        ({"value": None}, _field("text"), {"value": None}),
        ({"value": 22.0}, _NUMBER, {"value": 22, "unit": "mg"}),
        ({"value": "22"}, _NUMBER, {"value": 22, "unit": "mg"}),
        ({"value": "22.5"}, _NUMBER, {"value": 22.5, "unit": "mg"}),
        ({"value": 5, "unit": "g"}, _NUMBER, {"value": 5, "unit": "g"}),
        ({"value": 5}, _NUMBER, {"value": 5, "unit": "mg"}),
        ({"value": {"value": 22, "unit": "mg"}}, _NUMBER, {"value": 22, "unit": "mg"}),
        ({"value": "22"}, _field("number"), {"value": 22}),
        ({"value": "n/a"}, _field("number"), {"value": "n/a"}),
        ({"value": "dev"}, _SELECT, {"value": "dev", "label": "Development only"}),
        ({"value": "Yes"}, _SELECT, {"value": "Yes"}),
        ({"value": "unknown"}, _SELECT, {"value": "unknown"}),
        (
            {"value": {"selected": "other", "other_text": "Registry"}},
            _SELECT,
            {"value": "other", "other_text": "Registry"},
        ),
        ({"value": ["a", "b"]}, _MULTI, {"value": ["a", "b"], "label": ["Alpha", "Beta"]}),
        ({"value": ["a", "zz"]}, _MULTI, {"value": ["a", "zz"], "label": ["Alpha", "zz"]}),
        ({"value": ["zz"]}, _MULTI, {"value": ["zz"]}),
        (
            {"value": {"selected": ["a", "other"], "other_texts": ["Cohort", "", None]}},
            _MULTI,
            {"value": ["a", "other"], "label": ["Alpha", "other"], "other_text": "Cohort"},
        ),
        ({"value": True}, _field("boolean"), {"value": True}),
        ({"value": {"x": 1}}, _field("text"), {"value": "{'x': 1}"}),
    ],
    ids=[
        "none",
        "null-envelope",
        "whole-float",
        "numeric-string",
        "decimal-string",
        "envelope-unit-wins",
        "field-unit-fallback",
        "double-wrap",
        "no-unit-anywhere",
        "non-numeric-string-on-number",
        "select-label",
        "select-label-equals-code",
        "select-unknown-code",
        "select-other",
        "multiselect-labels",
        "multiselect-partial-labels",
        "multiselect-unknown-only",
        "multiselect-other",
        "boolean",
        "unknown-dict",
    ],
)
def test_mcp_value_renders(raw: Any, field: McpFieldInfo, expected: dict[str, Any]) -> None:
    assert _render(raw, field) == expected


@pytest.mark.parametrize("code", ["no_information", "not_applicable", "not_evaluated"])
def test_markers_read_null_with_coded_reason(code: str) -> None:
    rendered = _render({"value": None, "absent_reason": code}, _NUMBER)
    assert rendered == {
        "value": None,
        "absent_reason": code,
        "label": ABSENT_REASON_LABELS[code],
    }


def test_long_text_is_capped_and_flagged() -> None:
    rendered = _render({"value": "x" * 120}, _field("text"), text_cap=80)
    assert rendered == {"value": "x" * 80, "truncated": True}


def test_text_at_the_cap_is_not_flagged() -> None:
    assert _render({"value": "x" * 80}, _field("text"), text_cap=80) == {"value": "x" * 80}


def test_peel_strips_verification() -> None:
    raw = {"value": 22, "unit": "mg", "verification": {"verdict": "supported"}}
    assert peel_envelope(raw) == PeeledValue(value=22, unit="mg", absent_reason=None)


def test_peel_finds_a_marker_inside_a_double_wrap() -> None:
    raw = {"value": {"value": None, "absent_reason": "not_applicable"}}
    assert peel_envelope(raw) == PeeledValue(value=None, unit=None, absent_reason="not_applicable")


def test_peel_keeps_the_outermost_unit() -> None:
    raw = {"value": {"value": 5, "unit": "g"}, "unit": "mg"}
    assert peel_envelope(raw) == PeeledValue(value=5, unit="mg", absent_reason=None)


def test_peel_none() -> None:
    assert peel_envelope(None) == PeeledValue(value=None, unit=None, absent_reason=None)


_LONG_SELECT = _field("select", options={"c" * 50: "L" * 120})


@pytest.mark.parametrize(
    ("raw", "field", "expected"),
    [
        (
            {"value": "c" * 50},
            _LONG_SELECT,
            {"value": "c" * 50, "label": "L" * 80, "truncated": True},
        ),
        (
            {"value": "z" * 120},
            _SELECT,
            {"value": "z" * 80, "truncated": True},
        ),
        (
            {"value": ["x" * 30, "y" * 30, "w" * 30]},
            _field("text"),
            {"value": ["x" * 30, "y" * 30, "w" * 20], "truncated": True},
        ),
        (
            {"value": ["a", "b"]},
            _field("multiselect", options={"a": "A" * 50, "b": "B" * 50}),
            {"value": ["a", "b"], "label": ["A" * 50, "B" * 30], "truncated": True},
        ),
        (
            {"value": {"selected": ["c" * 50], "other_texts": []}},
            _LONG_SELECT,
            {"value": ["c" * 50], "label": ["L" * 80], "truncated": True},
        ),
        (
            {"value": {"selected": "other", "other_text": "t" * 120}},
            _SELECT,
            {"value": "other", "other_text": "t" * 80, "truncated": True},
        ),
        (
            {"value": {"selected": ["a"], "other_texts": ["t" * 120]}},
            _MULTI,
            {"value": ["a"], "label": ["Alpha"], "other_text": "t" * 80, "truncated": True},
        ),
    ],
    ids=[
        "select-label",
        "select-code",
        "text-list",
        "multiselect-labels",
        "multiselect-other-labels",
        "select-other-text",
        "multiselect-other-text",
    ],
)
def test_every_string_branch_is_capped(raw: Any, field: McpFieldInfo, expected: dict) -> None:
    assert _render(raw, field, text_cap=80) == expected
