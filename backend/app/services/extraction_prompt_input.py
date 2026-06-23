"""Shared orchestrator: build the budgeted block-markdown prompt input for a run.

Service layer (touches the article_text_blocks repository); the assembler it
calls stays pure. Both ``section_extraction_service`` and
``model_extraction_service`` call this so the fetch-once / assemble-once / budget
logic lives in exactly one place (keeps both god-files lean).
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.llm.assembler import assemble_for_model, blocks_from_plain_text
from app.repositories.article_text_block_repository import ArticleTextBlockRepository


async def build_prompt_input(
    *,
    db: AsyncSession,
    article_files: Any,
    pdf_processor: Any,
    get_pdf: Callable[[UUID], Awaitable[bytes]],
    article_id: UUID,
    model: str,
    logger: Any,
) -> tuple[str, list[Any], UUID | None]:
    """Return ``(markdown, anchor_blocks, anchor_file_id)`` for *article_id*.

    Uses persisted ``article_text_blocks`` when present; otherwise wraps pypdf
    text into synthetic blocks through the SAME budgeted assembler so no path
    ever sends unbounded text. ``anchor_blocks`` is reused by the caller for
    evidence anchoring (no second fetch).
    """
    main_file = await article_files.get_latest_pdf(article_id)
    blocks: list[Any] = (
        await ArticleTextBlockRepository(db).list_ordered_for_file(main_file.id)
        if main_file is not None
        else []
    )
    anchor_file_id = main_file.id if main_file is not None else None
    source: list[Any] = (
        blocks
        if blocks
        else blocks_from_plain_text(await pdf_processor.extract_text(await get_pdf(article_id)))
    )
    text, info = assemble_for_model(
        source, model_name=model, budget_tokens=settings.LLM_ASSEMBLY_BUDGET_TOKENS
    )
    logger.info(
        "extraction.assembly",
        article_id=str(article_id),
        total_blocks=info.total_blocks,
        included_blocks=info.included_blocks,
        truncated=info.truncated,
        est_tokens=info.est_tokens,
    )
    return text, blocks, anchor_file_id
