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
# 4. import_tasks.import_pubmed_task
# ----------------------------------------------------------------------


def _fake_pubmed_service(
    order: list[str], run_import: AsyncMock | None = None
) -> tuple[MagicMock, MagicMock]:
    """A ``PubmedImportService`` class double and the instance it returns."""
    instance = MagicMock()
    instance.run_import = run_import or AsyncMock(return_value="completed")
    instance.mark_failed = AsyncMock(side_effect=lambda **_: order.append("mark_failed"))
    return MagicMock(return_value=instance), instance


def _pubmed_kwargs() -> dict[str, Any]:
    return {
        "project_id": str(uuid4()),
        "sync_run_id": str(uuid4()),
        "pmids": ["42908551"],
        "trace_id": "t-1",
    }


def _recording_session(order: list[str]) -> _FakeAsyncSession:
    session = _FakeAsyncSession()
    session.commit = AsyncMock(side_effect=lambda: order.append("commit"))
    session.rollback = AsyncMock(side_effect=lambda: order.append("rollback"))
    return session


def test_import_pubmed_task_signature_and_kwargs_alignment(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import json
    from uuid import UUID

    from app.core.config import settings
    from app.services.pubmed_client import PubMedClient
    from app.worker.tasks.import_tasks import import_pubmed_task

    monkeypatch.setattr(settings, "NCBI_EMAIL", "dev@prumo.test")
    order: list[str] = []
    session = _recording_session(order)
    service_cls, service = _fake_pubmed_service(order)
    kwargs = _pubmed_kwargs()
    assert json.loads(json.dumps(kwargs)) == kwargs

    with (
        patch("app.services.pubmed_import_service.PubmedImportService", new=service_cls),
        patch("app.worker._session.worker_session", new=_session_factory_returning(session)),
    ):
        result = import_pubmed_task.apply(kwargs=kwargs).get(timeout=5)

    assert result == {"sync_run_id": kwargs["sync_run_id"], "status": "completed"}
    service.run_import.assert_awaited_once()
    call = service.run_import.await_args.kwargs
    assert call["project_id"] == UUID(kwargs["project_id"])
    assert call["sync_run_id"] == UUID(kwargs["sync_run_id"])
    assert call["pmids"] == ["42908551"]
    assert isinstance(call["client"], PubMedClient)
    session.commit.assert_awaited()
    service.mark_failed.assert_not_awaited()


def test_import_pubmed_task_fails_the_run_when_run_import_raises(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from uuid import UUID

    from app.core.config import settings
    from app.worker.tasks.import_tasks import import_pubmed_task

    monkeypatch.setattr(settings, "NCBI_EMAIL", "dev@prumo.test")
    order: list[str] = []
    session = _recording_session(order)
    service_cls, service = _fake_pubmed_service(
        order, run_import=AsyncMock(side_effect=RuntimeError("db went away"))
    )
    kwargs = _pubmed_kwargs()

    with (
        patch("app.services.pubmed_import_service.PubmedImportService", new=service_cls),
        patch("app.worker._session.worker_session", new=_session_factory_returning(session)),
        patch.object(import_pubmed_task, "retry") as retry,
    ):
        result = import_pubmed_task.apply(kwargs=kwargs).get(timeout=5)

    assert result == {"sync_run_id": kwargs["sync_run_id"], "status": "failed"}
    assert order == ["rollback", "mark_failed", "commit"]
    service.mark_failed.assert_awaited_once_with(
        project_id=UUID(kwargs["project_id"]), sync_run_id=UUID(kwargs["sync_run_id"])
    )
    retry.assert_not_called()


def test_import_pubmed_task_without_ncbi_email_fails_the_run(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from uuid import UUID

    from app.core.config import settings
    from app.worker.tasks.import_tasks import import_pubmed_task

    monkeypatch.setattr(settings, "NCBI_EMAIL", None)
    order: list[str] = []
    session = _recording_session(order)
    service_cls, service = _fake_pubmed_service(order)
    kwargs = _pubmed_kwargs()

    with (
        patch("app.services.pubmed_import_service.PubmedImportService", new=service_cls),
        patch("app.worker._session.worker_session", new=_session_factory_returning(session)),
    ):
        result = import_pubmed_task.apply(kwargs=kwargs).get(timeout=5)

    assert result == {"sync_run_id": kwargs["sync_run_id"], "status": "failed"}
    service.run_import.assert_not_awaited()
    service.mark_failed.assert_awaited_once_with(
        project_id=UUID(kwargs["project_id"]), sync_run_id=UUID(kwargs["sync_run_id"])
    )


def test_import_pubmed_task_never_retries() -> None:
    from app.worker.tasks.import_tasks import import_pubmed_task

    assert import_pubmed_task.max_retries == 0
    assert import_pubmed_task.time_limit == 1800
    assert (
        import_pubmed_task.time_limit
        < celery_app.conf.broker_transport_options["visibility_timeout"]
    )
