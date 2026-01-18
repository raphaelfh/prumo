"""
Unit tests for AIAssessmentService.

Testa funcionalidades de avaliação AI:
- Preparação de arquivos PDF
- Construção de prompts
- Chamadas à OpenAI API
- Processamento de respostas
"""

import base64
import json
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.ai_assessment_service import AIAssessmentService
from app.infrastructure.storage import StorageAdapter


@pytest.fixture
def mock_db():
    """Mock da sessão de banco."""
    return AsyncMock(spec=AsyncSession)


@pytest.fixture
def mock_storage():
    """Mock do StorageAdapter."""
    mock = MagicMock(spec=StorageAdapter)
    mock.download = AsyncMock(return_value=b"%PDF-1.4 test content")
    return mock


@pytest.fixture
def service(mock_db, mock_storage):
    """Fixture do AIAssessmentService com mocks."""
    with patch("app.services.ai_assessment_service.ArticleRepository") as mock_article_repo, \
         patch("app.services.ai_assessment_service.ArticleFileRepository") as mock_file_repo, \
         patch("app.services.ai_assessment_service.ProjectRepository") as mock_project_repo, \
         patch("app.services.ai_assessment_service.AssessmentItemRepository") as mock_item_repo, \
         patch("app.services.ai_assessment_service.AIAssessmentRepository") as mock_assessment_repo:
        
        # Mock repositories
        mock_article_repo_instance = MagicMock()
        mock_article_repo.return_value = mock_article_repo_instance
        
        mock_file_repo_instance = MagicMock()
        mock_file_repo.return_value = mock_file_repo_instance
        
        mock_project_repo_instance = MagicMock()
        mock_project_repo.return_value = mock_project_repo_instance
        
        mock_item_repo_instance = MagicMock()
        mock_item_repo.return_value = mock_item_repo_instance
        
        mock_assessment_repo_instance = MagicMock()
        mock_assessment_repo.return_value = mock_assessment_repo_instance
        
        svc = AIAssessmentService(
            db=mock_db,
            user_id="12345678-1234-1234-1234-123456789012",
            storage=mock_storage,
            trace_id="trace-123",
        )
        svc._articles = mock_article_repo_instance
        svc._article_files = mock_file_repo_instance
        svc._projects = mock_project_repo_instance
        svc._assessment_items = mock_item_repo_instance
        svc._ai_assessments = mock_assessment_repo_instance
        
        return svc


class TestAIAssessmentServicePrompt:
    """Testes de construção de prompts."""

    def test_build_user_prompt(self, service):
        """Testa construção do prompt de usuário."""
        # Create mock item with attributes
        item = MagicMock()
        item.question = "Is the study design clearly described?"
        item.allowed_levels = ["Yes", "Partially", "No", "Unclear"]
        
        # Create mock project summary
        project_summary = {
            "review_title": "Systematic Review of Treatment X",
            "condition_studied": "Type 2 Diabetes",
        }
        
        prompt = service._build_user_prompt(item, project_summary, ["Yes", "Partially", "No"])
        
        # Should include the question
        assert "study design" in prompt.lower() or "Is the study design" in prompt
        # Should include allowed levels
        assert "Yes" in prompt or "yes" in prompt.lower()

    def test_build_response_schema(self, service):
        """Testa construção do schema de resposta."""
        allowed_levels = ["High", "Medium", "Low"]
        
        schema = service._build_response_schema(allowed_levels)
        
        assert schema["type"] == "json_schema"
        assert "selected_level" in schema["json_schema"]["schema"]["properties"]

    def test_build_response_schema_empty_levels(self, service):
        """Testa schema com níveis vazios."""
        schema = service._build_response_schema([])
        
        # Should handle empty levels gracefully
        assert schema["type"] == "json_schema"
        assert "selected_level" in schema["json_schema"]["schema"]["properties"]


