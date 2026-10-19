"""Tests for status (abstention) field in per-field LLM output schema."""

import pytest

from app.llm.schema import build_output_models


class _F:
    def __init__(self, name):
        self.name = name
        self.field_type = "text"
        self.is_required = False
        self.allowed_values = None
        self.llm_description = None
        self.description = None


class _ET:
    def __init__(self, fields):
        self.fields = fields


def test_field_model_has_status():
    [model] = build_output_models(_ET([_F("dose")]))
    assert "status" in model.model_fields["field_0"].annotation.model_fields


def test_fields_override_is_used_instead_of_entity_fields():
    """``fields`` overrides the entity's own collection — this is how callers
    send the LLM a subset (skip human-settled fields) WITHOUT mutating the
    delete-orphan-cascaded ``entity_type.fields`` relationship."""
    et = _ET([_F("dose"), _F("route")])
    [model] = build_output_models(et, fields=[_F("dose")])
    assert set(model.model_fields) == {"field_0"}
    assert model.model_fields["field_0"].alias == "dose"


def test_empty_fields_override_skips_llm():
    """An explicit empty override returns no models (caller skips the LLM),
    distinct from falling back to the entity's own non-empty fields."""
    et = _ET([_F("dose")])
    assert build_output_models(et, fields=[]) == []


def test_evidence_item_schema_is_block_ref_and_quote():
    """The model cites a block ref and a quote; it never supplies a page."""
    [model] = build_output_models(_ET([_F("dose")]))
    schema = model.model_json_schema()
    item = schema["$defs"]["Evidence"]
    assert set(item["properties"]) == {"block_ref", "quote"}
    assert set(item["required"]) == {"block_ref", "quote"}


def test_chunk_holds_eleven_fields():
    """Nine budgeted properties per field (absent_reason included even when a
    field omits it): 100 // 9 = 11 fields per call."""
    from app.llm import schema as llm_schema

    assert llm_schema._PROPERTIES_PER_FIELD == 9
    models = build_output_models(_ET([_F(f"f{i}") for i in range(23)]))
    assert [len(m.model_fields) for m in models] == [11, 11, 1]


def _flagged(*, ni: bool, na: bool, ne: bool = False, values=None) -> _F:
    field = _F("q")
    field.allows_no_information = ni
    field.allows_not_applicable = na
    field.allows_not_evaluated = ne
    field.allowed_values = values
    return field


def _field_schema(field: _F) -> dict:
    [model] = build_output_models(_ET([field]))
    return model.model_fields["field_0"].annotation.model_json_schema()


def _absent_enum(schema: dict) -> set[str] | None:
    prop = schema["properties"].get("absent_reason")
    if prop is None:
        return None
    # A one-code Literal renders as ``const``, several as ``enum``.
    [branch] = [b for b in prop["anyOf"] if b.get("type") != "null"]
    return set(branch["enum"]) if "enum" in branch else {branch["const"]}


@pytest.mark.parametrize(
    ("ni", "na", "expected"),
    [
        (True, True, {"no_information", "not_applicable"}),
        (True, False, {"no_information"}),
        (False, True, {"not_applicable"}),
        (False, False, None),
    ],
    ids=["both", "ni-only", "na-only", "none"],
)
def test_absent_reason_enum_follows_flags(ni, na, expected):
    schema = _field_schema(_flagged(ni=ni, na=na, ne=True))
    assert _absent_enum(schema) == expected
    assert "not_evaluated" not in str(schema)
    if expected is not None:
        assert "absent_reason" in schema["required"]


@pytest.mark.parametrize("unclear", ["Unclear", "unclear"])
def test_uncertainty_scale_drops_not_found_and_no_information(unclear):
    field = _flagged(ni=True, na=True, values=["Low", "High", unclear])
    schema = _field_schema(field)
    assert set(schema["properties"]["status"]["enum"]) == {"found", "ambiguous"}
    assert "not_found" not in schema["properties"]["status"]["description"]
    assert _absent_enum(schema) == {"not_applicable"}


def test_non_scale_keeps_three_statuses():
    schema = _field_schema(_flagged(ni=True, na=False, values=["Yes", "No"]))
    assert set(schema["properties"]["status"]["enum"]) == {"found", "not_found", "ambiguous"}


def test_offered_absent_codes_and_scale_detection():
    from app.llm.schema import is_uncertainty_scale, offered_absent_codes

    scale = _flagged(ni=True, na=True, values=["Low", "UNCLEAR"])
    assert is_uncertainty_scale(scale)
    assert offered_absent_codes(scale) == ("not_applicable",)
    plain = _flagged(ni=True, na=True, values=["Unclearly"])
    assert not is_uncertainty_scale(plain)
    assert offered_absent_codes(plain) == ("no_information", "not_applicable")
    # A field object without the flags (an older reader) offers nothing.
    assert offered_absent_codes(_F("x")) == ()
