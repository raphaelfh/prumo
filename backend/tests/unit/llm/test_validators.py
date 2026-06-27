"""Semantic validators raise ModelRetry so the model corrects itself."""

from types import SimpleNamespace

import pytest
from pydantic_ai import ModelRetry

from app.llm.schema import build_output_models
from app.llm.validators import evidence_is_plausible


def _instance(evidence):
    field = SimpleNamespace(
        name="population",
        field_type="text",
        llm_description="d",
        description=None,
        allowed_values=None,
        is_required=False,
    )
    [model] = build_output_models(SimpleNamespace(name="s", description="", fields=[field]))
    return model.model_validate(
        {
            "population": {
                "value": "x",
                "confidence": 0.5,
                "reasoning": None,
                "evidence": evidence,
                "status": "found",
            }
        }
    )


def test_passes_with_no_evidence():
    output = _instance(None)
    assert evidence_is_plausible(output) is output


def test_passes_with_plausible_evidence():
    output = _instance({"text": "We enrolled adults.", "page_number": 2})
    assert evidence_is_plausible(output) is output


def test_rejects_blank_evidence_text():
    with pytest.raises(ModelRetry, match="population"):
        evidence_is_plausible(_instance({"text": "   ", "page_number": 2}))


def test_rejects_non_positive_page_number():
    with pytest.raises(ModelRetry, match="page_number"):
        evidence_is_plausible(_instance({"text": "quote", "page_number": 0}))
