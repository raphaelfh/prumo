"""
Unit tests for ModelExtractionService.

Tests model extraction features:
- Model identification with LLM
- Instance creation
- Child instance hierarchy
"""

from unittest.mock import ANY, AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.infrastructure.storage import StorageAdapter
from app.llm.extractor import LlmUsage
from app.llm.prompts.model_identification import IdentifiedModel, ModelIdentificationOutput
from app.services.model_extraction_service import ModelExtractionService


@pytest.fixture
def mock_db():
    """Mock database session."""
    return AsyncMock(spec=AsyncSession)


@pytest.fixture
def mock_storage():
    """Mock StorageAdapter."""
    mock = MagicMock(spec=StorageAdapter)
    mock.download = AsyncMock(return_value=b"%PDF-1.4 test content")
    return mock


@pytest.fixture
def service(mock_db, mock_storage):
    """ModelExtractionService fixture with mocks."""
    with (
        patch("app.services.model_extraction_service.PDFProcessor") as mock_pdf,
        patch("app.services.model_extraction_service.ArticleFileRepository") as mock_article_repo,
        patch(
            "app.services.model_extraction_service.ExtractionTemplateRepository"
        ) as mock_template_repo,
        patch("app.services.model_extraction_service.GlobalTemplateRepository") as mock_global_repo,
        patch(
            "app.services.model_extraction_service.ExtractionEntityTypeRepository"
        ) as mock_entity_repo,
        patch(
            "app.services.model_extraction_service.ExtractionInstanceRepository"
        ) as mock_instance_repo,
        patch("app.services.model_extraction_service.ExtractionRunRepository") as mock_run_repo,
        patch("app.services.model_extraction_service.RunLifecycleService") as mock_lifecycle_cls,
    ):
        mock_pdf_instance = MagicMock()
        mock_pdf.return_value = mock_pdf_instance

        # Mock repositories
        mock_article_repo_instance = MagicMock()
        mock_article_repo.return_value = mock_article_repo_instance

        mock_template_repo_instance = MagicMock()
        mock_template_repo.return_value = mock_template_repo_instance

        mock_global_repo_instance = MagicMock()
        mock_global_repo.return_value = mock_global_repo_instance

        mock_entity_repo_instance = MagicMock()
        mock_entity_repo.return_value = mock_entity_repo_instance

        mock_instance_repo_instance = MagicMock()
        mock_instance_repo.return_value = mock_instance_repo_instance

        mock_run_repo_instance = MagicMock()
        mock_run_repo.return_value = mock_run_repo_instance

        # The new service uses RunLifecycleService for run creation; we
        # mock it here so the fixture stays decoupled from the lifecycle
        # repository chain. Tests that need a specific run can override
        # `mock_lifecycle.create_run.return_value` and `.advance_stage`.
        mock_lifecycle_instance = MagicMock()
        mock_lifecycle_instance.create_run = AsyncMock()
        mock_lifecycle_instance.advance_stage = AsyncMock()
        mock_lifecycle_cls.return_value = mock_lifecycle_instance

        svc = ModelExtractionService(
            db=mock_db,
            user_id="12345678-1234-1234-1234-123456789012",
            storage=mock_storage,
            trace_id="trace-123",
        )
        svc.pdf_processor = mock_pdf_instance
        svc._article_files = mock_article_repo_instance
        svc._templates = mock_template_repo_instance
        svc._global_templates = mock_global_repo_instance
        svc._entity_types = mock_entity_repo_instance
        svc._instances = mock_instance_repo_instance
        svc._runs = mock_run_repo_instance
        svc._lifecycle = mock_lifecycle_instance

        return svc


