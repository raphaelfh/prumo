"""Tests for status (abstention) field in per-field LLM output schema."""

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


def test_per_field_property_count_for_chunking_is_still_eight():
    from app.llm import schema as llm_schema

    assert llm_schema._PROPERTIES_PER_FIELD == 8
    # 100 // 8 = 12 fields per call: 13 fields split into two chunks.
    models = build_output_models(_ET([_F(f"f{i}") for i in range(13)]))
    assert [len(m.model_fields) for m in models] == [12, 1]
