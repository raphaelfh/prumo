"""The verify pass and the entailment judge call the model through the
injected ``StructuredCall``, so one fake drives every model call the
AI-extraction pipeline makes."""

from unittest.mock import MagicMock

import pytest

from app.llm import entailment, verify
from app.llm.entailment import GateSpec, gate_evidence, run_entailment_gate
from app.llm.extractor import LlmUsage, UsageLedgerWriteError
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

    label, usage = await gate_evidence(
        field_label="drug",
        value="metformin",
        premise="They used a biguanide.",
        model=MagicMock(),
        extract=fake,
    )

    assert label == "weak"
    assert usage == LlmUsage(10, 5, ["recorded-1"])
    assert [c.prompt_name for c in fake.calls] == [entailment.NAME]
    assert 'CLAIM: "drug = metformin"' in fake.calls[0].user_prompt


def _spec(value: str) -> GateSpec:
    return GateSpec(field_label="drug", value_str=value, quote=value, pos=None, anchor_blocks=[])


async def test_the_entailment_gate_sums_the_usage_of_its_judge_calls() -> None:
    fake = RecordedLlm(usages={entailment.NAME: LlmUsage(7, 1, ["e1"])})

    labels, usage = await run_entailment_gate(
        [_spec("metformin"), _spec("insulin")], MagicMock(), extract=fake
    )

    assert labels == ["entailed", "entailed"]
    assert usage == LlmUsage(14, 2, ["e1", "e1"])


async def test_a_raised_judge_degrades_to_none_and_contributes_no_usage() -> None:
    fake = RecordedLlm(fail={entailment.NAME: RuntimeError("judge down")})

    labels, usage = await run_entailment_gate([_spec("metformin")], MagicMock(), extract=fake)

    assert labels == [None]
    assert usage == LlmUsage()


async def test_a_ledger_write_failure_is_not_degraded_by_the_verify_pass() -> None:
    """The verify pass degrades on a model failure, never on a lost ledger
    row: a call whose usage could not be recorded fails the section."""
    fake = RecordedLlm(fail={verify.NAME: UsageLedgerWriteError("ledger down")})

    with pytest.raises(UsageLedgerWriteError):
        await run_verify_pass(
            pdf_text="They used metformin.",
            entity_type_label="Intervention",
            proposals=[("drug", "Drug", "metformin")],
            model=MagicMock(),
            logger=MagicMock(),
            extract=fake,
        )


async def test_a_ledger_write_failure_is_not_degraded_by_the_entailment_gate() -> None:
    fake = RecordedLlm(fail={entailment.NAME: UsageLedgerWriteError("ledger down")})

    with pytest.raises(UsageLedgerWriteError):
        await run_entailment_gate([_spec("metformin")], MagicMock(), extract=fake)
