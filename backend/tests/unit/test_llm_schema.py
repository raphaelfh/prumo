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
