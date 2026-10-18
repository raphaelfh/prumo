"""Build the budgeted block-markdown prompt input for a run.

Always assembles the prompt from the persisted blocks through the section-aware
assembler (IMRaD whole-section dropping under the token budget), so every kept
block carries its citation ref; the stored content_markdown is the reader's
projection and is never the prompt (ADR-0013 Amendment 2026-10). When the article was never parsed, runs the simple PymupdfParser ONCE
via DocumentParsingService (persisting blocks + content_markdown so the parse is
never re-run on a successful run). A failed run rolls back the transaction, which
discards the parse; the next attempt re-parses — cheap and deterministic.
No unbounded pypdf path remains.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from typing import Any
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.infrastructure.parsing.pymupdf_parser import PymupdfParser
from app.llm.assembler import assemble_for_model
from app.repositories.article_text_block_repository import ArticleTextBlockRepository
from app.services.document_parsing_service import DocumentParsingService


@dataclass(frozen=True)
class PromptInputInfo:
    """How the prompt input was assembled for a run.

    Carries the anchor blocks/file the run resolved against plus the
    provenance facts the review UI needs: which file the article text came
    from, whether the token budget dropped any of it, and the token estimate.
    """

    anchor_blocks: list[Any]
    anchor_file_id: UUID | None
    #: The anchor file's ``content_version`` the blocks were read at.
    content_version: int | None
    #: SHA-256 (hex) of the returned markdown — the exact text the prompt
    #: substitutes for the article marker.
    text_sha256: str
    file_name: str | None
    truncated: bool
    est_tokens: int


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
) -> tuple[str, PromptInputInfo]:
    """Return ``(markdown, info)`` for *article_id*."""
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

    text, assembly = assemble_for_model(
        blocks, model_name=model, budget_tokens=settings.LLM_ASSEMBLY_BUDGET_TOKENS
    )

    logger.info(
        "extraction.assembly",
        article_id=str(article_id),
        total_blocks=len(blocks),
        included_blocks=assembly.included_blocks,
        truncated=assembly.truncated,
        est_tokens=assembly.est_tokens,
    )
    return text, PromptInputInfo(
        anchor_blocks=blocks,
        anchor_file_id=main_file.id,
        content_version=main_file.content_version,
        text_sha256=hashlib.sha256(text.encode("utf-8")).hexdigest(),
        file_name=main_file.original_filename,
        truncated=assembly.truncated,
        est_tokens=assembly.est_tokens,
    )
