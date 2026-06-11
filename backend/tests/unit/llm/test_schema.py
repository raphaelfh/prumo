"""Unit tests for the runtime schema builder (DB field rows → Pydantic models)."""

from types import SimpleNamespace

import pytest
from pydantic import ValidationError

from app.llm.schema import (
    OPENAI_STRICT_PROPERTY_BUDGET,
    build_output_models,
    dump_extraction,
)


def _field(
    name="population",
    field_type="text",
    llm_description="desc",
    description=None,
    allowed_values=None,
    is_required=False,
):
    return SimpleNamespace(
        name=name,
        field_type=field_type,
        llm_description=llm_description,
        description=description,
        allowed_values=allowed_values,
        is_required=is_required,
    )


def _entity_type(fields):
    return SimpleNamespace(name="study_section", description="A section", fields=fields)


def test_no_fields_returns_no_models():
    assert build_output_models(_entity_type([])) == []
    assert build_output_models(_entity_type(None)) == []


def test_text_field_round_trip():
    [model] = build_output_models(_entity_type([_field(name="population")]))
    instance = model.model_validate(
        {
            "population": {
                "value": "adults with sepsis",
                "confidence": 0.9,
                "reasoning": "stated in methods",
                "evidence": {"text": "We enrolled adults...", "page_number": 3},
            }
        }
    )
    data = dump_extraction(instance)
    assert data["population"]["value"] == "adults with sepsis"
    assert data["population"]["confidence"] == 0.9
    assert data["population"]["evidence"]["page_number"] == 3


def test_value_may_be_null_when_not_found():
    [model] = build_output_models(_entity_type([_field()]))
    instance = model.model_validate(
        {"population": {"value": None, "confidence": 0.0, "reasoning": None, "evidence": None}}
    )
    assert dump_extraction(instance)["population"]["value"] is None


def test_select_field_rejects_out_of_enum_value():
    field = _field(
        name="risk",
        field_type="select",
        allowed_values={"options": [{"value": "Low"}, {"value": "High"}]},
    )
    [model] = build_output_models(_entity_type([field]))
    with pytest.raises(ValidationError):
        model.model_validate(
            {"risk": {"value": "Medium", "confidence": 0.5, "reasoning": None, "evidence": None}}
        )
    instance = model.model_validate(
        {"risk": {"value": "Low", "confidence": 0.5, "reasoning": None, "evidence": None}}
    )
    assert dump_extraction(instance)["risk"]["value"] == "Low"


def test_multiselect_field_is_list_of_enum():
    field = _field(
        name="outcomes",
        field_type="multiselect",
        allowed_values=["mortality", "icu_stay"],
    )
    [model] = build_output_models(_entity_type([field]))
    instance = model.model_validate(
        {
            "outcomes": {
                "value": ["mortality"],
                "confidence": 0.8,
                "reasoning": None,
                "evidence": None,
            }
        }
    )
    assert dump_extraction(instance)["outcomes"]["value"] == ["mortality"]
    with pytest.raises(ValidationError):
        model.model_validate(
            {
                "outcomes": {
                    "value": ["weird"],
                    "confidence": 0.8,
                    "reasoning": None,
                    "evidence": None,
                }
            }
        )


def test_confidence_out_of_range_rejected():
    [model] = build_output_models(_entity_type([_field()]))
    with pytest.raises(ValidationError):
        model.model_validate(
            {"population": {"value": "x", "confidence": 1.2, "reasoning": None, "evidence": None}}
        )


def test_number_and_boolean_types():
    fields = [
        _field(name="sample_size", field_type="number"),
        _field(name="multicentre", field_type="boolean"),
    ]
    [model] = build_output_models(_entity_type(fields))
    instance = model.model_validate(
        {
            "sample_size": {"value": 412, "confidence": 1.0, "reasoning": None, "evidence": None},
            "multicentre": {"value": True, "confidence": 1.0, "reasoning": None, "evidence": None},
        }
    )
    data = dump_extraction(instance)
    assert data["sample_size"]["value"] == 412
    assert data["multicentre"]["value"] is True


def test_field_name_with_spaces_round_trips_via_alias():
    [model] = build_output_models(_entity_type([_field(name="sample size (n)")]))
    instance = model.model_validate(
        {
            "sample size (n)": {
                "value": "412",
                "confidence": 1.0,
                "reasoning": None,
                "evidence": None,
            }
        }
    )
    assert "sample size (n)" in dump_extraction(instance)


def test_chunking_splits_large_templates():
    n_fields = 30
    fields = [_field(name=f"field_{i}") for i in range(n_fields)]
    models = build_output_models(_entity_type(fields))
    assert len(models) >= 2
    per_chunk = OPENAI_STRICT_PROPERTY_BUDGET // 7
    total = sum(len(m.model_fields) for m in models)
    assert total == n_fields
    assert all(len(m.model_fields) <= per_chunk for m in models)


def test_extra_fields_forbidden():
    [model] = build_output_models(_entity_type([_field()]))
    with pytest.raises(ValidationError):
        model.model_validate(
            {
                "population": {
                    "value": "x",
                    "confidence": 0.5,
                    "reasoning": None,
                    "evidence": None,
                },
                "hallucinated": {
                    "value": "y",
                    "confidence": 0.5,
                    "reasoning": None,
                    "evidence": None,
                },
            }
        )
