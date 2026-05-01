"""
Extraction Endpoints Integration Tests.
"""

from unittest.mock import AsyncMock, patch
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
        """Test extraction with valid request."""
        from app.services.section_extraction_service import SectionExtractionResult

        with patch(
            "app.api.v1.endpoints.section_extraction.SectionExtractionService"
        ) as mock_service_class:
            mock_service = mock_service_class.return_value
            mock_service.extract_section = AsyncMock(
                return_value=SectionExtractionResult(
                    extraction_run_id=str(uuid4()),
                    entity_type_id=str(uuid4()),
                    suggestions_created=5,
                    tokens_prompt=100,
                    tokens_completion=50,
                    tokens_total=150,
                    duration_ms=1500.0,
                )
            )

            trace_id = "test-section-trace-id"
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

            assert response.status_code == 200
            data = response.json()
            assert data.get("ok") is True
            assert data.get("trace_id") == trace_id
            assert response.headers.get("X-Trace-Id") == trace_id
            assert mock_service_class.call_args.kwargs["trace_id"] == trace_id

    @pytest.mark.asyncio
    async def test_section_extraction_batch_valid_request(
        self,
        client: AsyncClient,
    ) -> None:
        """Test batch extraction with valid request."""
        from app.services.section_extraction_service import BatchExtractionResult

        with patch(
            "app.api.v1.endpoints.section_extraction.SectionExtractionService"
        ) as mock_service_class:
            mock_service = mock_service_class.return_value
            mock_service.extract_all_sections = AsyncMock(
                return_value=BatchExtractionResult(
                    extraction_run_id=str(uuid4()),
                    total_sections=10,
                    successful_sections=8,
                    failed_sections=2,
                    total_suggestions_created=40,
                    total_tokens_used=1500,
                    duration_ms=5000.0,
                    sections=[],
                )
            )

            trace_id = "test-batch-trace-id"
            response = await client.post(
                "/api/v1/extraction/sections",
                json={
                    "projectId": str(uuid4()),
                    "articleId": str(uuid4()),
                    "templateId": str(uuid4()),
                    "extractAllSections": True,
                    "parentInstanceId": str(uuid4()),
                },
                headers={"X-Trace-Id": trace_id},
            )

            assert response.status_code == 200
            data = response.json()
            assert data.get("ok") is True
            assert data.get("trace_id") == trace_id
            assert mock_service_class.call_args.kwargs["trace_id"] == trace_id


class TestModelExtractionEndpoints:
    """Integration tests for model extraction endpoints."""

    @pytest.mark.asyncio
    async def test_model_extraction_validation(
        self,
        client: AsyncClient,
    ) -> None:
        """Test model extraction validation."""
        # No required fields
        response = await client.post(
            "/api/v1/extraction/models",
            json={},
        )

        assert response.status_code in (400, 422)

    @pytest.mark.asyncio
    async def test_model_extraction_valid_request(
        self,
        client: AsyncClient,
    ) -> None:
        """Test model extraction with valid request."""
        from app.services.model_extraction_service import ModelExtractionResult

        with patch(
            "app.api.v1.endpoints.model_extraction.ModelExtractionService"
        ) as mock_service_class:
            mock_service = mock_service_class.return_value
            mock_service.extract = AsyncMock(
                return_value=ModelExtractionResult(
                    extraction_run_id=str(uuid4()),
                    models_created=[],
                    total_models=0,
                    child_instances_created=0,
                    tokens_prompt=100,
                    tokens_completion=50,
                    tokens_total=150,
                    duration_ms=1500.0,
                )
            )

            trace_id = "test-model-trace-id"
            response = await client.post(
                "/api/v1/extraction/models",
                json={
                    "projectId": str(uuid4()),
                    "articleId": str(uuid4()),
                    "templateId": str(uuid4()),
                },
                headers={"X-Trace-Id": trace_id},
            )

            assert response.status_code == 200
            data = response.json()
            assert data.get("ok") is True
            assert data.get("trace_id") == trace_id
            assert response.headers.get("X-Trace-Id") == trace_id
            assert mock_service_class.call_args.kwargs["trace_id"] == trace_id


class TestManualModelHierarchyEndpoints:
    """Integration tests for one-shot manual model hierarchy creation."""

    @pytest.mark.asyncio
    async def test_manual_model_hierarchy_validation(
        self,
        client: AsyncClient,
    ) -> None:
        response = await client.post(
            "/api/v1/extraction/models/manual",
            json={},
        )
        assert response.status_code in (400, 422)

    @pytest.mark.asyncio
    async def test_manual_model_hierarchy_success(
        self,
        client: AsyncClient,
    ) -> None:
        from app.services.model_hierarchy_service import (
            ModelHierarchyChild,
            ModelHierarchyResult,
        )

        with patch("app.api.v1.endpoints.model_extraction.ModelHierarchyService") as svc_cls:
            svc = svc_cls.return_value
            svc.create_model_hierarchy = AsyncMock(
                return_value=ModelHierarchyResult(
                    model_id=uuid4(),
                    model_label="Cox Model",
                    child_instances=[
                        ModelHierarchyChild(
                            id=uuid4(),
                            entity_type_id=uuid4(),
                            parent_instance_id=uuid4(),
                            label="Cox Model - Population 1",
                        )
                    ],
                    proposal_run_id=None,
                )
            )

            response = await client.post(
                "/api/v1/extraction/models/manual",
                json={
                    "projectId": str(uuid4()),
                    "articleId": str(uuid4()),
                    "templateId": str(uuid4()),
                    "modelName": "Cox Model",
                    "modellingMethod": "logistic regression",
                },
            )

            assert response.status_code == 201
            payload = response.json()
            assert payload["ok"] is True
            assert payload["data"]["modelLabel"] == "Cox Model"
            assert len(payload["data"]["childInstances"]) == 1
            svc.create_model_hierarchy.assert_awaited_once()
