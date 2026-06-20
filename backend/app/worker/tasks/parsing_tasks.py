"""Parsing Celery task — parse a single ArticleFile at ingest.

Follows the worker pattern: a synchronous Celery entry point wrapping an inner
async coroutine via worker_session() + run_task(). The parser is built by the
create_document_parser() factory, which owns the PARSER_BACKEND switch and the
fail-closed PHI gate.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from celery import Task
from sqlalchemy import select
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
    from app.models.project import Project
    from app.services.api_key_service import APIKeyService
    from app.services.document_parsing_service import DocumentParsingService
    from app.services.parser_settings_service import ParserSettingsService
    from app.worker._session import worker_session

    async def _body(session: AsyncSession) -> dict[str, Any]:
        project = (
            await session.execute(select(Project).where(Project.id == UUID(project_id)))
        ).scalar_one()

        # per-project parser preference -> PARSER_BACKEND value
        pref = await ParserSettingsService(session).get_for_project(UUID(project_id))
        backend = pref if pref == "llamaparse" else "docling"

        # BYOK llama_cloud key (default > global); only relevant for llamaparse
        llama_key: str | None = None
        if backend == "llamaparse":
            llama_key = await APIKeyService(session, user_id).get_key_for_provider("llama_cloud")

        # Build a minimal settings-like namespace that overrides PARSER_BACKEND
        # for this call without mutating the global settings object.
        call_settings = SimpleNamespace(
            PARSER_BACKEND=backend,
            LLAMA_CLOUD_API_KEY=app_settings.LLAMA_CLOUD_API_KEY,
        )
        parser = create_document_parser(
            call_settings,
            project_is_phi=bool(project.is_phi),
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
        self.retry(exc=exc)
