"""Semantic output validators.

Raising ModelRetry feeds the message back to the model for another
attempt — the structured replacement for the legacy silent-empty-dict
fallback. Pydantic itself already enforces types, enums, and the 0-1
confidence range; these validators cover what a type system cannot.
"""

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from pydantic_ai import ModelRetry, RunContext

from app.domain.evidence_block_refs import (
    BlockRefIndex,
    parse_block_ref,
    quote_in_window,
    ref_window,
)


@dataclass
class GroundingStats:
    """How many times the grounding validator sent a section call back."""

    retried: int = 0


def _grounding_problem(index: BlockRefIndex, block_ref: str, quote: str) -> str | None:
    """Why one ``{block_ref, quote}`` entry is not grounded, or ``None``."""
    if not quote.strip():
        return "quote must be a non-empty verbatim passage; omit the entry when there is none."
    ref = parse_block_ref(block_ref)
    if ref is None:
        return f"block_ref {block_ref!r} is not a citation ref such as p3·b12."
    window = ref_window(index, ref)
    if window is None:
        return f"block_ref {block_ref!r} names no block in the article text."
    if not quote_in_window(quote, window):
        return (
            f"the quote is not inside block {block_ref!r} or its neighbours; quote the "
            "article's words verbatim and cite the ref shown before them."
        )
    return None


def evidence_grounding_validator(
    index: BlockRefIndex, stats: GroundingStats | None = None
) -> Callable[[RunContext[Any], Any], Any]:
    """An output validator that sends evidence back when its block ref is
    unknown or its quote is not inside the cited window.

    Bounded: it raises only while ``ctx.retry < ctx.max_retries``; on the last
    attempt it returns the output unchanged and the write path decides
    grounding (an unanchored quote lands ``ungroundable``). Assumes every field
    in ``type(output).model_fields`` carries a ``field_info.alias`` matching the
    schema property name the model was shown (the ``build_output_models``
    convention) — the retry message must name what the model can map back.
    """

    def validate(ctx: RunContext[Any], output: Any) -> Any:
        if ctx.retry >= ctx.max_retries:
            return output
        for field_name, field_info in type(output).model_fields.items():
            label = field_info.alias or field_name
            evidence_list = getattr(getattr(output, field_name), "evidence", None) or []
            for idx, evidence in enumerate(evidence_list):
                problem = _grounding_problem(index, evidence.block_ref, evidence.quote)
                if problem is not None:
                    if stats is not None:
                        stats.retried += 1
                    raise ModelRetry(f"Field '{label}' evidence[{idx}]: {problem}")
        return output

    return validate