class TestModelExtractionPDF:
    """Tests for PDF fetch and download."""

    @pytest.mark.asyncio
    async def test_get_pdf_success(self, service, mock_storage):
        """Test successful PDF fetch."""
        article_id = uuid4()
        pdf_content = b"%PDF-1.4 test content"

        # Mock article_files repository
        mock_file = MagicMock()
        mock_file.storage_key = "test-project/article.pdf"
        service._article_files.get_latest_pdf = AsyncMock(return_value=mock_file)

        # Mock storage adapter - note: takes (bucket, key)
        mock_storage.download = AsyncMock(return_value=pdf_content)

        result = await service._get_pdf(article_id)

        assert result == pdf_content
        service._article_files.get_latest_pdf.assert_called_once_with(article_id)
        mock_storage.download.assert_called_once_with("articles", "test-project/article.pdf")

    @pytest.mark.asyncio
    async def test_get_pdf_not_found(
        self,
        service,
        mock_storage,  # noqa: ARG002
    ):
        """Test error when PDF not found."""
        article_id = uuid4()

        # Mock article_files repository returns None
        service._article_files.get_latest_pdf = AsyncMock(return_value=None)

        with pytest.raises(FileNotFoundError, match="PDF not found"):
            await service._get_pdf(article_id)


class TestModelExtractionTemplate:
    """Tests for template lookup."""

    @pytest.mark.asyncio
    async def test_get_template_project_template(self, service):
        """Test project template lookup."""
        template_id = uuid4()

        # Mock project template
        mock_entity_type = MagicMock()
        mock_entity_type.name = "prediction_models"
        mock_entity_type.role = "model_container"

        mock_template = MagicMock()
        mock_template.id = template_id
        mock_template.name = "Project Template"
        mock_template.entity_types = [mock_entity_type]

        service._templates.get_with_entity_types = AsyncMock(return_value=mock_template)

        result = await service._get_template(template_id)

        # Returns template object directly
        assert result.name == "Project Template"
        service._templates.get_with_entity_types.assert_called_once_with(template_id)

    @pytest.mark.asyncio
    async def test_get_template_global_fallback(self, service):
        """Test fallback to global template."""
        template_id = uuid4()

        # Mock project template returns None (not found)
        service._templates.get_with_entity_types = AsyncMock(return_value=None)

        # Mock global template
        mock_global = MagicMock()
        mock_global.id = template_id
        mock_global.name = "Global Template"
        mock_global.entity_types = []

        service._global_templates.get_by_id = AsyncMock(return_value=mock_global)

        result = await service._get_template(template_id)

        assert result.name == "Global Template"

    @pytest.mark.asyncio
    async def test_get_template_not_found(self, service):
        """Test error when template not found."""
        template_id = uuid4()

        # Mock both repos return None
        service._templates.get_with_entity_types = AsyncMock(return_value=None)
        service._global_templates.get_by_id = AsyncMock(return_value=None)

        with pytest.raises(ValueError, match="Template not found"):
            await service._get_template(template_id)


class TestModelIdentification:
    """Tests for model identification."""

    @pytest.mark.asyncio
    async def test_identify_models_success(self, service):
        """Test successful model identification."""
        mock_entity_type = MagicMock()
        mock_entity_type.name = "prediction_models"
        mock_entity_type.role = "model_container"

        template = MagicMock()
        template.entity_types = [mock_entity_type]

        with (
            patch(
                "app.services.model_extraction_service.extract_structured",
                AsyncMock(
                    return_value=(
                        ModelIdentificationOutput(
                            models=[
                                IdentifiedModel(name="QSOFA Score"),
                                IdentifiedModel(name="NEWS Score"),
                            ]
                        ),
                        LlmUsage(prompt_tokens=100, completion_tokens=50),
                    )
                ),
            ),
            patch("app.services.model_extraction_service.build_model", MagicMock()),
        ):
            models, usage = await service._identify_models(
                pdf_text="Sample PDF text with model descriptions...",
                template=template,
                model="gpt-4o-mini",
            )

        assert len(models) == 2
        assert models[0]["name"] == "QSOFA Score"
        assert models[1]["name"] == "NEWS Score"
        assert usage.prompt_tokens == 100
        assert usage.completion_tokens == 50
        assert usage.total_tokens == 150

    @pytest.mark.asyncio
    async def test_identify_models_no_models_found(self, service):
        """Test when no model is found."""
        template = MagicMock()
        template.entity_types = []

        with (
            patch(
                "app.services.model_extraction_service.extract_structured",
                AsyncMock(
                    return_value=(
                        ModelIdentificationOutput(models=[]),
                        LlmUsage(prompt_tokens=50, completion_tokens=20),
                    )
                ),
            ),
            patch("app.services.model_extraction_service.build_model", MagicMock()),
        ):
            models, usage = await service._identify_models(
                pdf_text="Generic article text without models...",
                template=template,
                model="gpt-4o-mini",
            )

        assert models == []
        assert usage.total_tokens == 70


