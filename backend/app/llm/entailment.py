"""Entailment judge: does the cited passage SUPPORT the extracted value?

A separate gpt-4o-mini call, run OUTSIDE the extraction retry loop. Reuses the
structured-output path with a one-field verdict model for reliable parsing."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import Any, Literal

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


@dataclass
class GateSpec:
    """Lightweight spec for one entailment-gate call.

    Carries the data needed to build a premise and run ``gate_evidence``.
    No ORM / DB imports — plain stdlib + app.infrastructure types only.

    Attributes:
        field_label: Human-readable field label for the LLM prompt claim.
        value_str:   String representation of the extracted value.
        quote:       Verbatim evidence text cited by the LLM.
        pos:         Resolved PositionV1 anchor (None when anchor lookup failed).
        anchor_blocks: Full list of ParsedBlocks for the source document page.
    """

    field_label: str
    value_str: str
    quote: str
    pos: Any  # PositionV1 | None — typed Any to avoid schemas import here
    anchor_blocks: list[Any]  # list[ParsedBlock]


def _build_premise(spec: GateSpec) -> str:
    """Return the premise string for the entailment gate.

    Locates the cited block(s) by the anchor's ``block_ids`` — the per-page
    ``block_index`` values the quote matched (see
    ``evidence_anchor_service.match``). This correctly handles a quote that
    spans MORE THAN ONE block; a single-containment char-range scan finds no
    block for such a quote and silently degrades to the bare quote, robbing the
    judge of neighbouring context.

    For a table-cell citation, returns just the cited cell(s) text (so the value
    check is cell-scoped — an adjacent cell's number must not satisfy it). For
    prose, returns the cited block span plus one neighbour block on each side
    (``anchor_blocks`` is in reading order). Falls back to the raw evidence
    quote when ``block_ids`` is empty or none resolve to a block on the anchor's
    page in ``anchor_blocks``.
    """
    if spec.pos is None or not spec.anchor_blocks:
        return spec.quote

    anchor = spec.pos.anchor
    block_ids = anchor.block_ids
    if not block_ids:
        return spec.quote

    page = anchor.range.page
    cited_positions = [
        i
        for i, b in enumerate(spec.anchor_blocks)
        if b.page_number == page and b.block_index in block_ids
    ]
    if not cited_positions:
        return spec.quote

    # Table cells verify against the cited cell(s) only: including neighbour
    # cells would let an adjacent cell's number satisfy the deterministic value
    # check.
    if all(spec.anchor_blocks[i].block_type == "table_cell" for i in cited_positions):
        return "\n".join(spec.anchor_blocks[i].text for i in cited_positions)

    # Prose: the cited block span + one neighbour block on each side
    # (``anchor_blocks`` is in reading order).
    lo = max(0, cited_positions[0] - 1)
    hi = min(len(spec.anchor_blocks) - 1, cited_positions[-1] + 1)
    return "\n".join(spec.anchor_blocks[j].text for j in range(lo, hi + 1))


async def run_entailment_gate(
    specs: list[GateSpec],
    model: Model,
    logger: Any = None,
    *,
    concurrency: int = 8,
) -> list[AttributionLabel | None]:
    """Run ``gate_evidence`` concurrently over *specs*; degrade on exception.

    Builds the premise for each spec from anchor block context (or falls back
    to the raw evidence quote), then fans out over ``gate_evidence`` with a
    bounded semaphore. Any judge exception leaves the corresponding entry as
    ``None`` (degrade path — the run never aborts).

    Args:
        specs:       One :class:`GateSpec` per field to judge.
        model:       pydantic_ai Model used for the entailment judge LLM call.
        logger:      Optional structlog/stdlib logger; warnings on exceptions.
        concurrency: Max concurrent ``gate_evidence`` calls (default 8).

    Returns:
        Per-spec ``AttributionLabel`` or ``None`` when the judge raised.
    """
    sem = asyncio.Semaphore(concurrency)

    async def _one(spec: GateSpec) -> AttributionLabel | None:
        premise = _build_premise(spec)
        async with sem:
            return await gate_evidence(
                field_label=spec.field_label,
                value=spec.value_str,
                premise=premise,
                model=model,
            )

    raw = await asyncio.gather(*[_one(s) for s in specs], return_exceptions=True)
    results: list[AttributionLabel | None] = []
    for spec, outcome in zip(specs, raw, strict=True):
        if isinstance(outcome, BaseException):
            if logger is not None:
                logger.warning(
                    "entailment_gate_failed",
                    field=spec.field_label,
                    error=str(outcome),
                )
            results.append(None)
        else:
            results.append(outcome)
    return results
