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

    For a table-cell citation, returns just the cited cell's text (so the value
    check is cell-scoped — an adjacent cell's number must not satisfy it). For
    prose, returns the cited block + one neighbour on each side. Falls back to
    the raw evidence quote when the cited block cannot be located by page/char
    range in ``anchor_blocks``.
    """
    if spec.pos is not None and spec.anchor_blocks:
        blocks_by_idx: dict[int, Any] = dict(enumerate(spec.anchor_blocks))
        anchor_range = spec.pos.anchor.range  # PDFTextRange
        cited_idx = next(
            (
                i
                for i, b in enumerate(spec.anchor_blocks)
                if b.page_number == anchor_range.page
                and b.char_start <= anchor_range.char_start
                and b.char_end >= anchor_range.char_end
            ),
            None,
        )
        if cited_idx is not None:
            cited = blocks_by_idx[cited_idx]
            # Table cells verify against the cell itself: "the cited cell
            # contains the value." Including neighbour cells would let an
            # adjacent cell's number satisfy the deterministic check.
            if getattr(cited, "block_type", None) == "table_cell":
                cell_text: str = cited.text
                return cell_text
            parts = [
                blocks_by_idx[j].text
                for j in (cited_idx - 1, cited_idx, cited_idx + 1)
                if j in blocks_by_idx
            ]
            return "\n".join(parts)
    return spec.quote


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
