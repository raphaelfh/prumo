"""Parsing Celery task — parse a single ArticleFile at ingest.

Follows the worker pattern: a synchronous Celery entry point wrapping an inner
async coroutine via worker_session() + run_task(). The parser is built by the
create_document_parser() factory, which owns the PARSER_BACKEND switch.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from celery import Task
from sqlalchemy.ext.asyncio import AsyncSession

from app.worker._runner import run_task
from app.worker.celery_app import celery_app


async def _run_parse(
    article_file_id: str,
    project_id: str,
    user_id: str,
    trace_id: str | None,
    db: AsyncSession | None = None,
) -> dict[str, Any]:
    """Resolve the per-project parser and parse one ArticleFile.

    When *db* is provided (tests) it is used directly; otherwise a
    worker_session() is opened and committed here.
    """
    from types import SimpleNamespace

    from app.core.config import settings as app_settings
    from app.core.deps import get_supabase_client
    from app.core.factories import create_document_parser, create_storage_adapter
    from app.services.api_key_service import APIKeyService
    from app.services.document_parsing_service import DocumentParsingService
    from app.services.parser_settings_service import ParserSettingsService
    from app.worker._session import worker_session

    async def _body(session: AsyncSession) -> dict[str, Any]:
        # Per-project parser preference: "auto" | "llamaparse" | "docling".
        # "auto" (the default) prefers the LlamaParse cloud backend when a
        # llama_cloud key resolves, falling back to the free PyMuPDF parser
        # otherwise. An explicit "docling" never looks up a key.
        pref = await ParserSettingsService(session).get_for_project(UUID(project_id))

        # BYOK llama_cloud key (BYOK > global); fetched only when the cloud
        # path is reachable (auto or explicit llamaparse).
        llama_key: str | None = None
        if pref in ("auto", "llamaparse"):
            llama_key = await APIKeyService(session, user_id).get_key_for_provider("llama_cloud")

        if pref == "docling":
            backend = "docling"
        elif pref == "llamaparse":
            backend = "llamaparse"
        else:  # auto
            backend = "llamaparse" if llama_key else "pymupdf"

        # Build a minimal settings-like namespace that overrides PARSER_BACKEND
        # for this call without mutating the global settings object.
        call_settings = SimpleNamespace(
            PARSER_BACKEND=backend,
            LLAMA_CLOUD_API_KEY=app_settings.LLAMA_CLOUD_API_KEY,
        )
        parser = create_document_parser(
            call_settings,
            llama_cloud_key=llama_key,
        )

        supabase = get_supabase_client()
        storage = create_storage_adapter(supabase)
        service = DocumentParsingService(
            db=session,
            user_id=user_id,
            storage=storage,
            parser=parser,
            trace_id=trace_id or "",
        )
        result = await service.parse_article_file(UUID(article_file_id))
        return {
            "block_count": result.block_count,
            "page_count": result.page_count,
            "status": result.status,
        }

    if db is not None:
        return await _body(db)

    async with worker_session() as session:
        try:
            out = await _body(session)
            await session.commit()
            return out
        except Exception:
            await session.rollback()
            raise


async def _mark_parse_failed(article_file_id: str, error_message: str) -> None:
    """Persist a terminal parse failure in its own committed transaction.

    The main worker_session() rolls back on parser error (discarding any
    in-session status flush), so the failure is recorded out-of-band in a
    fresh session that commits independently. Covers parser errors AND
    pre-parse failures (e.g. storage download) the service never marks.
    """
    from sqlalchemy import select

    from app.models.article import ArticleFile
    from app.worker._session import worker_session

    async with worker_session() as session:
        article_file = (
            await session.execute(
                select(ArticleFile).where(ArticleFile.id == UUID(article_file_id))
            )
        ).scalar_one_or_none()
        if article_file is None:
            return
        article_file.extraction_status = "parse_failed"
        article_file.extraction_error = error_message[:500]
        await session.commit()


@celery_app.task(
    bind=True,
    max_retries=3,
    default_retry_delay=60,
    rate_limit="10/m",
)
def parse_article_file_task(
    self: Task[Any, Any],
    article_file_id: str,
    project_id: str,
    user_id: str,
    trace_id: str | None = None,
) -> dict[str, Any]:
    """Parse one ArticleFile and persist its text blocks."""

    try:
        return run_task(
            lambda: _run_parse(article_file_id, project_id, user_id, trace_id or self.request.id)
        )
    except Exception as exc:
        if self.request.retries >= self.max_retries:
            # Terminal: the main session already rolled back, so persist the
            # failure durably in its own transaction before the task dies.
            # Capture error_message now — `exc` is deleted after the except block.
            error_message = str(exc)
            run_task(lambda: _mark_parse_failed(article_file_id, error_message))
            raise
        raise self.retry(exc=exc)
