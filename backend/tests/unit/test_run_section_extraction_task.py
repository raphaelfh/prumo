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

from app.llm.provider import MissingLLMKeyError
from app.schemas.extraction import ExtractionErrorCode
from app.schemas.llm_target import LlmTarget
from app.services.extraction_errors import ExtractionTaskError
from app.services.llm_engine_service import EngineRetiredError
from app.services.section_extraction_service import (
    BatchAllSectionsFailed,
    BatchExtractionResult,
    SectionExtractionResult,
)
from app.worker.celery_app import celery_app
from app.worker.tasks import extraction_tasks
from app.worker.tasks.extraction_tasks import run_section_extraction_task

# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def eager_mode(monkeypatch: pytest.MonkeyPatch) -> None:
    """Run every Celery task synchronously in the pytest process."""
    monkeypatch.setattr(celery_app.conf, "task_always_eager", True)
    monkeypatch.setattr(celery_app.conf, "task_eager_propagates", True)


@pytest.fixture(autouse=True)
def engine_seams(monkeypatch: pytest.MonkeyPatch) -> LlmTarget:
    """Patch the task-module engine seams — ``_FakeSession`` has no ``execute``
    or ``get``, so the real resolver cannot run here."""
    target = LlmTarget(provider="openai", model="task-resolved-model")
    monkeypatch.setattr(
        extraction_tasks,
        "resolve_project_engine",
        AsyncMock(return_value=target),
    )
    monkeypatch.setattr(extraction_tasks, "resolve_engine_for_run", AsyncMock(return_value=target))
    return target


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


#: The engine a fresh project resolve yields, distinct from any run pin.
_PROJECT_ENGINE = LlmTarget(provider="openai", model="project-current-model")


def _apply(payload_dict: dict, user_id: str, trace_id: str | None = None, retries: int = 0) -> dict:
    """One attempt. ``retries`` is Celery's attempt counter (0 = kickoff)."""
    return run_section_extraction_task.apply(
        kwargs={"payload_json": payload_dict, "user_id": user_id, "trace_id": trace_id},
        retries=retries,
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
            patch("app.services.engine_credentials.APIKeyService", return_value=fake_api_key),
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
            patch("app.services.engine_credentials.APIKeyService", return_value=fake_api_key),
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
            patch("app.services.engine_credentials.APIKeyService", return_value=fake_api_key),
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
    def test_rolls_back_and_raises_coded_error_on_exception(self):
        """An unknown failure rolls back and surfaces as a coded
        ``ExtractionTaskError`` (generic code) instead of leaking the raw
        exception type — so the status endpoint always has a code to read."""
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
            patch("app.services.engine_credentials.APIKeyService", return_value=fake_api_key),
            patch("app.core.factories.create_storage_adapter", return_value=MagicMock()),
            patch("app.core.deps.get_supabase_client", return_value=MagicMock()),
            patch("app.worker._session.worker_session", new=_session_factory(session)),
            pytest.raises(ExtractionTaskError) as exc_info,
        ):
            _apply(payload_dict, user_id)

        assert exc_info.value.error_code == ExtractionErrorCode.EXTRACTION_FAILED.value
        assert str(exc_info.value) == "llm exploded"
        session.rollback.assert_awaited_once()
        session.commit.assert_not_awaited()


class TestRunSectionExtractionTaskAllFailed:
    def test_commits_failed_status_on_batch_all_sections_failed(self):
        """When the service raises BatchAllSectionsFailed it has already marked the
        run FAILED (rollback_and_fail); the task must COMMIT that terminal status
        (not roll it back) and surface a coded error, so the failed run is visible
        to status polls — mirrors the pre-async endpoint's handling."""
        user_id = str(uuid4())
        payload_dict = {
            "projectId": str(uuid4()),
            "articleId": str(uuid4()),
            "templateId": str(uuid4()),
            "runId": str(uuid4()),
        }

        session = _FakeSession()
        fake_service = MagicMock()
        fake_service.run_from_request = AsyncMock(
            side_effect=BatchAllSectionsFailed("all 3 sections failed")
        )
        fake_api_key = MagicMock()
        fake_api_key.get_key_for_provider = AsyncMock(return_value=None)

        with (
            patch(
                "app.services.section_extraction_service.SectionExtractionService",
                return_value=fake_service,
            ),
            patch("app.services.engine_credentials.APIKeyService", return_value=fake_api_key),
            patch("app.core.factories.create_storage_adapter", return_value=MagicMock()),
            patch("app.core.deps.get_supabase_client", return_value=MagicMock()),
            patch("app.worker._session.worker_session", new=_session_factory(session)),
            pytest.raises(ExtractionTaskError) as exc_info,
        ):
            _apply(payload_dict, user_id)

        assert exc_info.value.error_code == ExtractionErrorCode.EXTRACTION_FAILED.value
        assert str(exc_info.value) == "all 3 sections failed"
        session.commit.assert_awaited_once()
        session.rollback.assert_not_awaited()


