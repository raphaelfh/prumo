"""Eager-mode coverage for every Celery task.

Runs each task synchronously via ``task_always_eager`` +
``task_eager_propagates``. Validates serialisation (UUIDs come in as
strings, parse correctly), kwargs alignment, and per-task client
construction.

Does NOT validate the event-loop bug — eager mode runs the coroutine
on the pytest event loop, so loop reuse is impossible by construction.
For loop coverage see the CI smoke job added in PR 3.

Each test patches the *imports inside the task closure* (the task
module imports ``worker_session``, ``get_supabase_client`` and the
service classes lazily inside ``async def run``), then triggers the
task via ``.apply(kwargs=...)`` which exercises the kwargs serialiser
and the ``run_task`` async bridge.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest

from app.worker.celery_app import celery_app

# ----------------------------------------------------------------------
# Shared fixtures / helpers
# ----------------------------------------------------------------------


@pytest.fixture(autouse=True)
def eager_mode(monkeypatch: pytest.MonkeyPatch) -> None:
    """Run every Celery task synchronously in the pytest process."""
    monkeypatch.setattr(celery_app.conf, "task_always_eager", True)
    monkeypatch.setattr(celery_app.conf, "task_eager_propagates", True)


class _FakeAsyncSession:
    """Drop-in for an SQLAlchemy ``AsyncSession`` that records lifecycle.

    Tasks call ``await session.commit()`` / ``await session.rollback()``
    on the result of ``async with worker_session() as session``. We
    don't need real SQL — just need awaitable no-ops so ``async with``
    and the commit/rollback calls succeed without raising.
    """

    def __init__(self) -> None:
        self.commit = AsyncMock()
        self.rollback = AsyncMock()
        self.close = AsyncMock()
        self.flush = AsyncMock()
        self.refresh = AsyncMock()


def _session_factory_returning(session: _FakeAsyncSession) -> Any:
    """Return a callable that mimics ``worker_session()``.

    ``worker_session()`` returns an async context manager whose
    ``__aenter__`` yields the session. We can't use ``MagicMock`` here
    because ``async with`` requires ``__aenter__``/``__aexit__`` to be
    real coroutines.
    """

    @asynccontextmanager
    async def _cm() -> AsyncIterator[_FakeAsyncSession]:
        yield session

    def _factory() -> Any:
        return _cm()

    return _factory


# ----------------------------------------------------------------------
# 1. extraction_export_tasks.export_extraction_task
# ----------------------------------------------------------------------


def test_export_extraction_task_signature_and_kwargs_alignment() -> None:
    """The 9 task kwargs must align with what the endpoint passes."""
    from app.worker.tasks.extraction_export_tasks import export_extraction_task

    session = _FakeAsyncSession()
    fake_service = MagicMock()
    fake_service.resolve_layout = AsyncMock(return_value=object())
    fake_storage = MagicMock()
    fake_storage.upload = AsyncMock(return_value=None)
    fake_storage.get_signed_url = AsyncMock(return_value="https://signed.example/url")

    with (
        patch(
            "app.services.extraction_export_service.ExtractionExportService",
            return_value=fake_service,
        ),
        patch(
            "app.core.factories.create_storage_adapter",
            return_value=fake_storage,
        ),
        patch(
            "app.services.exports.extraction.workbook.build_workbook",
            return_value=b"PK\x03\x04minimal-xlsx-bytes",
        ),
        patch(
            "app.worker._session.worker_session",
            new=_session_factory_returning(session),
        ),
        patch(
            "app.core.deps.get_supabase_client",
            return_value=MagicMock(),
        ),
    ):
        result = export_extraction_task.apply(
            kwargs={
                "project_id": str(uuid4()),
                "template_id": str(uuid4()),
                "mode": "consensus",
                "article_ids": [str(uuid4())],
                "article_scope": "current_list",
                "user_id": str(uuid4()),
                "reviewer_id": None,
                "include_ai_metadata": False,
                "anonymize_reviewer_names": False,
            }
        ).get(timeout=5)

    assert result["download_url"] == "https://signed.example/url"
    assert "expires_at" in result
    assert "user_id" in result
    # Layout resolved, workbook built, bytes uploaded, signed URL returned.
    fake_service.resolve_layout.assert_awaited_once()
    fake_storage.upload.assert_awaited_once()
    fake_storage.get_signed_url.assert_awaited_once()


# ----------------------------------------------------------------------
# 2. export_tasks.export_articles_task
# ----------------------------------------------------------------------


def test_export_articles_task_signature_and_kwargs_alignment() -> None:
    """Mirror of the extraction export — but for the articles ZIP path."""
    from app.worker.tasks.export_tasks import export_articles_task

    session = _FakeAsyncSession()
    fake_service = MagicMock()
    fake_service.run_export_async = AsyncMock(
        return_value={
            "download_url": "https://signed.example/zip",
            "expires_at": "2026-05-24T12:00:00+00:00",
            "skipped_files": [],
        }
    )

    with (
        patch(
            "app.services.articles_export_service.ArticlesExportService",
            return_value=fake_service,
        ),
        patch(
            "app.core.factories.create_storage_adapter",
            return_value=MagicMock(),
        ),
        patch(
            "app.worker._session.worker_session",
            new=_session_factory_returning(session),
        ),
        patch(
            "app.core.deps.get_supabase_client",
            return_value=MagicMock(),
        ),
    ):
        result = export_articles_task.apply(
            kwargs={
                "project_id": str(uuid4()),
                "article_ids": [str(uuid4()), str(uuid4())],
                "formats": ["csv", "ris"],
                "file_scope": "none",
                "user_id": str(uuid4()),
            }
        ).get(timeout=5)

    assert result["download_url"] == "https://signed.example/zip"
    assert result["skipped_files"] == []
    # The task augments the service result with ``user_id`` on the way out.
    assert "user_id" in result
    fake_service.run_export_async.assert_awaited_once()
    # Transaction management belongs to the service — the task body must
    # not perform a raw commit. Catches a future regression where someone
    # adds an `await session.commit()` to the task wrapper.
    session.commit.assert_not_awaited()


# ----------------------------------------------------------------------
# 3. import_tasks.import_zotero_collection_task
# ----------------------------------------------------------------------


def test_import_zotero_collection_task_signature_and_kwargs_alignment() -> None:
    """The Zotero collection import — service returns a dataclass with
    a ``results`` list; the task flattens it into a JSON-safe dict.
    """
    from app.services.zotero_import_service import (
        ZoteroImportItemResult,
        ZoteroImportResult,
    )
    from app.worker.tasks.import_tasks import import_zotero_collection_task

    session = _FakeAsyncSession()
    fake_service = MagicMock()
    fake_service.import_collection = AsyncMock(
        return_value=ZoteroImportResult(
            total_items=1,
            imported=1,
            failed=0,
            skipped=0,
            updated=0,
            removed_at_source=0,
            reactivated=0,
            results=[
                ZoteroImportItemResult(
                    zotero_key="KEY1",
                    title="Sample article",
                    success=True,
                    article_id=str(uuid4()),
                    pdf_imported=False,
                ),
            ],
            sync_run_id=str(uuid4()),
        )
    )

    with (
        patch(
            "app.services.zotero_import_service.ZoteroImportService",
            return_value=fake_service,
        ),
        patch(
            "app.core.factories.create_storage_adapter",
            return_value=MagicMock(),
        ),
        patch(
            "app.worker._session.worker_session",
            new=_session_factory_returning(session),
        ),
        patch(
            "app.core.deps.get_supabase_client",
            return_value=MagicMock(),
        ),
    ):
        result = import_zotero_collection_task.apply(
            kwargs={
                "project_id": str(uuid4()),
                "collection_key": "ABCD1234",
                "user_id": str(uuid4()),
                "import_pdfs": False,
                "max_items": 10,
                "update_existing": True,
                "sync_run_id": str(uuid4()),
            }
        ).get(timeout=5)

    assert result["total_items"] == 1
    assert result["imported"] == 1
    assert result["results"][0]["zotero_key"] == "KEY1"
    fake_service.import_collection.assert_awaited_once()
    session.commit.assert_awaited()  # task commits on the happy path


# ----------------------------------------------------------------------
# 4. extraction_tasks.extract_section_task
# ----------------------------------------------------------------------


def test_extract_section_task_signature_and_kwargs_alignment() -> None:
    """The section extractor with BYOK fallback — when ``openai_api_key``
    is ``None`` the task constructs an APIKeyService and resolves it
    from the user's stored key.
    """
    from app.services.section_extraction_service import SectionExtractionResult
    from app.worker.tasks.extraction_tasks import extract_section_task

    session = _FakeAsyncSession()

    fake_extraction_service = MagicMock()
    fake_extraction_service.extract_section = AsyncMock(
        return_value=SectionExtractionResult(
            extraction_run_id=str(uuid4()),
            entity_type_id=str(uuid4()),
            suggestions_created=3,
            tokens_prompt=120,
            tokens_completion=80,
            tokens_total=200,
            duration_ms=1234.5,
        )
    )

    fake_api_key_service = MagicMock()
    fake_api_key_service.get_key_for_provider = AsyncMock(return_value="resolved-from-user-keys")

    with (
        patch(
            "app.services.section_extraction_service.SectionExtractionService",
            return_value=fake_extraction_service,
        ),
        patch(
            "app.services.api_key_service.APIKeyService",
            return_value=fake_api_key_service,
        ),
        patch(
            "app.core.factories.create_storage_adapter",
            return_value=MagicMock(),
        ),
        patch(
            "app.worker._session.worker_session",
            new=_session_factory_returning(session),
        ),
        patch(
            "app.core.deps.get_supabase_client",
            return_value=MagicMock(),
        ),
    ):
        result = extract_section_task.apply(
            kwargs={
                "project_id": str(uuid4()),
                "article_id": str(uuid4()),
                "template_id": str(uuid4()),
                "entity_type_id": str(uuid4()),
                "user_id": str(uuid4()),
                "parent_instance_id": None,
                # No openai_api_key -> task must resolve via APIKeyService.
                "openai_api_key": None,
            }
        ).get(timeout=5)

    assert result["suggestions_created"] == 3
    assert result["duration_ms"] == 1234
    fake_api_key_service.get_key_for_provider.assert_awaited_once_with("openai")
    fake_extraction_service.extract_section.assert_awaited_once()
    session.commit.assert_awaited()
