"""
Extraction Endpoints Integration Tests.
"""

from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest
from httpx import AsyncClient


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
        202 + job_id (the extraction now runs async in the worker)."""
        job_id = str(uuid4())
        mock_task = MagicMock()
        mock_task.id = job_id

        trace_id = "test-section-trace-id"
        with (
            patch(
                "app.api.v1.endpoints.section_extraction._is_queue_available",
                return_value=True,
            ),
            patch(
                "app.api.v1.endpoints.section_extraction._check_request_scope",
                new=AsyncMock(),
            ),
            patch(
                "app.api.v1.endpoints.section_extraction.run_section_extraction_task.delay",
                return_value=mock_task,
            ) as mock_delay,
            patch("app.api.v1.endpoints.section_extraction._remember_job_owner"),
        ):
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
        assert data["data"]["job_id"] == job_id
        mock_delay.assert_called_once()
        # Snake-case payload reaches the task (SectionExtractionRequest accepts it).
        assert mock_delay.call_args[0][0]["entity_type_id"] is not None

    @pytest.mark.asyncio
    async def test_section_extraction_batch_valid_request(
        self,
        client: AsyncClient,
    ) -> None:
        """A valid extract-all-sections request enqueues the job and returns 202."""
        job_id = str(uuid4())
        mock_task = MagicMock()
        mock_task.id = job_id

        with (
            patch(
                "app.api.v1.endpoints.section_extraction._is_queue_available",
                return_value=True,
            ),
            patch(
                "app.api.v1.endpoints.section_extraction._check_request_scope",
                new=AsyncMock(),
            ),
            patch(
                "app.api.v1.endpoints.section_extraction.run_section_extraction_task.delay",
                return_value=mock_task,
            ) as mock_delay,
            patch("app.api.v1.endpoints.section_extraction._remember_job_owner"),
        ):
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
        assert data["data"]["job_id"] == job_id
        mock_delay.assert_called_once()

    @pytest.mark.asyncio
    async def test_run_path_enqueues_job(
        self,
        client: AsyncClient,
    ) -> None:
        """The run_id path also enqueues the async job (202). The all-sections-
        failed FAILED-status-commit behaviour now lives in the Celery task — see
        tests/unit/test_run_section_extraction_task.py
        ::TestRunSectionExtractionTaskAllFailed."""
        job_id = str(uuid4())
        mock_task = MagicMock()
        mock_task.id = job_id

        with (
            patch(
                "app.api.v1.endpoints.section_extraction._is_queue_available",
                return_value=True,
            ),
            patch(
                "app.api.v1.endpoints.section_extraction._check_request_scope",
                new=AsyncMock(),
            ),
            patch(
                "app.api.v1.endpoints.section_extraction.run_section_extraction_task.delay",
                return_value=mock_task,
            ) as mock_delay,
            patch("app.api.v1.endpoints.section_extraction._remember_job_owner"),
        ):
            response = await client.post(
                "/api/v1/extraction/sections",
                json={
                    "projectId": str(uuid4()),
                    "articleId": str(uuid4()),
                    "templateId": str(uuid4()),
                    "runId": str(uuid4()),
                },
            )

        assert response.status_code == 202, response.text
        assert response.json()["data"]["job_id"] == job_id
        mock_delay.assert_called_once()