class TestRunSectionExtractionTaskErrorCode:
    """The task attaches a stable ``ExtractionErrorCode`` for the failure modes
    the pipeline raises by type, so the status endpoint can surface specific
    frontend copy without parsing the exception repr."""

    def _run_with_side_effect(self, exc: Exception) -> ExtractionTaskError:
        user_id = str(uuid4())
        payload_dict = {
            "projectId": str(uuid4()),
            "articleId": str(uuid4()),
            "templateId": str(uuid4()),
            "entityTypeId": str(uuid4()),
        }

        session = _FakeSession()
        fake_service = MagicMock()
        fake_service.run_from_request = AsyncMock(side_effect=exc)
        fake_api_key = MagicMock()
        fake_api_key.get_key_for_provider = AsyncMock(return_value=None)

        with (
            patch(
                "app.services.section_extraction_service.SectionExtractionService",
                return_value=fake_service,
            ),
            patch("app.services.engine_credentials.APIKeyService", return_value=fake_api_key),
            patch("app.core.factories.create_storage_adapter", return_value=MagicMock()),
            patch("app.core.deps.get_supabase_client", return_value=MagicMock()),
            patch("app.worker._session.worker_session", new=_session_factory(session)),
            pytest.raises(ExtractionTaskError) as exc_info,
        ):
            _apply(payload_dict, user_id)
        return exc_info.value

    def test_missing_pdf_carries_pdf_not_found_code(self):
        err = self._run_with_side_effect(FileNotFoundError("No PDF for article abc"))
        assert err.error_code == ExtractionErrorCode.PDF_NOT_FOUND.value
        assert str(err) == "PDF not found. Upload a PDF first."

    def test_missing_llm_key_carries_missing_api_key_code(self):
        err = self._run_with_side_effect(
            MissingLLMKeyError("No OpenAI API key available: pass a BYOK key.")
        )
        assert err.error_code == ExtractionErrorCode.MISSING_API_KEY.value
        assert str(err) == "No OpenAI API key available: pass a BYOK key."

    def test_missing_entity_key_carries_missing_entity_key_code(self):
        from app.services.entity_key import MissingEntityKeyError

        exc = MissingEntityKeyError(uuid4(), "Final predictors")
        err = self._run_with_side_effect(exc)
        assert err.error_code == ExtractionErrorCode.MISSING_ENTITY_KEY.value
        assert str(err) == str(exc)