class TestAIAssessmentServicePDF:
    """Testes de preparação de PDFs."""

    @pytest.mark.asyncio
    async def test_prepare_pdf_with_file_id(self, service):
        """Testa preparação com file_id existente."""
        result, size = await service._prepare_pdf_file(
            pdf_file_id="file-abc123",
            pdf_base64=None,
            pdf_filename=None,
            storage_key=None,
        )
        
        assert result["type"] == "input_file"
        assert result["file_id"] == "file-abc123"
        assert size is None

    @pytest.mark.asyncio
    async def test_prepare_pdf_with_base64(self, service):
        """Testa preparação com base64."""
        pdf_content = b"%PDF-1.4 test content"
        pdf_base64 = base64.b64encode(pdf_content).decode()
        
        result, size = await service._prepare_pdf_file(
            pdf_file_id=None,
            pdf_base64=pdf_base64,
            pdf_filename="test.pdf",
            storage_key=None,
        )
        
        assert result["type"] == "input_file"
        assert result["filename"] == "test.pdf"
        assert "data:application/pdf;base64," in result["file_data"]
        assert size == len(pdf_content)

    @pytest.mark.asyncio
    async def test_prepare_pdf_with_storage_key(self, service, mock_storage):
        """Testa preparação com storage_key."""
        pdf_content = b"%PDF-1.4 stored content"
        
        # Storage download takes (bucket, key)
        mock_storage.download = AsyncMock(return_value=pdf_content)
        
        result, size = await service._prepare_pdf_file(
            pdf_file_id=None,
            pdf_base64=None,
            pdf_filename=None,
            storage_key="project-123/article-456/paper.pdf",
        )
        
        assert result["type"] == "input_file"
        assert result["filename"] == "paper.pdf"
        assert size == len(pdf_content)
        mock_storage.download.assert_called_once_with("articles", "project-123/article-456/paper.pdf")

    @pytest.mark.asyncio
    async def test_prepare_pdf_no_source(self, service):
        """Testa erro quando nenhuma fonte fornecida."""
        with pytest.raises(ValueError, match="No PDF source"):
            await service._prepare_pdf_file(
                pdf_file_id=None,
                pdf_base64=None,
                pdf_filename=None,
                storage_key=None,
            )


class TestAIAssessmentServiceAPI:
    """Testes de chamadas à API OpenAI."""

    @pytest.mark.asyncio
    async def test_call_direct_success(self, service):
        """Testa chamada direta bem-sucedida."""
        input_file_node = {
            "type": "input_file",
            "file_data": "data:application/pdf;base64,xxx",
            "filename": "test.pdf",
        }
        
        mock_response_data = {
            "output": [
                {
                    "type": "message",
                    "content": [
                        {
                            "type": "output_text",
                            "text": json.dumps({
                                "selected_level": "High",
                                "confidence_score": 0.9,
                                "justification": "Clear methodology",
                                "evidence_passages": [{"text": "We used...", "page_number": 3}],
                            }),
                        }
                    ],
                }
            ],
            "usage": {"input_tokens": 1000, "output_tokens": 200},
        }
        
        with patch("httpx.AsyncClient") as mock_client:
            mock_response = MagicMock()
            mock_response.is_success = True
            mock_response.json.return_value = mock_response_data
            
            mock_client.return_value.__aenter__.return_value.post = AsyncMock(
                return_value=mock_response
            )
            
            result = await service._call_direct(
                input_file_node=input_file_node,
                system_prompt="You are an expert...",
                user_prompt="Assess this article...",
                response_format={"type": "json_schema", "json_schema": {}},
                model="gpt-4o-mini",
            )
        
        assert result["output_text"] is not None
        output = json.loads(result["output_text"])
        assert output["selected_level"] == "High"
        assert result["input_tokens"] == 1000
        assert result["output_tokens"] == 200

    @pytest.mark.asyncio
    async def test_call_direct_api_error(self, service):
        """Testa erro na API OpenAI."""
        input_file_node = {"type": "input_file", "file_id": "xxx"}
        
        with patch("httpx.AsyncClient") as mock_client:
            mock_response = MagicMock()
            mock_response.is_success = False
            mock_response.status_code = 429
            mock_response.text = "Rate limit exceeded"
            
            mock_client.return_value.__aenter__.return_value.post = AsyncMock(
                return_value=mock_response
            )
            
            with pytest.raises(ValueError, match="OpenAI error: 429"):
                await service._call_direct(
                    input_file_node=input_file_node,
                    system_prompt="Test",
                    user_prompt="Test",
                    response_format={},
                    model="gpt-4o-mini",
                )


