"""Unit tests for the runtime schema builder (DB field rows → Pydantic models)."""

from types import SimpleNamespace
from typing import get_args, get_origin

import pytest
from pydantic import ValidationError

from app.llm.schema import (
    _PROPERTIES_PER_FIELD,
    OPENAI_STRICT_PROPERTY_BUDGET,
    Evidence,
    SchemaBuildError,
    _field_result_model,
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


def test_duplicate_field_names_fail_closed():
    et = _entity_type([_field(name="Notes"), _field(name="Notes")])
    with pytest.raises(SchemaBuildError, match="Notes"):
        build_output_models(et)


def test_unique_field_names_still_build():
    et = _entity_type([_field(name="A"), _field(name="B")])
    assert len(build_output_models(et)) == 1


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
                "evidence": [{"text": "We enrolled adults...", "page_number": 3}],
                "status": "found",
            }
        }
    )
    data = dump_extraction(instance)
    assert data["population"]["value"] == "adults with sepsis"
    assert data["population"]["confidence"] == 0.9
    assert data["population"]["evidence"][0]["page_number"] == 3


def test_value_may_be_null_when_not_found():
    [model] = build_output_models(_entity_type([_field()]))
    instance = model.model_validate(
        {
            "population": {
                "value": None,
                "confidence": 0.0,
                "reasoning": None,
                "evidence": [],
                "status": "not_found",
            }
        }
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
            {
                "risk": {
                    "value": "Medium",
                    "confidence": 0.5,
                    "reasoning": None,
                    "evidence": [],
                    "status": "found",
                }
            }
        )
    instance = model.model_validate(
        {
            "risk": {
                "value": "Low",
                "confidence": 0.5,
                "reasoning": None,
                "evidence": [],
                "status": "found",
            }
        }
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
                "evidence": [],
                "status": "found",
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
                    "evidence": [],
                    "status": "found",
                }
            }
        )


def test_confidence_out_of_range_rejected():
    [model] = build_output_models(_entity_type([_field()]))
    with pytest.raises(ValidationError):
        model.model_validate(
            {
                "population": {
                    "value": "x",
                    "confidence": 1.2,
                    "reasoning": None,
                    "evidence": [],
                    "status": "found",
                }
            }
        )


def test_number_and_boolean_types():
    fields = [
        _field(name="sample_size", field_type="number"),
        _field(name="multicentre", field_type="boolean"),
    ]
    [model] = build_output_models(_entity_type(fields))
    instance = model.model_validate(
        {
            "sample_size": {
                "value": 412,
                "confidence": 1.0,
                "reasoning": None,
                "evidence": [],
                "status": "found",
            },
            "multicentre": {
                "value": True,
                "confidence": 1.0,
                "reasoning": None,
                "evidence": [],
                "status": "found",
            },
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
                "evidence": [],
                "status": "found",
            }
        }
    )
    assert "sample size (n)" in dump_extraction(instance)


def test_chunking_splits_large_templates():
    n_fields = 30
    fields = [_field(name=f"field_{i}") for i in range(n_fields)]
    models = build_output_models(_entity_type(fields))
    assert len(models) >= 2
    per_chunk = OPENAI_STRICT_PROPERTY_BUDGET // _PROPERTIES_PER_FIELD
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
                    "evidence": [],
                    "status": "found",
                },
                "hallucinated": {
                    "value": "y",
                    "confidence": 0.5,
                    "reasoning": None,
                    "evidence": [],
                    "status": "found",
                },
            }
        )


def test_required_field_hint_lands_in_schema_description():
    [model] = build_output_models(_entity_type([_field(name="population", is_required=True)]))
    prop = model.model_json_schema(by_alias=True)["properties"]["population"]
    assert "Required field" in prop["description"]


def test_duplicate_field_names_fail_closed_across_types():
    # Even when the duplicates differ in type, the name collision fails closed
    # rather than silently dropping the earlier field (the former last-win bug).
    first = _field(name="risk", field_type="text")
    second = _field(
        name="risk",
        field_type="select",
        allowed_values={"options": [{"value": "Low"}, {"value": "High"}]},
    )
    with pytest.raises(SchemaBuildError, match="risk"):
        build_output_models(_entity_type([first, second]))


