"""The verify pass and the entailment judge call the model through the
injected ``StructuredCall``, so one fake drives every model call the
AI-extraction pipeline makes."""

from unittest.mock import MagicMock

import pytest

from app.llm import entailment, verify
from app.llm.entailment import gate_evidence
from app.llm.verify import run_verify_pass
from tests.fakes.recorded_llm import RecordedLlm

pytestmark = pytest.mark.asyncio


async def test_the_verify_pass_asks_through_the_injected_call() -> None:
    fake = RecordedLlm(verdicts={"dose": "unsupported", "drug": "confirmed"})

    outcome = await run_verify_pass(
        pdf_text="They used metformin.",
        entity_type_label="Intervention",
        proposals=[("drug", "Drug", "metformin")],
        model=MagicMock(),
        logger=MagicMock(),
        extract=fake,
    )

    assert outcome is not None
    verdicts, usage = outcome
    # Only the asked field is answered: the fake replies per proposed key.
    assert verdicts == {"drug": "confirmed"}
    assert usage.total_tokens == 15
    assert [c.prompt_name for c in fake.calls] == [verify.NAME]
    assert "- drug: Drug = metformin" in fake.calls[0].user_prompt


async def test_the_entailment_judge_asks_through_the_injected_call() -> None:
    fake = RecordedLlm(entailment="weak")

    label = await gate_evidence(
        field_label="drug",
        value="metformin",
        premise="They used a biguanide.",
        model=MagicMock(),
        extract=fake,
    )

    assert label == "weak"
    assert [c.prompt_name for c in fake.calls] == [entailment.NAME]
    assert 'CLAIM: "drug = metformin"' in fake.calls[0].user_prompt
