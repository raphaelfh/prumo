"""Unit tests for ModelIdentificationPrompt.

Pins the contract:

* Prompt mentions the container label (for grounding) but no internal
  field names — that's the whole point of the decoupling.
* Response schema requires only ``name`` (no field-name coupling).
* Parser normalizes legacy + new key formats during rollout.
"""
from app.services.llm.model_identification_prompt import (
    MODEL_IDENTIFICATION_RESPONSE_SCHEMA,
    ModelIdentificationPrompt,
    parse_models_from_response,
)


def test_prompt_mentions_container_label_for_grounding():
    out = ModelIdentificationPrompt.build(
        container_label="Prediction Models",
        pdf_text="A study of mortality.",
    )
    assert "Prediction Models" in out
    # No internal field-name coupling:
    assert "model_name" not in out
    assert "model_type" not in out
    assert "target_outcome" not in out


def test_prompt_truncates_long_pdf_text():
    long_text = "X" * 100_000  # uppercase so the frame text doesn't collide
    out = ModelIdentificationPrompt.build(
        container_label="Models",
        pdf_text=long_text,
    )
    # Only the first 15_000 chars of PDF text reach the prompt.
    assert out.count("X") == 15_000


def test_response_schema_only_requires_name():
    schema = MODEL_IDENTIFICATION_RESPONSE_SCHEMA
    assert schema["properties"]["models"]["items"]["required"] == ["name"]


def test_parser_extracts_names_only():
    response = '{"models": [{"name": "Logistic regression model"}, {"name": "XGBoost"}]}'
    models = parse_models_from_response(response)
    assert [m["name"] for m in models] == ["Logistic regression model", "XGBoost"]


def test_parser_tolerates_legacy_model_name_key():
    response = '{"models": [{"model_name": "Legacy"}]}'
    models = parse_models_from_response(response)
    assert models[0].get("name") == "Legacy"


def test_parser_returns_empty_list_on_empty_response():
    response = '{"models": []}'
    assert parse_models_from_response(response) == []


def test_parser_returns_empty_list_on_invalid_json():
    assert parse_models_from_response("not json") == []


def test_parser_skips_entries_without_a_name():
    response = '{"models": [{"name": "Good"}, {"foo": "bar"}, {"name": ""}]}'
    models = parse_models_from_response(response)
    assert [m["name"] for m in models] == ["Good"]