def test_json_schema_satisfies_strict_mode_contract():
    field = _field(
        name="risk",
        field_type="select",
        allowed_values={"options": [{"value": "Low"}, {"value": "High"}]},
    )
    [model] = build_output_models(_entity_type([field, _field(name="population")]))
    schema = model.model_json_schema(by_alias=True)

    assert schema["additionalProperties"] is False
    assert sorted(schema["required"]) == ["population", "risk"]

    defs = schema["$defs"]
    for sub_schema in defs.values():
        assert sub_schema["additionalProperties"] is False
        assert sorted(sub_schema["required"]) == sorted(sub_schema["properties"].keys())

    risk_def_name = schema["properties"]["risk"]["$ref"].rsplit("/", 1)[-1]
    risk_value = defs[risk_def_name]["properties"]["value"]
    assert {"Low", "High"}.issubset(set(risk_value["anyOf"][0]["enum"]))
    assert schema["properties"]["risk"]["description"] == "desc"


def test_integer_and_bare_list_type_mappings():
    fields = [
        _field(name="n_events", field_type="integer"),
        _field(name="keywords", field_type="list"),
    ]
    [model] = build_output_models(_entity_type(fields))
    instance = model.model_validate(
        {
            "n_events": {
                "value": 17,
                "confidence": 1.0,
                "reasoning": None,
                "evidence": [],
                "status": "found",
            },
            "keywords": {
                "value": ["sepsis", "icu"],
                "confidence": 0.9,
                "reasoning": None,
                "evidence": [],
                "status": "found",
            },
        }
    )
    data = dump_extraction(instance)
    assert data["n_events"]["value"] == 17
    assert data["keywords"]["value"] == ["sepsis", "icu"]


def test_empty_allowed_values_falls_back_to_scalar():
    field = _field(name="risk", field_type="select", allowed_values=[])
    [model] = build_output_models(_entity_type([field]))
    instance = model.model_validate(
        {
            "risk": {
                "value": "anything goes",
                "confidence": 0.5,
                "reasoning": None,
                "evidence": [],
                "status": "found",
            }
        }
    )
    assert dump_extraction(instance)["risk"]["value"] == "anything goes"


def test_llm_description_preferred_when_both_set():
    field = _field(name="population", llm_description="llm hint", description="human note")
    [model] = build_output_models(_entity_type([field]))
    prop = model.model_json_schema(by_alias=True)["properties"]["population"]
    assert prop["description"] == "llm hint"


# ---------------------------------------------------------------------------
# Task 1: evidence is list[Evidence]
# ---------------------------------------------------------------------------


def _field_bare(name="primary_outcome", field_type="text", required=True):
    class _F:  # minimal duck-typed extraction_fields row
        pass

    f = _F()
    f.name = name
    f.label = name
    f.field_type = field_type
    f.allowed_values = None
    f.is_required = required
    f.llm_description = None
    f.description = None
    return f


def test_field_result_evidence_is_list_of_evidence():
    model = _field_result_model(_field_bare(), index=0)
    ann = model.model_fields["evidence"].annotation
    assert get_origin(ann) is list, f"evidence must be a list, got {ann!r}"
    assert get_args(ann) == (Evidence,), f"list item must be Evidence, got {get_args(ann)!r}"


def test_field_result_keeps_status_field():
    model = _field_result_model(_field_bare(), index=0)
    assert "status" in model.model_fields, "P0 status field must be preserved"


def _entity_with_one_field():
    class _E:
        pass

    e = _E()
    e.id = "et-1"
    e.fields = [_field_bare()]
    return e


def test_dump_extraction_emits_evidence_list():
    [model] = build_output_models(_entity_with_one_field())
    instance = model.model_validate(
        {
            "primary_outcome": {
                "value": "OS",
                "confidence": 0.9,
                "reasoning": "stated",
                "status": "found",
                "evidence": [
                    {"text": "overall survival", "page_number": 3},
                    {"text": "OS was the primary endpoint", "page_number": 3},
                ],
            }
        }
    )
    dumped = dump_extraction(instance)
    ev = dumped["primary_outcome"]["evidence"]
    assert isinstance(ev, list) and len(ev) == 2
    assert ev[0]["text"] == "overall survival"
