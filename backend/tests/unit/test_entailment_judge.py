"""Entailment judge — unit tests (no network).

TestModel(custom_output_args=...) requires ToolOutput, not NativeOutput; since
extract_structured routes TestModel (system='test') to NativeOutput the brief's
original test double doesn't work. We use FunctionModel instead — same pattern
as tests/unit/llm/test_extractor.py — which returns a JSON text that NativeOutput
parses correctly. The test intent is preserved: judge_entailment with a test
double that returns label='entailed' must yield a verdict with label == 'entailed'.
"""

import json

import pytest
from pydantic_ai import ModelResponse, TextPart
from pydantic_ai.models.function import AgentInfo, FunctionModel

from app.llm.entailment import judge_entailment


def _canned_verdict(label: str, rationale: str | None) -> FunctionModel:
    """Return a FunctionModel that always emits the given label/rationale JSON."""

    def respond(messages, info: AgentInfo) -> ModelResponse:  # noqa: ARG001
        return ModelResponse(parts=[TextPart(json.dumps({"label": label, "rationale": rationale}))])

    return FunctionModel(respond)


@pytest.mark.asyncio
async def test_judge_returns_label():
    model = _canned_verdict("entailed", "states the dose")
    v = await judge_entailment(
        field_label="dose",
        value="50 mg",
        premise="Patients got 50 mg twice daily.",
        model=model,
    )
    assert v.label == "entailed"


@pytest.mark.asyncio
async def test_judge_returns_rationale():
    model = _canned_verdict("weak", "tangentially related")
    v = await judge_entailment(
        field_label="dose",
        value="50 mg",
        premise="The study used a low dose.",
        model=model,
    )
    assert v.label == "weak"
    assert v.rationale == "tangentially related"


@pytest.mark.asyncio
async def test_judge_unsupported_with_null_rationale():
    model = _canned_verdict("unsupported", None)
    v = await judge_entailment(
        field_label="endpoint",
        value="overall survival",
        premise="Recruitment procedures were described.",
        model=model,
    )
    assert v.label == "unsupported"
    assert v.rationale is None
