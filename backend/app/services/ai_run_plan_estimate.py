"""The plan's lower-bound token estimate and its warnings (pure reads)."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.services.project_ai_context import get_ai_context

TEMPLATE_PLACEHOLDER = "[customize:"


@dataclass(frozen=True, slots=True)
class Estimate:
    input_tokens_low: int
    llm_calls_low: int
    passes: int


def estimate(markdown_chars: Sequence[int | None], *, top_level: int, verified: bool) -> Estimate:
    """One entry per will-run article (None = unparsed). Text tokens are
    ``chars // 4`` clamped to the assembly budget; an unparsed article adds
    calls but no tokens, so both numbers are lower bounds."""
    passes = 2 if verified else 1
    budget = settings.LLM_ASSEMBLY_BUDGET_TOKENS
    tokens = sum(min(chars // 4, budget) for chars in markdown_chars if chars is not None)
    return Estimate(
        input_tokens_low=tokens * top_level * passes,
        llm_calls_low=len(markdown_chars) * top_level * passes,
        passes=passes,
    )


async def warnings_for(
    db: AsyncSession,
    *,
    project_id: UUID,
    instruction: str | None,
    unparsed: bool,
    verified: bool,
) -> list[str]:
    context = await get_ai_context(db, project_id)
    warnings: list[str] = []
    if not context["picots_enabled"] or not context["preview"]:
        warnings.append("PICOTS_OFF_OR_EMPTY")
    if instruction and TEMPLATE_PLACEHOLDER in instruction:
        warnings.append("TEMPLATE_INSTRUCTION_PLACEHOLDERS")
    if unparsed:
        warnings.append("ARTICLES_UNPARSED")
    if verified:
        warnings.append("VERIFIED_MODE_TWO_PASSES")
    return warnings
