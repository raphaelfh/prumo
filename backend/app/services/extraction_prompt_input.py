"""Build the budgeted block-markdown prompt input for a run.

Reads the STORED content_markdown when it fits the token budget; otherwise falls
back to the section-aware assembler over the persisted blocks (IMRaD whole-section
dropping). When the article was never parsed, runs the simple PymupdfParser ONCE
via DocumentParsingService (persisting blocks + content_markdown so the parse is
never re-run on a successful run). A failed run rolls back the transaction, which
discards the parse; the next attempt re-parses — cheap and deterministic.
No unbounded pypdf path remains.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.infrastructure.parsing.pymupdf_parser import PymupdfParser
from app.llm.assembler import assemble_for_model, estimate_tokens
from app.repositories.article_text_block_repository import ArticleTextBlockRepository
from app.services.document_parsing_service import DocumentParsingService


async def build_prompt_input(
    *,
    db: AsyncSession,
    article_files: Any,
    storage: Any,
    article_id: UUID,
    model: str,
    logger: Any,
    user_id: str,
    trace_id: str,
) -> tuple[str, list[Any], UUID | None]:
    """Return ``(markdown, anchor_blocks, anchor_file_id)`` for *article_id*."""
    main_file = await article_files.get_latest_pdf(article_id)
    if main_file is None:
        raise FileNotFoundError(f"No PDF for article {article_id}")

    repo = ArticleTextBlockRepository(db)
    blocks = await repo.list_ordered_for_file(main_file.id)

    if not blocks:
        # On-demand: parse once with the simple parser, persist blocks +
        # content_markdown, then reload. Persisted on a successful run (a
        # successful run is never re-parsed); a failed run rolls back the parse
        # and the next attempt re-parses — cheap and deterministic.
        parsing = DocumentParsingService(
            db=db,
            user_id=user_id,
            storage=storage,
            parser=PymupdfParser(),
            trace_id=trace_id,
        )
        await parsing.parse_article_file(main_file.id)
        await db.refresh(main_file)
        blocks = await repo.list_ordered_for_file(main_file.id)

    stored_md = main_file.content_markdown or ""
    est = estimate_tokens(stored_md, model) if stored_md else 0
    if stored_md and est <= settings.LLM_ASSEMBLY_BUDGET_TOKENS:
        text, source = stored_md, "stored_markdown"
        info_truncated, included = False, len(blocks)
    else:
        text, info = assemble_for_model(
            blocks, model_name=model, budget_tokens=settings.LLM_ASSEMBLY_BUDGET_TOKENS
        )
        source, info_truncated, est, included = (
            "budgeted_blocks",
            info.truncated,
            info.est_tokens,
            info.included_blocks,
        )

    logger.info(
        "extraction.assembly",
        article_id=str(article_id),
        source=source,
        total_blocks=len(blocks),
        included_blocks=included,
        truncated=info_truncated,
        est_tokens=est,
    )
    return text, blocks, main_file.id