class TestRunSectionExtractionTaskEngineRetired:
    def test_retired_mid_flight_carries_engine_retired_code(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """The roster can drop the stored pair AFTER enqueue-time validation
        passed. The terminal classify path must ship the friendly code, not
        EXTRACTION_FAILED — the frontend copy depends on it."""
        user_id = str(uuid4())
        payload_dict = {
            "projectId": str(uuid4()),
            "articleId": str(uuid4()),
            "templateId": str(uuid4()),
            "entityTypeId": str(uuid4()),
        }

        # Raised through the task's resolver seam — in production
        # ``resolve_engine_for_run`` delegates to ``resolve_project_engine``,
        # which is where the roster check actually lives.
        monkeypatch.setattr(
            extraction_tasks,
            "resolve_engine_for_run",
            AsyncMock(
                side_effect=EngineRetiredError(
                    "The project's stored engine openai:gone is no longer available."
                )
            ),
        )

        session = _FakeSession()
        fake_api_key = MagicMock()
        fake_api_key.get_key_for_provider = AsyncMock(return_value=None)

        with (
            patch("app.services.engine_credentials.APIKeyService", return_value=fake_api_key),
            patch("app.core.factories.create_storage_adapter", return_value=MagicMock()),
            patch("app.core.deps.get_supabase_client", return_value=MagicMock()),
            patch("app.worker._session.worker_session", new=_session_factory(session)),
            pytest.raises(ExtractionTaskError) as exc_info,
        ):
            _apply(payload_dict, user_id)

        assert exc_info.value.error_code == ExtractionErrorCode.ENGINE_RETIRED.value
        assert "no longer available" in str(exc_info.value)
        session.rollback.assert_awaited_once()
        session.commit.assert_not_awaited()


# ---------------------------------------------------------------------------
# Human kickoff vs Celery retry — which engine the attempt runs
# ---------------------------------------------------------------------------


class TestHumanKickoffVersusRetry:
    """The engine pin is owed to a RETRY, not to the run for its whole life.

    ``run_section_extraction_task`` has exactly one enqueue site — the HTTP
    endpoint — and a retry re-enters through ``self.retry`` with the same
    payload, never through that endpoint. So ``self.request.retries`` IS the
    human/retry boundary, and it is the only thing standing between "the
    manager's model choice reaches the extraction" (#609's fix must not eat
    it) and "attempt 2 runs a different engine than attempt 1" (#609 itself).

    Both halves are asserted at the seam the worker actually uses: which
    engine reaches ``run_from_request``, and the ``repin`` the service is
    built with.
    """

    #: What the run is already pinned to when the attempt starts.
    _PINNED = LlmTarget(provider="anthropic", model="stale-pinned-model")

    def _apply_attempt(
        self, monkeypatch: pytest.MonkeyPatch, retries: int
    ) -> tuple[dict[str, Any], MagicMock, AsyncMock]:
        """Run one attempt; return (ctor kwargs, service mock, resolver mock).

        The resolver stands in for the real one: it honours ``repin`` the way
        ``resolve_engine_for_run`` does, so the assertions read as "which
        engine did this attempt run", not "which flag was passed".
        """
        run_id = str(uuid4())
        payload_dict = {
            "projectId": str(uuid4()),
            "articleId": str(uuid4()),
            "templateId": str(uuid4()),
            "entityTypeId": str(uuid4()),
            "runId": run_id,
        }

        async def _resolve(_db: Any, **kw: Any) -> LlmTarget:
            return _PROJECT_ENGINE if kw["repin"] else self._PINNED

        resolver = AsyncMock(side_effect=_resolve)
        monkeypatch.setattr(extraction_tasks, "resolve_engine_for_run", resolver)

        ctor: dict[str, Any] = {}
        fake_service = MagicMock()
        fake_service.run_from_request = AsyncMock(
            return_value=_single_result(run_id, payload_dict["entityTypeId"])
        )

        def _capture(**kwargs: Any) -> MagicMock:
            ctor.update(kwargs)
            return fake_service

        fake_api_key = MagicMock()
        fake_api_key.get_key_for_provider = AsyncMock(return_value=None)
        session = _FakeSession()

        with (
            patch(
                "app.services.section_extraction_service.SectionExtractionService",
                side_effect=_capture,
            ),
            patch("app.services.engine_credentials.APIKeyService", return_value=fake_api_key),
            patch("app.core.factories.create_storage_adapter", return_value=MagicMock()),
            patch("app.core.deps.get_supabase_client", return_value=MagicMock()),
            patch("app.worker._session.worker_session", new=_session_factory(session)),
        ):
            _apply(payload_dict, str(uuid4()), "trace-repin", retries=retries)

        return ctor, fake_service, resolver

    def test_first_attempt_is_a_kickoff_that_ignores_the_stale_pin(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Attempt 0 came from a human click: run the manager's CURRENT engine.

        ``repin`` must reach BOTH collaborators — the resolver (so the key is
        looked up for the engine that will run) and the service (so the run's
        pin is rewritten to match). Telling only one of them is how the
        executed engine and the recorded engine drift apart.
        """
        ctor, service, resolver = self._apply_attempt(monkeypatch, retries=0)

        assert resolver.await_args.kwargs["repin"] is True, (
            "attempt 0 was not resolved as a human kickoff"
        )
        assert ctor["repin"] is True, "the service was not told to re-pin"
        assert service.run_from_request.await_args.kwargs["engine"] == _PROJECT_ENGINE, (
            "the kickoff ran the stale pin instead of the project engine"
        )

    def test_retry_stays_on_the_engine_attempt_one_ran(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Attempt >= 1 is a Celery retry: reuse the pin, never re-resolve.

        The payload carries no model, so without this every attempt would be
        free to pick up a mid-flight engine change (#609).
        """
        ctor, service, resolver = self._apply_attempt(monkeypatch, retries=1)

        assert resolver.await_args.kwargs["repin"] is False, (
            "a retry was resolved as a human kickoff"
        )
        assert ctor["repin"] is False, "a retry told the service to re-pin"
        assert service.run_from_request.await_args.kwargs["engine"] == self._PINNED, (
            "the retry abandoned the engine attempt 1 ran"
        )