class TestEntityTypeLookup:
    """Tests for entity type lookup."""

    @pytest.mark.asyncio
    async def test_get_model_container_entity_type_id(self, service):
        """Test entity type lookup by structural role (was: by name)."""
        template_id = uuid4()
        entity_type_id = uuid4()

        # Mock entity type for the template's model container.
        mock_entity = MagicMock()
        mock_entity.id = entity_type_id

        service._entity_types.get_by_role = AsyncMock(return_value=mock_entity)

        result = await service._get_model_container_entity_type_id(template_id)

        # Returns str of entity_type_id
        assert result == str(entity_type_id)
        service._entity_types.get_by_role.assert_called()
        # First call asks for project-scope (is_project_template=True).
        first_call = service._entity_types.get_by_role.call_args_list[0]
        assert first_call.args[0] == "model_container"

    @pytest.mark.asyncio
    async def test_get_child_entity_types(self, service):
        """Test child entity types lookup."""
        template_id = uuid4()
        parent_id = str(uuid4())

        # Mock child entity types
        mock_child1 = MagicMock()
        mock_child1.id = uuid4()
        mock_child1.name = "predictors"
        mock_child1.label = "Predictors"
        mock_child1.cardinality = "one"

        mock_child2 = MagicMock()
        mock_child2.id = uuid4()
        mock_child2.name = "performance"
        mock_child2.label = "Model Performance"
        mock_child2.cardinality = "one"

        service._entity_types.get_children = AsyncMock(return_value=[mock_child1, mock_child2])

        result = await service._get_child_entity_types(parent_id, template_id)

        # Returns entity type objects directly, not dicts
        assert len(result) == 2
        assert result[0].name == "predictors"


