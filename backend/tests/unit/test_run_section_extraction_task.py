"""Unit tests for run_section_extraction_task.

Tests that the task builds a SectionExtractionRequest from the payload dict,
calls service.run_from_request, commits the session, and returns the
normalised dict for both single and batch results.

Uses Celery eager mode (.apply()) so the task runs synchronously in-process
with proper Celery task context (self.request.id etc.), exactly like the
sibling tests in tests/integration/test_worker_eager_mode.py.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest

from app.services.section_extraction_service import (
    BatchExtractionResult,
    SectionExtractionResult,
)
from app.worker.celery_app import celery_app
from app.worker.tasks.extraction_tasks import run_section_extraction_task

# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def eager_mode(monkeypatch: pytest.MonkeyPatch) -> None:
    """Run every Celery task synchronously in the pytest process."""
    monkeypatch.setattr(celery_app.conf, "task_always_eager", True)
    monkeypatch.setattr(celery_app.conf, "task_eager_propagates", True)


class _FakeSession:
    def __init__(self) -> None:
        self.commit = AsyncMock()
        self.rollback = AsyncMock()
        self.close = AsyncMock()


def _session_factory(session: _FakeSession) -> Any:
    @asynccontextmanager
    async def _factory() -> AsyncIterator[_FakeSession]:
        yield session

    return _factory


def _single_result(run_id: str, entity_type_id: str) -> SectionExtractionResult:
    return SectionExtractionResult(
        extraction_run_id=run_id,
        entity_type_id=entity_type_id,
        suggestions_created=5,
        tokens_prompt=100,
        tokens_completion=40,
        tokens_total=140,
        duration_ms=300.0,
    )


def _batch_result(run_id: str) -> BatchExtractionResult:
    return BatchExtractionResult(
        extraction_run_id=run_id,
        total_sections=3,
        successful_sections=2,
        failed_sections=1,
        total_suggestions_created=7,
        total_tokens_used=500,
        duration_ms=600.0,
        sections=[
            {
                "entity_type_id": "etype-aaa",
                "entity_type_name": "Outcome",
                "success": True,
                "suggestions_created": 4,
                "tokens_used": 200,
                "skipped": False,
                "error": None,
            },
            {
                "entity_type_id": "etype-bbb",
                "entity_type_name": "Population",
                "success": False,
                "suggestions_created": 0,
                "tokens_used": 0,
                "skipped": False,
                "error": "timeout",
            },
        ],
    )


def _apply(payload_dict: dict, user_id: str, trace_id: str | None = None) -> dict:
    return run_section_extraction_task.apply(
        kwargs={"payload_json": payload_dict, "user_id": user_id, "trace_id": trace_id}
    ).get(timeout=5)


# ---------------------------------------------------------------------------
# Single-section result
# ---------------------------------------------------------------------------


class TestRunSectionExtractionTaskSingle:
    def test_returns_normalized_single_dict(self):
        run_id = str(uuid4())
        entity_type_id = str(uuid4())
        user_id = str(uuid4())
        payload_dict = {
            "projectId": str(uuid4()),
            "articleId": str(uuid4()),
            "templateId": str(uuid4()),
            "entityTypeId": entity_type_id,
        }

        session = _FakeSession()
        fake_service = MagicMock()
        fake_service.run_from_request = AsyncMock(
            return_value=_single_result(run_id, entity_type_id)
        )
        fake_api_key = MagicMock()
        fake_api_key.get_key_for_provider = AsyncMock(return_value=None)

        with (
            patch(
                "app.services.section_extraction_service.SectionExtractionService",
                return_value=fake_service,
            ),
            patch("app.services.api_key_service.APIKeyService", return_value=fake_api_key),
            patch("app.core.factories.create_storage_adapter", return_value=MagicMock()),
            patch("app.core.deps.get_supabase_client", return_value=MagicMock()),
            patch(
                "app.worker._session.worker_session",
                new=_session_factory(session),
            ),
        ):
            result = _apply(payload_dict, user_id, "trace-xyz")

        assert result["mode"] == "single"
        assert result["extraction_run_id"] == run_id
        assert result["suggestions_created"] == 5
        assert result["entity_type_id"] == entity_type_id
        assert "total_sections" not in result
        assert "successful_sections" not in result
        assert "sections" not in result

    def test_commits_session_on_success(self):
        run_id = str(uuid4())
        entity_type_id = str(uuid4())
        user_id = str(uuid4())
        payload_dict = {
            "projectId": str(uuid4()),
            "articleId": str(uuid4()),
            "templateId": str(uuid4()),
            "entityTypeId": entity_type_id,
        }

        session = _FakeSession()
        fake_service = MagicMock()
        fake_service.run_from_request = AsyncMock(
            return_value=_single_result(run_id, entity_type_id)
        )
        fake_api_key = MagicMock()
        fake_api_key.get_key_for_provider = AsyncMock(return_value=None)

        with (
            patch(
                "app.services.section_extraction_service.SectionExtractionService",
                return_value=fake_service,
            ),
            patch("app.services.api_key_service.APIKeyService", return_value=fake_api_key),
            patch("app.core.factories.create_storage_adapter", return_value=MagicMock()),
            patch("app.core.deps.get_supabase_client", return_value=MagicMock()),
            patch("app.worker._session.worker_session", new=_session_factory(session)),
        ):
            _apply(payload_dict, user_id)

        session.commit.assert_awaited_once()
        session.rollback.assert_not_awaited()


# ---------------------------------------------------------------------------
# Batch result
# ---------------------------------------------------------------------------


class TestRunSectionExtractionTaskBatch:
    def test_returns_normalized_batch_dict(self):
        run_id = str(uuid4())
        user_id = str(uuid4())
        payload_dict = {
            "projectId": str(uuid4()),
            "articleId": str(uuid4()),
            "templateId": str(uuid4()),
            "runId": str(uuid4()),
        }

        session = _FakeSession()
        fake_service = MagicMock()
        fake_service.run_from_request = AsyncMock(return_value=_batch_result(run_id))
        fake_api_key = MagicMock()
        fake_api_key.get_key_for_provider = AsyncMock(return_value=None)

        with (
            patch(
                "app.services.section_extraction_service.SectionExtractionService",
                return_value=fake_service,
            ),
            patch("app.services.api_key_service.APIKeyService", return_value=fake_api_key),
            patch("app.core.factories.create_storage_adapter", return_value=MagicMock()),
            patch("app.core.deps.get_supabase_client", return_value=MagicMock()),
            patch("app.worker._session.worker_session", new=_session_factory(session)),
        ):
            result = _apply(payload_dict, user_id)

        assert result["mode"] == "batch"
        assert result["extraction_run_id"] == run_id
        assert result["total_sections"] == 3
        assert result["successful_sections"] == 2
        assert result["failed_sections"] == 1
        assert result["total_suggestions_created"] == 7
        assert "suggestions_created" not in result
        # Per-section outcomes must be present for legacy frontend reconstruction
        assert isinstance(result["sections"], list)
        assert len(result["sections"]) == 2
        assert result["sections"][0]["entity_type_id"] == "etype-aaa"
        assert result["sections"][0]["success"] is True
        assert result["sections"][0]["suggestions_created"] == 4
        assert result["sections"][1]["entity_type_id"] == "etype-bbb"
        assert result["sections"][1]["success"] is False
        assert result["sections"][1]["error"] == "timeout"


# ---------------------------------------------------------------------------
# Rollback on exception
# ---------------------------------------------------------------------------


class TestRunSectionExtractionTaskRollback:
    def test_rolls_back_and_reraises_on_exception(self):
        user_id = str(uuid4())
        payload_dict = {
            "projectId": str(uuid4()),
            "articleId": str(uuid4()),
            "templateId": str(uuid4()),
            "entityTypeId": str(uuid4()),
        }

        session = _FakeSession()
        fake_service = MagicMock()
        fake_service.run_from_request = AsyncMock(side_effect=RuntimeError("llm exploded"))
        fake_api_key = MagicMock()
        fake_api_key.get_key_for_provider = AsyncMock(return_value=None)

        with (
            patch(
                "app.services.section_extraction_service.SectionExtractionService",
                return_value=fake_service,
            ),
            patch("app.services.api_key_service.APIKeyService", return_value=fake_api_key),
            patch("app.core.factories.create_storage_adapter", return_value=MagicMock()),
            patch("app.core.deps.get_supabase_client", return_value=MagicMock()),
            patch("app.worker._session.worker_session", new=_session_factory(session)),
            pytest.raises(RuntimeError, match="llm exploded"),
        ):
            _apply(payload_dict, user_id)

        session.rollback.assert_awaited_once()
        session.commit.assert_not_awaited()
