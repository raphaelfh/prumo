"""
Extraction Endpoints Integration Tests.
"""

from unittest.mock import AsyncMock, patch
from uuid import uuid4

import pytest
from httpx import AsyncClient


class TestSectionExtractionEndpoints:
    """Testes de integração para endpoints de extração de seções."""
    
    @pytest.mark.asyncio
    async def test_section_extraction_validation_single_mode(
        self,
        client: AsyncClient,
    ) -> None:
        """Test validação no modo de seção única."""
        # Sem entityTypeId no modo de seção única
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
        """Test validação no modo batch."""
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
        """Test extração com request válida."""
        from app.services.section_extraction_service import SectionExtractionResult
        
        with patch(
            "app.api.v1.endpoints.section_extraction.SectionExtractionService"
        ) as mock_service_class:
            mock_service = mock_service_class.return_value
            mock_service.extract_section = AsyncMock(
                return_value=SectionExtractionResult(
                    run_id=str(uuid4()),
                    entity_type_id=str(uuid4()),
                    suggestions_created=5,
                    tokens_prompt=100,
                    tokens_completion=50,
                    tokens_total=150,
                    duration_ms=1500.0,
                )
            )
            
            response = await client.post(
                "/api/v1/extraction/sections",
                json={
                    "projectId": str(uuid4()),
                    "articleId": str(uuid4()),
                    "templateId": str(uuid4()),
                    "entityTypeId": str(uuid4()),
                },
            )
            
            assert response.status_code == 200
            data = response.json()
            assert data.get("ok") is True
    
    @pytest.mark.asyncio
    async def test_section_extraction_batch_valid_request(
        self,
        client: AsyncClient,
    ) -> None:
        """Test extração em batch com request válida."""
        from app.services.section_extraction_service import BatchExtractionResult
        
        with patch(
            "app.api.v1.endpoints.section_extraction.SectionExtractionService"
        ) as mock_service_class:
            mock_service = mock_service_class.return_value
            mock_service.extract_all_sections = AsyncMock(
                return_value=BatchExtractionResult(
                    run_id=str(uuid4()),
                    total_sections=10,
                    successful_sections=8,
                    failed_sections=2,
                    total_suggestions_created=40,
                    total_tokens_used=1500,
                    duration_ms=5000.0,
                    sections=[],
                )
            )
            
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
            
            assert response.status_code == 200
            data = response.json()
            assert data.get("ok") is True


class TestModelExtractionEndpoints:
    """Testes de integração para endpoints de extração de modelos."""
    
    @pytest.mark.asyncio
    async def test_model_extraction_validation(
        self,
        client: AsyncClient,
    ) -> None:
        """Test validação de model extraction."""
        # Sem campos obrigatórios
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
        """Test extração de modelos com request válida."""
        from app.services.model_extraction_service import ModelExtractionResult
        
        with patch(
            "app.api.v1.endpoints.model_extraction.ModelExtractionService"
        ) as mock_service_class:
            mock_service = mock_service_class.return_value
            mock_service.extract = AsyncMock(
                return_value=ModelExtractionResult(
                    run_id=str(uuid4()),
                    models_created=[],
                    total_models=0,
                    child_instances_created=0,
                    tokens_prompt=100,
                    tokens_completion=50,
                    tokens_total=150,
                    duration_ms=1500.0,
                )
            )
            
            response = await client.post(
                "/api/v1/extraction/models",
                json={
                    "projectId": str(uuid4()),
                    "articleId": str(uuid4()),
                    "templateId": str(uuid4()),
                },
            )
            
            assert response.status_code == 200
            data = response.json()
            assert data.get("ok") is True

