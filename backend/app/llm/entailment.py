"""Entailment judge: does the cited passage SUPPORT the extracted value?

A separate gpt-4o-mini call, run OUTSIDE the extraction retry loop. Reuses the
structured-output path with a one-field verdict model for reliable parsing."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field
from pydantic_ai.models import Model

from app.llm.extractor import extract_structured
from app.llm.value_support import is_numeric_like, numeric_value_supported

NAME = "entailment_judge"
VERSION = "1"

_SYSTEM = (
    "You verify attribution. Given a CLAIM and a SOURCE passage, decide whether "
    "the source SUPPORTS the claim: 'entailed' (the source clearly states or "
    "directly implies the claim), 'weak' (related but does not establish it), or "
    "'unsupported' (the source does not support the claim). Judge only the source "
    "shown; do not use outside knowledge."
)

AttributionLabel = Literal["entailed", "weak", "unsupported"]


class EntailmentVerdict(BaseModel):
    model_config = ConfigDict(extra="forbid")
    label: AttributionLabel = Field(description="entailed | weak | unsupported")
    rationale: str | None = Field(description="One short sentence; null if none.")


async def judge_entailment(
    *, field_label: str, value: str, premise: str, model: Model
) -> EntailmentVerdict:
    user = (
        f'CLAIM: "{field_label} = {value}"\n\n'
        f'SOURCE:\n"""\n{premise}\n"""\n\n'
        "Does the SOURCE support the CLAIM?"
    )
    verdict, _usage = await extract_structured(
        output_model=EntailmentVerdict,
        system_prompt=_SYSTEM,
        user_prompt=user,
        model=model,
        prompt_name=NAME,
        prompt_version=VERSION,
        output_retries=1,
    )
    return verdict


async def gate_evidence(
    *, field_label: str, value: str, premise: str, model: Model
) -> AttributionLabel:
    """Numeric-like values must appear deterministically in the premise; then the
    judge decides entailed vs weak. Non-numeric values are judged directly."""
    if is_numeric_like(value) and not numeric_value_supported(value, premise):
        return "unsupported"
    verdict = await judge_entailment(
        field_label=field_label, value=value, premise=premise, model=model
    )
    return verdict.label