class TestAIAssessmentServiceAssess:
    """Testes do método principal assess()."""

    @pytest.mark.asyncio
    async def test_assess_full_flow(self, service, mock_storage):
        """Testa fluxo completo de assessment."""
        project_id = uuid4()
        article_id = uuid4()
        item_id = uuid4()
        instrument_id = uuid4()
        assessment_id = uuid4()
        
        # Mock assessment_item
        mock_item = MagicMock()
        mock_item.id = item_id
        mock_item.question = "Test question?"
        mock_item.allowed_levels = ["Yes", "No"]
        service._assessment_items.get_by_id = AsyncMock(return_value=mock_item)
        
        # Mock article
        mock_article = MagicMock()
        mock_article.id = article_id
        mock_article.title = "Test Article"
        service._articles.get_by_id = AsyncMock(return_value=mock_article)
        
        # Mock article file
        mock_file = MagicMock()
        mock_file.storage_key = "test/paper.pdf"
        service._article_files.get_latest_pdf = AsyncMock(return_value=mock_file)
        
        # Mock project summary
        project_summary = {
            "review_title": "Test Review",
            "condition_studied": "Test Condition",
            "description": "Test description",
        }
        service._projects.get_summary = AsyncMock(return_value=project_summary)
        
        # Mock AI assessment creation
        mock_assessment = MagicMock()
        mock_assessment.id = assessment_id
        mock_assessment.selected_level = "Yes"
        mock_assessment.confidence_score = 0.85
        mock_assessment.justification = "Clearly stated"
        mock_assessment.evidence_passages = []
        service._ai_assessments.create = AsyncMock(return_value=mock_assessment)
        
        # PDF em base64
        pdf_content = b"%PDF-1.4 test"
        pdf_base64 = base64.b64encode(pdf_content).decode()
        
        ai_response = {
            "output": [
                {
                    "type": "message",
                    "content": [
                        {
                            "type": "output_text",
                            "text": json.dumps({
                                "selected_level": "Yes",
                                "confidence_score": 0.85,
                                "justification": "Clearly stated",
                                "evidence_passages": [],
                            }),
                        }
                    ],
                }
            ],
            "usage": {"input_tokens": 500, "output_tokens": 100},
        }
        
        with patch("httpx.AsyncClient") as mock_client, \
             patch("app.services.ai_assessment_service.AIAssessment") as mock_ai_assessment_class:
            mock_response = MagicMock()
            mock_response.is_success = True
            mock_response.json.return_value = ai_response
            
            mock_client.return_value.__aenter__.return_value.post = AsyncMock(
                return_value=mock_response
            )
            
            # Mock the AIAssessment model class to avoid SQLAlchemy mapper issues
            mock_ai_assessment_instance = MagicMock()
            mock_ai_assessment_class.return_value = mock_ai_assessment_instance
            
            result = await service.assess(
                project_id=project_id,
                article_id=article_id,
                assessment_item_id=item_id,
                instrument_id=instrument_id,
                pdf_base64=pdf_base64,
                pdf_filename="test.pdf",
            )
        
        # Verificar que foi inserido no banco via repository
        service._ai_assessments.create.assert_called_once()
        assert result.selected_level == "Yes"


class TestAIAssessmentServiceEdgeCases:
    """Testes de casos de borda."""

    def test_parse_allowed_levels_as_string(self, service):
        """Testa quando allowed_levels vem como string JSON."""
        result = service._parse_allowed_levels('["Yes", "No", "NA"]')
        assert result == ["Yes", "No", "NA"]

    def test_parse_allowed_levels_as_list(self, service):
        """Testa quando allowed_levels já é lista."""
        result = service._parse_allowed_levels(["Yes", "No"])
        assert result == ["Yes", "No"]

    def test_parse_allowed_levels_empty(self, service):
        """Testa quando allowed_levels é vazio."""
        result = service._parse_allowed_levels(None)
        assert result == []