class TestFullExtractionFlow:
    """Tests for full extraction flow."""

    @pytest.mark.asyncio
    async def test_extract_full_flow(self, service, mock_storage):
        """Test full model extraction flow."""
        project_id = uuid4()
        article_id = uuid4()
        template_id = uuid4()
        run_id = uuid4()
        entity_type_id = uuid4()

        # Mock _get_pdf
        pdf_content = b"%PDF test"
        mock_storage.download = AsyncMock(return_value=pdf_content)

        # Mock article file
        mock_file = MagicMock()
        mock_file.storage_key = "test.pdf"
        service._article_files.get_latest_pdf = AsyncMock(return_value=mock_file)

        # Mock template with entity types
        mock_entity_type = MagicMock()
        mock_entity_type.name = "prediction_models"
        mock_entity_type.role = "model_container"

        mock_template = MagicMock()
        mock_template.id = template_id
        mock_template.name = "Test Template"
        mock_template.entity_types = [mock_entity_type]
        service._templates.get_with_entity_types = AsyncMock(return_value=mock_template)

        # Mock entity type lookup
        mock_entity = MagicMock()
        mock_entity.id = entity_type_id
        service._entity_types.get_by_role = AsyncMock(return_value=mock_entity)
        service._entity_types.get_children = AsyncMock(return_value=[])

        # Mock run creation
        mock_run = MagicMock()
        mock_run.id = run_id
        # Run creation now flows through the lifecycle service
        service._lifecycle.create_run = AsyncMock(return_value=mock_run)
        service._lifecycle.advance_stage = AsyncMock(return_value=mock_run)
        service._runs.start_run = AsyncMock()
        service._runs.complete_run = AsyncMock()
        service._runs.fail_run = AsyncMock()

        # Mock instance creation
        mock_instance = MagicMock()
        mock_instance.id = uuid4()
        mock_instance.label = "Test Model"
        mock_instance.metadata = {}
        service._instances.create = AsyncMock(return_value=mock_instance)

        # Mock PDF processor
        service.pdf_processor.extract_text = AsyncMock(
            return_value="PDF text with models described..."
        )

        # Mock ExtractionInstance class to avoid SQLAlchemy mapper issues
        with (
            patch(
                "app.services.model_extraction_service.extract_structured",
                AsyncMock(
                    return_value=(
                        ModelIdentificationOutput(models=[IdentifiedModel(name="Extracted Model")]),
                        LlmUsage(prompt_tokens=100, completion_tokens=50),
                    )
                ),
            ),
            patch("app.services.model_extraction_service.build_model", MagicMock()),
            patch(
                "app.services.model_extraction_service.ExtractionInstance"
            ) as mock_instance_class,
        ):
            mock_created_instance = MagicMock()
            mock_created_instance.id = uuid4()
            mock_created_instance.label = "Extracted Model"
            mock_instance_class.return_value = mock_created_instance

            result = await service.extract(
                project_id=project_id,
                article_id=article_id,
                template_id=template_id,
            )

        assert result.extraction_run_id is not None
        assert result.total_models >= 0

    @pytest.mark.asyncio
    async def test_create_model_instance_failure_rolls_back_and_fails_run(
        self, service, mock_storage
    ):
        """Issue #21: a DB-level error during instance creation must trigger
        the rollback-then-fail recovery (delegated to the repository's
        rollback_and_fail), not be silently swallowed (which previously left
        the run stuck in status='running').
        """
        project_id = uuid4()
        article_id = uuid4()
        template_id = uuid4()
        run_id = uuid4()
        entity_type_id = uuid4()

        mock_storage.download = AsyncMock(return_value=b"%PDF test")
        mock_file = MagicMock()
        mock_file.storage_key = "test.pdf"
        service._article_files.get_latest_pdf = AsyncMock(return_value=mock_file)

        mock_entity_type = MagicMock()
        mock_entity_type.name = "prediction_models"
        mock_entity_type.role = "model_container"
        mock_template = MagicMock()
        mock_template.id = template_id
        mock_template.name = "T"
        mock_template.entity_types = [mock_entity_type]
        service._templates.get_with_entity_types = AsyncMock(return_value=mock_template)

        mock_entity = MagicMock()
        mock_entity.id = entity_type_id
        service._entity_types.get_by_role = AsyncMock(return_value=mock_entity)
        service._entity_types.get_children = AsyncMock(return_value=[])

        mock_run = MagicMock()
        mock_run.id = run_id
        service._lifecycle.create_run = AsyncMock(return_value=mock_run)
        service._lifecycle.advance_stage = AsyncMock(return_value=mock_run)
        service._runs.start_run = AsyncMock()
        service._runs.complete_run = AsyncMock()
        # The service delegates rollback-then-fail to the repository's
        # rollback_and_fail (mechanics covered by test_extraction_run_repository).
        service._runs.rollback_and_fail = AsyncMock()

        # Inject a DB-style failure on instance creation.
        service._instances.create = AsyncMock(side_effect=RuntimeError("FK violation"))

        service.pdf_processor.extract_text = AsyncMock(return_value="text")

        with (
            patch(
                "app.services.model_extraction_service.extract_structured",
                AsyncMock(
                    return_value=(
                        ModelIdentificationOutput(models=[IdentifiedModel(name="M")]),
                        LlmUsage(prompt_tokens=1, completion_tokens=1),
                    )
                ),
            ),
            patch("app.services.model_extraction_service.build_model", MagicMock()),
            patch("app.services.model_extraction_service.ExtractionInstance"),
            pytest.raises(RuntimeError, match="FK violation"),
        ):
            await service.extract(
                project_id=project_id,
                article_id=article_id,
                template_id=template_id,
            )

        service._runs.rollback_and_fail.assert_awaited_once_with(
            run_id,
            "FK violation",
            logger=ANY,
            trace_id=service.trace_id,
            log_prefix="model_extraction",
        )

    @pytest.mark.asyncio
    async def test_extract_marks_run_failed_when_llm_call_raises(self, service, mock_storage):
        """Reask budget exhausted → run fails; no silent empty-list degradation."""
        from pydantic_ai import UnexpectedModelBehavior

        project_id = uuid4()
        article_id = uuid4()
        template_id = uuid4()
        run_id = uuid4()
        entity_type_id = uuid4()

        mock_storage.download = AsyncMock(return_value=b"%PDF test")
        mock_file = MagicMock()
        mock_file.storage_key = "test.pdf"
        service._article_files.get_latest_pdf = AsyncMock(return_value=mock_file)

        mock_entity_type = MagicMock()
        mock_entity_type.name = "prediction_models"
        mock_entity_type.role = "model_container"
        mock_template = MagicMock()
        mock_template.id = template_id
        mock_template.name = "T"
        mock_template.entity_types = [mock_entity_type]
        service._templates.get_with_entity_types = AsyncMock(return_value=mock_template)

        mock_entity = MagicMock()
        mock_entity.id = entity_type_id
        service._entity_types.get_by_role = AsyncMock(return_value=mock_entity)
        service._entity_types.get_children = AsyncMock(return_value=[])

        mock_run = MagicMock()
        mock_run.id = run_id
        service._lifecycle.create_run = AsyncMock(return_value=mock_run)
        service._lifecycle.advance_stage = AsyncMock(return_value=mock_run)
        service._runs.start_run = AsyncMock()
        service._runs.complete_run = AsyncMock()
        service._runs.rollback_and_fail = AsyncMock()

        service.pdf_processor.extract_text = AsyncMock(return_value="text")

        with (
            patch(
                "app.services.model_extraction_service.extract_structured",
                AsyncMock(side_effect=UnexpectedModelBehavior("reask budget exhausted")),
            ),
            patch("app.services.model_extraction_service.build_model", MagicMock()),
            pytest.raises(UnexpectedModelBehavior, match="reask budget exhausted"),
        ):
            await service.extract(
                project_id=project_id,
                article_id=article_id,
                template_id=template_id,
            )

        service._runs.rollback_and_fail.assert_awaited_once()
        assert "reask budget exhausted" in str(service._runs.rollback_and_fail.await_args)

    @pytest.mark.asyncio
    async def test_extract_no_models_found(self, service, mock_storage):
        """Test when no model is found."""
        project_id = uuid4()
        article_id = uuid4()
        template_id = uuid4()
        run_id = uuid4()

        # Mock _get_pdf
        pdf_content = b"%PDF test"
        mock_storage.download = AsyncMock(return_value=pdf_content)

        # Mock article file
        mock_file = MagicMock()
        mock_file.storage_key = "test.pdf"
        service._article_files.get_latest_pdf = AsyncMock(return_value=mock_file)

        # Mock template
        mock_template = MagicMock()
        mock_template.id = template_id
        mock_template.name = "Test Template"
        mock_template.entity_types = []
        service._templates.get_with_entity_types = AsyncMock(return_value=mock_template)

        # Mock entity type not found
        service._entity_types.get_by_role = AsyncMock(return_value=None)

        # Mock run creation
        mock_run = MagicMock()
        mock_run.id = run_id
        # Run creation now flows through the lifecycle service
        service._lifecycle.create_run = AsyncMock(return_value=mock_run)
        service._lifecycle.advance_stage = AsyncMock(return_value=mock_run)
        service._runs.start_run = AsyncMock()
        service._runs.complete_run = AsyncMock()
        service._runs.fail_run = AsyncMock()

        service.pdf_processor.extract_text = AsyncMock(return_value="Generic text")

        with (
            patch(
                "app.services.model_extraction_service.extract_structured",
                AsyncMock(
                    return_value=(
                        ModelIdentificationOutput(models=[]),
                        LlmUsage(prompt_tokens=50, completion_tokens=20),
                    )
                ),
            ),
            patch("app.services.model_extraction_service.build_model", MagicMock()),
        ):
            result = await service.extract(
                project_id=project_id,
                article_id=article_id,
                template_id=template_id,
            )

        assert result.total_models == 0
        assert result.models_created == []
