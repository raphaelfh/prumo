"""
Extraction Endpoints Integration Tests.
"""

from collections.abc import Iterator
from contextlib import contextmanager
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest
from httpx import AsyncClient

_SE = "app.api.v1.endpoints.section_extraction"
_JOB_ID = "durable-job"


@contextmanager
def _kickoff_stubs() -> Iterator[MagicMock]:
    """Stub the scope gate, the durable attempt and the queue; yield the enqueue.

    The attempt echoes the normalized payload the way ``prepare_request``
    stores it, so the assertions read what actually reaches the task.
    """
    attempt_id = uuid4()

    async def prepare(payload, owner_id, *, job_id):  # noqa: ANN001
        assert owner_id and job_id
        return SimpleNamespace(
            id=attempt_id, job_id=_JOB_ID, request_payload=payload.model_dump(mode="json")
        )

    with (
        patch(f"{_SE}._is_queue_available", return_value=True),
        patch(f"{_SE}._check_request_scope", new=AsyncMock()),
        patch(
            f"{_SE}.ExtractionAttemptService.prepare_request", new=AsyncMock(side_effect=prepare)
        ),
        patch(f"{_SE}.run_section_extraction_task.apply_async") as enqueue,
        patch(f"{_SE}._remember_job_owner"),
    ):
        enqueue.attempt_id = attempt_id
        yield enqueue


def _assert_enqueued_once(enqueue: MagicMock) -> dict:
    """One enqueue, keyed by the durable attempt; returns the task payload."""
    enqueue.assert_called_once()
    call = enqueue.call_args.kwargs
    assert call["task_id"] == _JOB_ID
    assert call["kwargs"] == {"attempt_id": str(enqueue.attempt_id)}
    return call["args"][0]


class TestSectionExtractionEndpoints:
    """Integration tests for section extraction endpoints."""

    @pytest.mark.asyncio
    async def test_section_extraction_validation_single_mode(
        self,
        client: AsyncClient,
    ) -> None:
        """Test validation in single-section mode."""
        # No entityTypeId in single-section mode
        response = await client.post(
            "/api/v1/extraction/sections",
            json={
                "projectId": str(uuid4()),
                "articleId": str(uuid4()),
                "templateId": str(uuid4()),
                # Falta entityTypeId
            },
        )

        assert response.status_code in (400, 422)

    @pytest.mark.asyncio
    async def test_section_extraction_validation_batch_mode(
        self,
        client: AsyncClient,
    ) -> None:
        """Test validation in batch mode."""
        # extractAllSections=true sem parentInstanceId
        response = await client.post(
            "/api/v1/extraction/sections",
            json={
                "projectId": str(uuid4()),
                "articleId": str(uuid4()),
                "templateId": str(uuid4()),
                "extractAllSections": True,
                # Falta parentInstanceId
            },
        )

        assert response.status_code in (400, 422)

    @pytest.mark.asyncio
    async def test_section_extraction_valid_request(
        self,
        client: AsyncClient,
    ) -> None:
        """A valid single-section request enqueues the Celery job and returns
        202 + the durable attempt's job_id (the extraction runs in the worker)."""
        trace_id = "test-section-trace-id"
        with _kickoff_stubs() as enqueue:
            response = await client.post(
                "/api/v1/extraction/sections",
                json={
                    "projectId": str(uuid4()),
                    "articleId": str(uuid4()),
                    "templateId": str(uuid4()),
                    "entityTypeId": str(uuid4()),
                },
                headers={"X-Trace-Id": trace_id},
            )

        assert response.status_code == 202, response.text
        data = response.json()
        assert data.get("ok") is True
        assert data["data"]["job_id"] == _JOB_ID
        # Snake-case payload reaches the task (SectionExtractionRequest accepts it).
        assert _assert_enqueued_once(enqueue)["entity_type_id"] is not None

    @pytest.mark.asyncio
    async def test_section_extraction_batch_valid_request(
        self,
        client: AsyncClient,
    ) -> None:
        """A valid extract-all-sections request enqueues the job and returns 202."""
        with _kickoff_stubs() as enqueue:
            response = await client.post(
                "/api/v1/extraction/sections",
                json={
                    "projectId": str(uuid4()),
                    "articleId": str(uuid4()),
                    "templateId": str(uuid4()),
                    "extractAllSections": True,
                    "parentInstanceId": str(uuid4()),
                },
            )

        assert response.status_code == 202, response.text
        data = response.json()
        assert data.get("ok") is True
        assert data["data"]["job_id"] == _JOB_ID
        assert _assert_enqueued_once(enqueue)["extract_all_sections"] is True

    @pytest.mark.asyncio
    async def test_run_path_enqueues_job(
        self,
        client: AsyncClient,
    ) -> None:
        """The run_id path also enqueues the async job (202). The all-sections-
        failed FAILED-status-commit behaviour now lives in the Celery task — see
        tests/unit/test_run_section_extraction_task.py
        ::TestRunSectionExtractionTaskAllFailed."""
        run_id = str(uuid4())
        with _kickoff_stubs() as enqueue:
            response = await client.post(
                "/api/v1/extraction/sections",
                json={
                    "projectId": str(uuid4()),
                    "articleId": str(uuid4()),
                    "templateId": str(uuid4()),
                    "runId": run_id,
                },
            )

        assert response.status_code == 202, response.text
        assert response.json()["data"]["job_id"] == _JOB_ID
        assert _assert_enqueued_once(enqueue)["run_id"] == run_id
