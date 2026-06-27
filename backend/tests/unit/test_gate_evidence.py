"""gate_evidence — unit tests (no network).

The brief's test_text_value_uses_judge uses TestModel(custom_output_args=...),
which does NOT work through this project's NativeOutput path (same issue as
test_entailment_judge.py). We use FunctionModel for all tests where the judge
is actually invoked, returning a JSON TextPart that NativeOutput parses correctly.
The numeric short-circuit test never reaches the judge so the model arg is unused;
we still pass a valid FunctionModel to stay consistent.
"""

import json

import pytest
from pydantic_ai import ModelResponse, TextPart
from pydantic_ai.models.function import AgentInfo, FunctionModel

from app.llm.entailment import gate_evidence


def _canned_label(label: str) -> FunctionModel:
    """Return a FunctionModel that always emits the given label JSON."""

    def respond(messages, info: AgentInfo) -> ModelResponse:  # noqa: ARG001
        return ModelResponse(parts=[TextPart(json.dumps({"label": label, "rationale": None}))])

    return FunctionModel(respond)


@pytest.mark.asyncio
async def test_numeric_absent_is_unsupported_without_calling_judge():
    # Judge would say entailed, but the number isn't in the premise -> unsupported.
    # Judge is never called; model arg is unused but must be a valid model object.
    model = _canned_label("entailed")
    label = await gate_evidence(
        field_label="dose", value="99 mg", premise="Patients got 50 mg.", model=model
    )
    assert label == "unsupported"


@pytest.mark.asyncio
async def test_text_value_uses_judge():
    model = _canned_label("weak")
    label = await gate_evidence(
        field_label="drug",
        value="metformin",
        premise="They used a biguanide.",
        model=model,
    )
    assert label == "weak"


@pytest.mark.asyncio
async def test_numeric_present_passes_to_judge():
    # Number IS in the premise, so numeric check passes; judge is called.
    model = _canned_label("entailed")
    label = await gate_evidence(
        field_label="dose",
        value="50 mg",
        premise="Patients got 50 mg twice daily.",
        model=model,
    )
    assert label == "entailed"
