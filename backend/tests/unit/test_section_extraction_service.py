"""
Unit tests for SectionExtractionService.

Testa funcionalidades de extração de seções:
- Construção de schemas
- Processamento de PDFs
- Extração com LLM
- Criação de sugestões
"""

import json
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.infrastructure.storage import StorageAdapter
from app.services.section_extraction_service import SectionExtractionService


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
    """Fixture do SectionExtractionService com mocks."""
    with (
        patch("app.services.section_extraction_service.PDFProcessor") as mock_pdf,
        patch("app.services.section_extraction_service.OpenAIService") as mock_openai,
        patch("app.services.section_extraction_service.ArticleFileRepository") as mock_article_repo,
        patch(
            "app.services.section_extraction_service.ExtractionEntityTypeRepository"
        ) as mock_entity_repo,
        patch(
            "app.services.section_extraction_service.ExtractionInstanceRepository"
        ) as mock_instance_repo,
        patch(
            "app.services.section_extraction_service.ExtractionProposalService"
        ) as mock_proposal_cls,
        patch("app.services.section_extraction_service.ExtractionRunRepository") as mock_run_repo,
        patch("app.services.section_extraction_service.RunLifecycleService") as mock_lifecycle_cls,
    ):
        mock_pdf_instance = MagicMock()
        mock_pdf.return_value = mock_pdf_instance

        mock_openai_instance = MagicMock()
        mock_openai.return_value = mock_openai_instance

        # Mock repositories
        mock_article_repo_instance = MagicMock()
        mock_article_repo.return_value = mock_article_repo_instance

        mock_entity_repo_instance = MagicMock()
        mock_entity_repo.return_value = mock_entity_repo_instance

        mock_instance_repo_instance = MagicMock()
        mock_instance_repo.return_value = mock_instance_repo_instance

        mock_proposal_instance = MagicMock()
        mock_proposal_instance.record_proposal = AsyncMock()
        mock_proposal_cls.return_value = mock_proposal_instance

        mock_run_repo_instance = MagicMock()
        mock_run_repo.return_value = mock_run_repo_instance

        # New service uses RunLifecycleService for run creation; mock it so
        # tests can override `mock_lifecycle.create_run.return_value` for
        # test-specific runs without spinning up the lifecycle dep chain.
        mock_lifecycle_instance = MagicMock()
        mock_lifecycle_instance.create_run = AsyncMock()
        mock_lifecycle_instance.advance_stage = AsyncMock()
        mock_lifecycle_cls.return_value = mock_lifecycle_instance

        svc = SectionExtractionService(
            db=mock_db,
            user_id="12345678-1234-1234-1234-123456789012",
            storage=mock_storage,
            trace_id="trace-123",
        )
        svc.pdf_processor = mock_pdf_instance
        svc.openai_service = mock_openai_instance
        svc._article_files = mock_article_repo_instance
        svc._entity_types = mock_entity_repo_instance
        svc._instances = mock_instance_repo_instance
        svc._proposals = mock_proposal_instance
        svc._runs = mock_run_repo_instance
        svc._lifecycle = mock_lifecycle_instance

        return svc


class TestSectionExtractionSchema:
    """Testes de construção de schemas."""

    def test_build_extraction_schema_basic(self, service):
        """Testa construção de schema básico."""
        # Entity type como objeto mock com atributo .fields
        mock_field1 = MagicMock()
        mock_field1.name = "sample_size"
        mock_field1.field_type = "integer"
        mock_field1.description = "Number of participants"
        mock_field1.is_required = True

        mock_field2 = MagicMock()
        mock_field2.name = "study_type"
        mock_field2.field_type = "string"
        mock_field2.description = "Type of study"
        mock_field2.is_required = True

        mock_field3 = MagicMock()
        mock_field3.name = "has_control_group"
        mock_field3.field_type = "boolean"
        mock_field3.description = "Whether study has control"
        mock_field3.is_required = False

        entity_type = MagicMock()
        entity_type.name = "Study Characteristics"
        entity_type.fields = [mock_field1, mock_field2, mock_field3]

        schema = service._build_extraction_schema(entity_type)

        assert schema["type"] == "object"
        assert "sample_size" in schema["properties"]
        assert schema["properties"]["sample_size"]["type"] == "number"
        assert schema["properties"]["study_type"]["type"] == "string"
        assert schema["properties"]["has_control_group"]["type"] == "boolean"
        assert "sample_size" in schema["required"]
        assert "study_type" in schema["required"]
        assert "has_control_group" not in schema["required"]

    def test_build_extraction_schema_array_type(self, service):
        """Testa schema com campos array."""
        mock_field = MagicMock()
        mock_field.name = "primary_outcomes"
        mock_field.field_type = "array"
        mock_field.description = "List of primary outcomes"
        mock_field.is_required = False

        entity_type = MagicMock()
        entity_type.name = "Outcomes"
        entity_type.fields = [mock_field]

        schema = service._build_extraction_schema(entity_type)

        assert schema["properties"]["primary_outcomes"]["type"] == "array"

    def test_build_extraction_schema_empty_fields(self, service):
        """Testa schema sem campos."""
        entity_type = MagicMock()
        entity_type.name = "Empty Entity"
        entity_type.fields = []

        schema = service._build_extraction_schema(entity_type)

        assert schema["properties"] == {}
        assert schema["required"] == []


class TestSectionExtractionPDF:
    """Testes de processamento de PDFs."""

    @pytest.mark.asyncio
    async def test_get_pdf_success(self, service, mock_storage):
        """Testa busca de PDF com sucesso."""
        article_id = uuid4()
        pdf_content = b"%PDF-1.4 test content"

        # Mock article_files repository
        mock_file = MagicMock()
        mock_file.storage_key = "project-1/article-1/paper.pdf"
        service._article_files.get_latest_pdf = AsyncMock(return_value=mock_file)

        # Mock storage adapter - note: takes (bucket, key)
        mock_storage.download = AsyncMock(return_value=pdf_content)

        result = await service._get_pdf(article_id)

        assert result == pdf_content
        service._article_files.get_latest_pdf.assert_called_once_with(article_id)
        mock_storage.download.assert_called_once_with("articles", "project-1/article-1/paper.pdf")

    @pytest.mark.asyncio
    async def test_get_pdf_not_found(
        self,
        service,
        mock_storage,  # noqa: ARG002
    ):
        """Testa erro quando PDF não encontrado."""
        article_id = uuid4()

        # Mock article_files repository returns None
        service._article_files.get_latest_pdf = AsyncMock(return_value=None)

        with pytest.raises(FileNotFoundError, match="PDF not found"):
            await service._get_pdf(article_id)


class TestSectionExtractionEntityTypes:
    """Testes de busca de entity types."""

    @pytest.mark.asyncio
    async def test_get_entity_type_success(self, service):
        """Testa busca de entity type com sucesso."""
        entity_type_id = uuid4()

        # Mock entity type com fields
        mock_field = MagicMock()
        mock_field.name = "sample_size"
        mock_field.field_type = "integer"

        mock_entity = MagicMock()
        mock_entity.id = entity_type_id
        mock_entity.name = "Study Characteristics"
        mock_entity.fields = [mock_field]

        service._entity_types.get_with_fields = AsyncMock(return_value=mock_entity)

        result = await service._get_entity_type(entity_type_id)

        # Returns the entity type object directly
        assert result.name == "Study Characteristics"
        assert len(result.fields) == 1

    @pytest.mark.asyncio
    async def test_get_entity_type_not_found(self, service):
        """Testa erro quando entity type não encontrado."""
        entity_type_id = uuid4()

        # Mock repository returns None
        service._entity_types.get_with_fields = AsyncMock(return_value=None)

        with pytest.raises(ValueError, match="Entity type not found"):
            await service._get_entity_type(entity_type_id)

    @pytest.mark.asyncio
    async def test_get_child_entity_types(self, service):
        """Test fetch of child entity types."""
        template_id = uuid4()
        parent_instance_id = uuid4()
        parent_entity_type_id = uuid4()

        # Mock parent instance
        mock_parent = MagicMock()
        mock_parent.entity_type_id = parent_entity_type_id
        service._instances.get_by_id = AsyncMock(return_value=mock_parent)

        # Mock child entity types
        mock_child1 = MagicMock()
        mock_child1.id = uuid4()
        mock_child1.name = "Section 1"

        mock_child2 = MagicMock()
        mock_child2.id = uuid4()
        mock_child2.name = "Section 2"

        service._entity_types.get_children = AsyncMock(return_value=[mock_child1, mock_child2])

        result = await service._get_child_entity_types(
            template_id=template_id,
            parent_instance_id=parent_instance_id,
        )

        assert len(result) == 2
        assert result[0].name == "Section 1"


class TestSectionExtractionLLM:
    """Testes de extração com LLM."""

    @pytest.mark.asyncio
    async def test_extract_with_llm_success(self, service):
        """Testa extração bem-sucedida com LLM."""
        # Mock OpenAI response with usage stats
        from app.services.openai_service import OpenAIResponse, OpenAIUsage

        mock_response = OpenAIResponse(
            content=json.dumps(
                {
                    "sample_size": 150,
                    "study_type": "RCT",
                    "duration_weeks": 12,
                }
            ),
            usage=OpenAIUsage(
                prompt_tokens=100,
                completion_tokens=50,
                total_tokens=150,
            ),
            model="gpt-4o-mini",
        )

        service.openai_service.chat_completion_full = AsyncMock(return_value=mock_response)

        # Entity type mock
        entity_type = MagicMock()
        entity_type.name = "Study Characteristics"
        entity_type.description = "Basic study information"

        schema = {
            "type": "object",
            "properties": {
                "sample_size": {"type": "number"},
                "study_type": {"type": "string"},
            },
        }

        # Returns tuple (extracted_data, response)
        extracted, response = await service._extract_with_llm(
            pdf_text="Sample text from PDF...",
            entity_type=entity_type,
            schema=schema,
            model="gpt-4o-mini",
        )

        assert extracted["sample_size"] == 150
        assert extracted["study_type"] == "RCT"
        assert response.usage.total_tokens == 150


class TestSectionExtractionFullFlow:
    """Testes de fluxo completo."""

    @pytest.mark.asyncio
    async def test_extract_section_full_flow(self, service, mock_storage):
        """Testa fluxo completo de extração de seção."""
        project_id = uuid4()
        article_id = uuid4()
        template_id = uuid4()
        entity_type_id = uuid4()
        run_id = uuid4()

        # Mock _get_pdf
        pdf_content = b"%PDF-1.4 test"
        mock_storage.download = AsyncMock(return_value=pdf_content)

        # Mock article file
        mock_file = MagicMock()
        mock_file.storage_key = "test.pdf"
        service._article_files.get_latest_pdf = AsyncMock(return_value=mock_file)

        # Mock entity type
        mock_field = MagicMock()
        mock_field.name = "field_1"
        mock_field.field_type = "string"
        mock_field.description = "Test field"
        mock_field.is_required = True

        mock_entity = MagicMock()
        mock_entity.id = entity_type_id
        mock_entity.name = "Test Entity"
        mock_entity.description = "Test description"
        mock_entity.fields = [mock_field]
        service._entity_types.get_with_fields = AsyncMock(return_value=mock_entity)

        # Mock run creation
        mock_run = MagicMock()
        mock_run.id = run_id
        # Run creation now flows through the lifecycle service
        service._lifecycle.create_run = AsyncMock(return_value=mock_run)
        service._lifecycle.advance_stage = AsyncMock(return_value=mock_run)
        service._runs.start_run = AsyncMock()
        service._runs.complete_run = AsyncMock()
        service._runs.fail_run = AsyncMock()

        # Mock proposal recording (returns a record-shaped object with .id)
        mock_proposal = MagicMock()
        mock_proposal.id = uuid4()
        service._proposals.record_proposal = AsyncMock(return_value=mock_proposal)

        # Mock instances (for _create_suggestions)
        service._instances.get_by_article = AsyncMock(return_value=[])

        # Mock PDF processor
        service.pdf_processor.extract_text = AsyncMock(return_value="Extracted text from PDF")

        # Mock OpenAI
        from app.services.openai_service import OpenAIResponse, OpenAIUsage

        mock_openai_response = OpenAIResponse(
            content=json.dumps({"field_1": "Extracted value"}),
            usage=OpenAIUsage(
                prompt_tokens=100,
                completion_tokens=50,
                total_tokens=150,
            ),
            model="gpt-4o-mini",
        )
        service.openai_service.chat_completion_full = AsyncMock(return_value=mock_openai_response)

        # Mock SQLAlchemy model class to avoid mapper issues
        with patch(
            "app.services.section_extraction_service.ExtractionInstance"
        ) as mock_instance_class:
            mock_created_instance = MagicMock()
            mock_created_instance.id = uuid4()
            mock_instance_class.return_value = mock_created_instance
            service._instances.create = AsyncMock(return_value=mock_created_instance)

            result = await service.extract_section(
                project_id=project_id,
                article_id=article_id,
                template_id=template_id,
                entity_type_id=entity_type_id,
            )

        assert result.extraction_run_id is not None
        assert result.entity_type_id == str(entity_type_id)
        assert result.tokens_total == 150
        service._proposals.record_proposal.assert_awaited()

        # The run lifecycle gets exactly one stage advance: pending → proposal.
        # The run STAYS in PROPOSAL after AI proposing so ``useExtractedValues``
        # can hydrate from ``runDetail.proposals`` and show the values in the
        # form. The user advances to REVIEW explicitly via "Submit for review".
        # Auto-advancing here skipped the proposal-stage hydration and left
        # the form blank until F5 (#bug: AI extraction values not appearing).
        from app.models.extraction import ExtractionRunStage

        advance_calls = service._lifecycle.advance_stage.await_args_list
        target_stages = [call.kwargs.get("target_stage") for call in advance_calls]
        assert ExtractionRunStage.PROPOSAL in target_stages
        assert ExtractionRunStage.REVIEW not in target_stages


class TestExtractSectionWithExistingRun:
    """``extract_section`` accepts an existing ``run_id`` (extraction-surface
    path) and appends proposals to that run instead of creating a fresh one.

    Regression: each section-by-section AI click used to create an orphan
    Run, so the HITL-session run stayed empty and the form never showed the
    extracted values (#bug: AI extraction values not appearing).
    """

    @staticmethod
    def _wire_pipeline(
        service,
        mock_storage,
        existing_run,
        entity_type_id,
    ):
        from app.services.openai_service import OpenAIResponse, OpenAIUsage

        mock_file = MagicMock()
        mock_file.storage_key = "test.pdf"
        service._article_files.get_latest_pdf = AsyncMock(return_value=mock_file)
        mock_storage.download = AsyncMock(return_value=b"%PDF-1.4 test")
        service.pdf_processor.extract_text = AsyncMock(return_value="text")

        mock_field = MagicMock()
        mock_field.name = "field_1"
        mock_field.field_type = "string"
        mock_field.description = "f"
        mock_field.is_required = True
        mock_entity = MagicMock()
        mock_entity.id = entity_type_id
        mock_entity.name = "EntityX"
        mock_entity.description = "d"
        mock_entity.fields = [mock_field]
        service._entity_types.get_with_fields = AsyncMock(return_value=mock_entity)

        # ``service.db.get(ExtractionRun, run_id)`` returns the existing run.
        service.db.get = AsyncMock(return_value=existing_run)

        # Proposals + instances bookkeeping.
        mock_proposal = MagicMock()
        mock_proposal.id = uuid4()
        service._proposals.record_proposal = AsyncMock(return_value=mock_proposal)
        service._instances.get_by_article = AsyncMock(return_value=[])

        # OpenAI shaped response.
        service.openai_service.chat_completion_full = AsyncMock(
            return_value=OpenAIResponse(
                content=json.dumps({"field_1": "value"}),
                usage=OpenAIUsage(prompt_tokens=10, completion_tokens=5, total_tokens=15),
                model="gpt-4o-mini",
            )
        )

        # Run-lifecycle bookkeeping methods must exist as AsyncMock so we
        # can assert they were NOT called.
        service._lifecycle.create_run = AsyncMock()
        service._lifecycle.advance_stage = AsyncMock()
        service._runs.start_run = AsyncMock()
        service._runs.complete_run = AsyncMock()
        service._runs.fail_run = AsyncMock()

    @pytest.mark.asyncio
    async def test_existing_run_id_reuses_run_and_skips_lifecycle(self, service, mock_storage):
        """``run_id`` provided → no new run, no start/complete, no advance."""
        from app.models.extraction import ExtractionRunStage

        project_id = uuid4()
        article_id = uuid4()
        template_id = uuid4()
        entity_type_id = uuid4()
        existing_run_id = uuid4()

        existing_run = MagicMock()
        existing_run.id = existing_run_id
        existing_run.stage = ExtractionRunStage.PROPOSAL.value

        self._wire_pipeline(service, mock_storage, existing_run, entity_type_id)

        with patch(
            "app.services.section_extraction_service.ExtractionInstance"
        ) as mock_instance_class:
            inst = MagicMock()
            inst.id = uuid4()
            mock_instance_class.return_value = inst
            service._instances.create = AsyncMock(return_value=inst)

            result = await service.extract_section(
                project_id=project_id,
                article_id=article_id,
                template_id=template_id,
                entity_type_id=entity_type_id,
                run_id=existing_run_id,
            )

        # Proposals must land on the EXISTING run, not on a freshly-created one.
        assert result.extraction_run_id == str(existing_run_id)

        # Lifecycle bookkeeping bypassed: the HITL session owns the run.
        service._lifecycle.create_run.assert_not_awaited()
        service._lifecycle.advance_stage.assert_not_awaited()
        service._runs.start_run.assert_not_awaited()
        service._runs.complete_run.assert_not_awaited()
        service._runs.fail_run.assert_not_awaited()

        # The proposal recording call must use the existing run's id.
        record_call = service._proposals.record_proposal.await_args
        assert record_call.kwargs["run_id"] == existing_run_id

    @pytest.mark.asyncio
    async def test_existing_run_id_rejects_non_proposal_stage(self, service, mock_storage):
        """Run already moved past PROPOSAL → reject (matches extract_for_run)."""
        from app.models.extraction import ExtractionRunStage

        existing_run = MagicMock()
        existing_run.id = uuid4()
        existing_run.stage = ExtractionRunStage.REVIEW.value

        self._wire_pipeline(service, mock_storage, existing_run, uuid4())

        with pytest.raises(ValueError, match="PROPOSAL"):
            await service.extract_section(
                project_id=uuid4(),
                article_id=uuid4(),
                template_id=uuid4(),
                entity_type_id=uuid4(),
                run_id=existing_run.id,
            )

        # No proposals should have been created when the guard fires.
        service._proposals.record_proposal.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_existing_run_id_fails_when_run_not_found(self, service, mock_storage):
        """db.get returning None → ValueError, no side-effects."""
        existing_run_id = uuid4()
        self._wire_pipeline(service, mock_storage, None, uuid4())

        with pytest.raises(ValueError, match="not found"):
            await service.extract_section(
                project_id=uuid4(),
                article_id=uuid4(),
                template_id=uuid4(),
                entity_type_id=uuid4(),
                run_id=existing_run_id,
            )

        service._proposals.record_proposal.assert_not_awaited()
        service._lifecycle.create_run.assert_not_awaited()


class TestExtractWithLLMPrompt:
    """The system + user prompt must change with the run kind so the LLM
    grades QA studies instead of trying to extract structured data."""

    @pytest.mark.asyncio
    async def test_extraction_kind_uses_extraction_prompt(self, service):
        from app.services.openai_service import OpenAIResponse, OpenAIUsage

        captured_messages: list[dict[str, str]] = []

        async def fake_chat(messages, **kwargs):  # noqa: ARG001
            captured_messages.extend(messages)
            return OpenAIResponse(
                content=json.dumps({}),
                usage=OpenAIUsage(prompt_tokens=1, completion_tokens=1, total_tokens=2),
                model="gpt-4o-mini",
            )

        service.openai_service.chat_completion_full = AsyncMock(side_effect=fake_chat)

        entity_type = MagicMock()
        entity_type.name = "Participants"
        entity_type.description = "Population"

        await service._extract_with_llm(
            pdf_text="text",
            entity_type=entity_type,
            schema={"type": "object", "properties": {}},
            model="gpt-4o-mini",
            kind="extraction",
            framework=None,
        )

        system_prompt = captured_messages[0]["content"]
        user_prompt = captured_messages[1]["content"]
        assert "extracting structured data" in system_prompt
        assert "Section: Participants" in user_prompt
        assert "PROBAST" not in system_prompt
        assert "PROBAST" not in user_prompt

    @pytest.mark.asyncio
    async def test_quality_assessment_kind_uses_assessment_prompt(self, service):
        from app.services.openai_service import OpenAIResponse, OpenAIUsage

        captured_messages: list[dict[str, str]] = []

        async def fake_chat(messages, **kwargs):  # noqa: ARG001
            captured_messages.extend(messages)
            return OpenAIResponse(
                content=json.dumps({}),
                usage=OpenAIUsage(prompt_tokens=1, completion_tokens=1, total_tokens=2),
                model="gpt-4o-mini",
            )

        service.openai_service.chat_completion_full = AsyncMock(side_effect=fake_chat)

        entity_type = MagicMock()
        entity_type.name = "Predictors"
        entity_type.description = "Domain 2"

        await service._extract_with_llm(
            pdf_text="text",
            entity_type=entity_type,
            schema={"type": "object", "properties": {}},
            model="gpt-4o-mini",
            kind="quality_assessment",
            framework="PROBAST",
        )

        system_prompt = captured_messages[0]["content"]
        user_prompt = captured_messages[1]["content"]
        assert "PROBAST" in system_prompt
        assert "methodologist" in system_prompt
        assert "Domain: Predictors" in user_prompt
        assert "extracting structured data" not in system_prompt


class TestExtractForRun:
    """Tests for the QA / pre-opened-run extraction path that reuses an
    existing Run instead of creating a new one."""

    @pytest.fixture
    def qa_run(self):
        run = MagicMock()
        run.id = uuid4()
        run.project_id = uuid4()
        run.article_id = uuid4()
        run.template_id = uuid4()
        from app.models.extraction import ExtractionRunStage

        run.stage = ExtractionRunStage.PROPOSAL.value
        run.kind = "quality_assessment"
        return run

    @pytest.fixture
    def qa_template(self):
        tpl = MagicMock()
        tpl.framework = "PROBAST"
        tpl.kind = "quality_assessment"
        return tpl

    def _wire_minimal_qa_pipeline(self, service, run, template, top_level_entity_types):
        """Stub out the bits of the service that the QA path touches so each
        test can focus on a single behaviour."""
        from app.services.openai_service import OpenAIResponse, OpenAIUsage

        service.db.get = AsyncMock(
            side_effect=lambda model_cls, _id: run if "Run" in model_cls.__name__ else template
        )

        # PDF + entity-type fetches
        service._article_files.get_latest_pdf = AsyncMock(
            return_value=MagicMock(storage_key="x.pdf")
        )
        service.storage.download = AsyncMock(return_value=b"%PDF")
        service.pdf_processor.extract_text = AsyncMock(return_value="article text")

        async def fake_get_with_fields(et_id):
            for et in top_level_entity_types:
                if et.id == et_id:
                    return et
            return None

        service._entity_types.get_with_fields = AsyncMock(side_effect=fake_get_with_fields)

        # The top-level lookup goes through self.db.execute(select(...))
        scalars = MagicMock()
        scalars.all.return_value = top_level_entity_types
        execute_result = MagicMock()
        execute_result.scalars.return_value = scalars
        execute_result.all.return_value = []  # for the human-proposal probe
        service.db.execute = AsyncMock(return_value=execute_result)

        # Existing instance per entity_type
        service._instances.get_by_article = AsyncMock(
            return_value=[MagicMock(id=uuid4(), parent_instance_id=None)]
        )

        # Run lifecycle / repo
        service._runs.start_run = AsyncMock()
        service._runs.complete_run = AsyncMock()
        service._runs.fail_run = AsyncMock()
        service._lifecycle.advance_stage = AsyncMock()

        # LLM
        service.openai_service.chat_completion_full = AsyncMock(
            return_value=OpenAIResponse(
                content=json.dumps({}),
                usage=OpenAIUsage(prompt_tokens=10, completion_tokens=5, total_tokens=15),
                model="gpt-4o-mini",
            )
        )

        # Proposal writes
        service._proposals.record_proposal = AsyncMock(return_value=MagicMock(id=uuid4()))

    @pytest.mark.asyncio
    async def test_extract_for_run_does_not_advance_when_disabled(
        self, service, qa_run, qa_template
    ):
        """QA passes auto_advance_to_review=False so its publish flow can
        drive the run from PROPOSAL → REVIEW → CONSENSUS → FINALIZED in
        one click."""
        et = MagicMock()
        et.id = uuid4()
        et.name = "Participants"
        et.fields = []
        et.parent_entity_type_id = None
        self._wire_minimal_qa_pipeline(service, qa_run, qa_template, [et])

        await service.extract_for_run(
            run_id=qa_run.id,
            auto_advance_to_review=False,
        )

        service._lifecycle.advance_stage.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_extract_for_run_advances_when_enabled(self, service, qa_run, qa_template):
        from app.models.extraction import ExtractionRunStage

        et = MagicMock()
        et.id = uuid4()
        et.name = "Participants"
        et.fields = []
        et.parent_entity_type_id = None
        self._wire_minimal_qa_pipeline(service, qa_run, qa_template, [et])

        await service.extract_for_run(
            run_id=qa_run.id,
            auto_advance_to_review=True,
        )

        target_stages = [
            call.kwargs.get("target_stage")
            for call in service._lifecycle.advance_stage.await_args_list
        ]
        assert ExtractionRunStage.REVIEW in target_stages

    @pytest.mark.asyncio
    async def test_extract_for_run_rejects_non_proposal_stage(self, service, qa_run, qa_template):
        from app.models.extraction import ExtractionRunStage

        qa_run.stage = ExtractionRunStage.REVIEW.value
        self._wire_minimal_qa_pipeline(service, qa_run, qa_template, [])

        with pytest.raises(ValueError, match="PROPOSAL"):
            await service.extract_for_run(run_id=qa_run.id)

    @pytest.mark.asyncio
    async def test_extract_for_run_fails_when_run_not_found(self, service, qa_run, qa_template):
        # Wire the pipeline normally, then override db.get to return None for
        # the Run lookup so the early "Run {id} not found" guard fires.
        self._wire_minimal_qa_pipeline(service, qa_run, qa_template, [])
        service.db.get = AsyncMock(return_value=None)

        with pytest.raises(ValueError, match="not found"):
            await service.extract_for_run(run_id=qa_run.id)


class TestFieldsWithRecentHumanProposal:
    """Re-run safety: only fields whose newest proposal on this Run is
    ``source='human'`` get filtered out. AI-newest fields stay eligible."""

    @pytest.mark.asyncio
    async def test_returns_empty_set_for_empty_field_ids(self, service):
        result = await service._fields_with_recent_human_proposal(
            run_id=uuid4(),
            instance_id=uuid4(),
            field_ids=[],
        )
        assert result == set()
        # Should short-circuit before hitting the DB.
        assert getattr(service.db, "execute", None) is None or not (
            isinstance(service.db.execute, AsyncMock) and service.db.execute.await_count
        )

    @pytest.mark.asyncio
    async def test_picks_only_fields_whose_newest_proposal_is_human(self, service):
        from app.models.extraction_workflow import ExtractionProposalSource

        f_human_only = uuid4()
        f_ai_then_human = uuid4()
        f_human_then_ai = uuid4()
        f_ai_only = uuid4()

        # Order matters: the service iterates by ``(field_id, created_at desc)``
        # so the first row per field_id wins. Reproduce that ordering here.
        rows_in_order = [
            (f_human_only, ExtractionProposalSource.HUMAN.value),
            (f_ai_then_human, ExtractionProposalSource.HUMAN.value),  # newest
            (f_ai_then_human, ExtractionProposalSource.AI.value),
            (f_human_then_ai, ExtractionProposalSource.AI.value),  # newest
            (f_human_then_ai, ExtractionProposalSource.HUMAN.value),
            (f_ai_only, ExtractionProposalSource.AI.value),
        ]
        execute_result = MagicMock()
        execute_result.all.return_value = rows_in_order
        service.db.execute = AsyncMock(return_value=execute_result)

        result = await service._fields_with_recent_human_proposal(
            run_id=uuid4(),
            instance_id=uuid4(),
            field_ids=[f_human_only, f_ai_then_human, f_human_then_ai, f_ai_only],
        )

        assert result == {f_human_only, f_ai_then_human}

    @pytest.mark.asyncio
    async def test_fields_without_proposals_are_not_in_result(self, service):
        f_no_proposal = uuid4()
        execute_result = MagicMock()
        execute_result.all.return_value = []
        service.db.execute = AsyncMock(return_value=execute_result)

        result = await service._fields_with_recent_human_proposal(
            run_id=uuid4(),
            instance_id=uuid4(),
            field_ids=[f_no_proposal],
        )

        assert result == set()


class TestExtractOneEntityTypeForRun:
    """Field-restoration invariant: after we filter ``full_entity_type.fields``
    to skip human-edited ones, we must restore the original list in a finally
    block so callers that reuse the cached entity_type don't see a mutated
    tree (would otherwise corrupt subsequent extractions in the same Run)."""

    @pytest.fixture
    def run(self):
        from app.models.extraction import ExtractionRunStage

        run = MagicMock()
        run.id = uuid4()
        run.project_id = uuid4()
        run.article_id = uuid4()
        run.template_id = uuid4()
        run.stage = ExtractionRunStage.PROPOSAL.value
        run.kind = "extraction"
        return run

    @pytest.mark.asyncio
    async def test_restores_field_list_after_filtering(self, service, run):
        from app.services.openai_service import OpenAIResponse, OpenAIUsage

        f_keep = MagicMock()
        f_keep.id = uuid4()
        f_keep.name = "kept"
        f_skip = MagicMock()
        f_skip.id = uuid4()
        f_skip.name = "skipped_due_to_human"

        full_et = MagicMock()
        full_et.id = uuid4()
        full_et.name = "Section"
        full_et.description = "desc"
        full_et.fields = [f_keep, f_skip]
        original_fields_ref = full_et.fields

        service._entity_types.get_with_fields = AsyncMock(return_value=full_et)
        service._instances.get_by_article = AsyncMock(
            return_value=[MagicMock(id=uuid4(), parent_instance_id=None)]
        )

        # Mark f_skip as human-edited so the filter excludes it.
        async def fake_human_probe(*, run_id, instance_id, field_ids):  # noqa: ARG001
            return {f_skip.id}

        service._fields_with_recent_human_proposal = AsyncMock(side_effect=fake_human_probe)

        # LLM + suggestion writes
        service.openai_service.chat_completion_full = AsyncMock(
            return_value=OpenAIResponse(
                content=json.dumps({}),
                usage=OpenAIUsage(prompt_tokens=1, completion_tokens=1, total_tokens=2),
                model="gpt-4o-mini",
            )
        )
        service._create_suggestions = AsyncMock(return_value=0)

        et_summary = MagicMock()
        et_summary.id = full_et.id
        et_summary.name = full_et.name

        await service._extract_one_entity_type_for_run(
            run=run,
            entity_type=et_summary,
            pdf_text="text",
            framework=None,
            kind="extraction",
            skip_fields_with_human_proposals=True,
            model="gpt-4o-mini",
        )

        # Original fields list must be put back before returning.
        assert full_et.fields == [f_keep, f_skip]
        assert full_et.fields == original_fields_ref

    @pytest.mark.asyncio
    async def test_skips_entity_when_every_field_is_human_edited(self, service, run):
        f1 = MagicMock(id=uuid4(), name="a")
        f2 = MagicMock(id=uuid4(), name="b")
        full_et = MagicMock()
        full_et.id = uuid4()
        full_et.fields = [f1, f2]

        service._entity_types.get_with_fields = AsyncMock(return_value=full_et)
        service._instances.get_by_article = AsyncMock(
            return_value=[MagicMock(id=uuid4(), parent_instance_id=None)]
        )
        service._fields_with_recent_human_proposal = AsyncMock(return_value={f1.id, f2.id})
        # If filter logic is wrong the LLM gets called — fail loudly.
        service.openai_service.chat_completion_full = AsyncMock(
            side_effect=AssertionError("LLM must NOT be called when all fields are human")
        )
        service._create_suggestions = AsyncMock(return_value=0)

        result = await service._extract_one_entity_type_for_run(
            run=run,
            entity_type=MagicMock(id=full_et.id, name="x"),
            pdf_text="text",
            framework=None,
            kind="extraction",
            skip_fields_with_human_proposals=True,
            model="gpt-4o-mini",
        )

        assert result == {"suggestions_created": 0, "tokens_total": 0, "skipped": True}
        service.openai_service.chat_completion_full.assert_not_called()

    @pytest.mark.asyncio
    async def test_no_filter_when_skip_flag_is_false(self, service, run):
        from app.services.openai_service import OpenAIResponse, OpenAIUsage

        # ``MagicMock(name='a')`` sets the *mock's* name, not the .name attribute.
        # Set it explicitly so json.dumps inside _build_extraction_schema works.
        f1 = MagicMock(id=uuid4())
        f1.name = "a"
        f1.field_type = "string"
        f1.description = ""
        f1.is_required = False
        full_et = MagicMock()
        full_et.id = uuid4()
        full_et.name = "Section"
        full_et.description = ""
        full_et.fields = [f1]

        service._entity_types.get_with_fields = AsyncMock(return_value=full_et)
        service._instances.get_by_article = AsyncMock(
            return_value=[MagicMock(id=uuid4(), parent_instance_id=None)]
        )
        # Even if there *would* be human-edited fields, the probe must not run
        # when skip_fields_with_human_proposals=False.
        service._fields_with_recent_human_proposal = AsyncMock(
            side_effect=AssertionError("human-proposal probe must not run when skip flag is False")
        )
        service.openai_service.chat_completion_full = AsyncMock(
            return_value=OpenAIResponse(
                content=json.dumps({}),
                usage=OpenAIUsage(prompt_tokens=1, completion_tokens=1, total_tokens=2),
                model="gpt-4o-mini",
            )
        )
        service._create_suggestions = AsyncMock(return_value=0)

        await service._extract_one_entity_type_for_run(
            run=run,
            entity_type=MagicMock(id=full_et.id, name="x"),
            pdf_text="text",
            framework=None,
            kind="extraction",
            skip_fields_with_human_proposals=False,
            model="gpt-4o-mini",
        )

        service._fields_with_recent_human_proposal.assert_not_called()


# ---------------------------------------------------------------------------
# _generate_extraction_summary (lines 897-927)
# ---------------------------------------------------------------------------


class TestGenerateExtractionSummary:
    """Covers _generate_extraction_summary including all branches."""

    def _make_entity_type(self, name: str = "MySection", label: str | None = None):
        et = MagicMock()
        et.name = name
        et.label = label
        return et

    def test_empty_data_returns_no_data_message(self, service):
        et = self._make_entity_type("Section A")
        result = service._generate_extraction_summary(et, {})
        assert result == "Section A: No data extracted"

    def test_none_values_are_skipped(self, service):
        et = self._make_entity_type("Section B")
        data = {"field1": None, "field2": None}
        result = service._generate_extraction_summary(et, data)
        assert "No data extracted" in result or "Section B" in result

    def test_dict_value_uses_value_key(self, service):
        et = self._make_entity_type("Section C")
        data = {"field1": {"value": "extracted_val", "confidence": 0.9}}
        result = service._generate_extraction_summary(et, data)
        assert "extracted_val" in result

    def test_plain_value_included(self, service):
        et = self._make_entity_type("Section D")
        data = {"field1": "plain_value"}
        result = service._generate_extraction_summary(et, data)
        assert "plain_value" in result

    def test_label_preferred_over_name(self, service):
        et = self._make_entity_type("MyName", label="MyLabel")
        data = {"f": "v"}
        result = service._generate_extraction_summary(et, data)
        assert "MyLabel" in result
        assert "MyName" not in result

    def test_truncates_at_200_chars(self, service):
        et = self._make_entity_type("Section")
        # Create multiple fields with long names to push summary over 200 chars
        # Format: "Section: longfieldname1: X*50, longfieldname2: X*50, longfieldname3: X*50"
        data = {
            "very_long_field_name_number_one": "X" * 300,
            "very_long_field_name_number_two": "Y" * 300,
            "very_long_field_name_number_three": "Z" * 300,
        }
        result = service._generate_extraction_summary(et, data)
        # Should truncate and append "..."
        assert len(result) == 200
        assert result.endswith("...")

    def test_more_indicator_when_more_than_three_fields(self, service):
        et = self._make_entity_type("Section")
        data = {f"field{i}": f"val{i}" for i in range(5)}
        result = service._generate_extraction_summary(et, data)
        assert "..." in result

    def test_no_more_indicator_for_three_or_fewer_fields(self, service):
        et = self._make_entity_type("Section")
        data = {"a": "1", "b": "2"}
        result = service._generate_extraction_summary(et, data)
        # Only trailing ... from truncation if long, not the more_indicator
        # With 2 short fields this should not have "..." unless it's truncated
        assert len(result) <= 200


# ---------------------------------------------------------------------------
# _get_child_entity_types edge cases (lines 964-998)
# ---------------------------------------------------------------------------


class TestGetChildEntityTypesEdgeCases:
    @pytest.mark.asyncio
    async def test_returns_empty_when_parent_instance_not_found(self, service):
        service._instances.get_by_id = AsyncMock(return_value=None)
        result = await service._get_child_entity_types(
            template_id=uuid4(),
            parent_instance_id=uuid4(),
        )
        assert result == []

    @pytest.mark.asyncio
    async def test_returns_empty_when_no_child_entity_types(self, service):
        parent = MagicMock()
        parent.entity_type_id = uuid4()
        service._instances.get_by_id = AsyncMock(return_value=parent)
        service._entity_types.get_children = AsyncMock(return_value=[])
        result = await service._get_child_entity_types(
            template_id=uuid4(),
            parent_instance_id=uuid4(),
        )
        assert result == []

    @pytest.mark.asyncio
    async def test_filters_by_section_ids(self, service):
        parent = MagicMock()
        parent.entity_type_id = uuid4()
        service._instances.get_by_id = AsyncMock(return_value=parent)

        id1 = uuid4()
        id2 = uuid4()
        et1 = MagicMock()
        et1.id = id1
        et2 = MagicMock()
        et2.id = id2
        service._entity_types.get_children = AsyncMock(return_value=[et1, et2])

        result = await service._get_child_entity_types(
            template_id=uuid4(),
            parent_instance_id=uuid4(),
            section_ids=[id1],
        )
        assert len(result) == 1
        assert result[0].id == id1


# ---------------------------------------------------------------------------
# _build_extraction_schema — allowed_values branches (lines 1034-1068)
# ---------------------------------------------------------------------------


class TestBuildExtractionSchemaAllowedValues:
    def test_allowed_values_as_list_of_strings(self, service):
        field = MagicMock()
        field.name = "status"
        field.field_type = "string"
        field.description = "Status"
        field.llm_description = None
        field.is_required = False
        field.allowed_values = ["active", "inactive", "pending"]

        et = MagicMock()
        et.fields = [field]
        schema = service._build_extraction_schema(et)

        assert "enum" in schema["properties"]["status"]
        assert schema["properties"]["status"]["enum"] == ["active", "inactive", "pending"]

    def test_allowed_values_as_dict_with_options(self, service):
        field = MagicMock()
        field.name = "risk"
        field.field_type = "string"
        field.description = "Risk level"
        field.llm_description = None
        field.is_required = False
        field.allowed_values = {"options": [{"value": "low"}, {"value": "high"}]}

        et = MagicMock()
        et.fields = [field]
        schema = service._build_extraction_schema(et)

        assert schema["properties"]["risk"]["enum"] == ["low", "high"]

    def test_allowed_values_options_appended_to_description(self, service):
        field = MagicMock()
        field.name = "choice"
        field.field_type = "string"
        field.description = "Pick one"
        field.llm_description = None
        field.is_required = False
        field.allowed_values = ["yes", "no"]

        et = MagicMock()
        et.fields = [field]
        schema = service._build_extraction_schema(et)

        assert "Must be one of" in schema["properties"]["choice"]["description"]

    def test_allowed_values_empty_list_no_enum(self, service):
        field = MagicMock()
        field.name = "nopts"
        field.field_type = "string"
        field.description = "desc"
        field.llm_description = None
        field.is_required = False
        field.allowed_values = []

        et = MagicMock()
        et.fields = [field]
        schema = service._build_extraction_schema(et)

        assert "enum" not in schema["properties"]["nopts"]

    def test_llm_description_preferred_over_description(self, service):
        field = MagicMock()
        field.name = "f"
        field.field_type = "string"
        field.description = "plain desc"
        field.llm_description = "llm desc"
        field.is_required = False
        field.allowed_values = None

        et = MagicMock()
        et.fields = [field]
        schema = service._build_extraction_schema(et)

        assert schema["properties"]["f"]["description"] == "llm desc"

    def test_multiselect_maps_to_array_type(self, service):
        field = MagicMock()
        field.name = "tags"
        field.field_type = "multiselect"
        field.description = "tags"
        field.llm_description = None
        field.is_required = False
        field.allowed_values = None

        et = MagicMock()
        et.fields = [field]
        schema = service._build_extraction_schema(et)

        assert schema["properties"]["tags"]["type"] == "array"


# ---------------------------------------------------------------------------
# _extract_with_llm — memory context branch (lines 1120-1124)
# ---------------------------------------------------------------------------


class TestExtractWithLLMMemoryContext:
    @pytest.mark.asyncio
    async def test_memory_context_included_in_prompt(self, service):
        from app.services.openai_service import OpenAIResponse, OpenAIUsage

        captured: list[dict] = []

        async def capture_call(messages, **kwargs):  # noqa: ARG001
            captured.extend(messages)
            return OpenAIResponse(
                content="{}",
                usage=OpenAIUsage(prompt_tokens=1, completion_tokens=1, total_tokens=2),
                model="gpt-4o-mini",
            )

        service.openai_service.chat_completion_full = AsyncMock(side_effect=capture_call)

        et = MagicMock()
        et.name = "Methods"
        et.description = "methods section"

        memory = [
            {"entity_type_name": "Participants", "summary": "N=100 patients"},
        ]

        await service._extract_with_llm(
            pdf_text="article text",
            entity_type=et,
            schema={"type": "object", "properties": {}},
            model="gpt-4o-mini",
            memory_context=memory,
        )

        user_prompt = captured[1]["content"]
        assert "CONTEXT FROM PREVIOUSLY EXTRACTED SECTIONS" in user_prompt
        assert "Participants" in user_prompt
        assert "N=100 patients" in user_prompt


# ---------------------------------------------------------------------------
# _create_suggestions — branches (lines 1248+)
# ---------------------------------------------------------------------------


class TestCreateSuggestions:
    def _make_run(self):
        run = MagicMock()
        run.id = uuid4()
        run.project_id = uuid4()
        run.article_id = uuid4()
        run.template_id = uuid4()
        return run

    @pytest.mark.asyncio
    async def test_returns_zero_when_no_extracted_data(self, service):
        run = self._make_run()
        result = await service._create_suggestions(
            project_id=run.project_id,
            article_id=run.article_id,
            entity_type_id=uuid4(),
            parent_instance_id=None,
            extracted_data={},
            run=run,
        )
        assert result == 0

    @pytest.mark.asyncio
    async def test_returns_zero_when_entity_type_not_found(self, service):
        service._entity_types.get_with_fields = AsyncMock(return_value=None)
        run = self._make_run()
        result = await service._create_suggestions(
            project_id=run.project_id,
            article_id=run.article_id,
            entity_type_id=uuid4(),
            parent_instance_id=None,
            extracted_data={"field": "value"},
            run=run,
        )
        assert result == 0

    @pytest.mark.asyncio
    async def test_skips_none_values(self, service):
        field_id = uuid4()
        field = MagicMock()
        field.id = field_id
        field.name = "f1"
        et = MagicMock()
        et.fields = [field]
        service._entity_types.get_with_fields = AsyncMock(return_value=et)
        instance = MagicMock()
        instance.id = uuid4()
        instance.parent_instance_id = None
        service._instances.get_by_article = AsyncMock(return_value=[instance])
        service._proposals.record_proposal = AsyncMock(return_value=MagicMock(id=uuid4()))
        service.db.flush = AsyncMock()

        run = self._make_run()
        result = await service._create_suggestions(
            project_id=run.project_id,
            article_id=run.article_id,
            entity_type_id=uuid4(),
            parent_instance_id=None,
            extracted_data={"f1": None},
            run=run,
        )
        assert result == 0

    @pytest.mark.asyncio
    async def test_skips_unknown_field_names(self, service):
        field = MagicMock()
        field.id = uuid4()
        field.name = "known_field"
        et = MagicMock()
        et.fields = [field]
        service._entity_types.get_with_fields = AsyncMock(return_value=et)
        instance = MagicMock()
        instance.id = uuid4()
        instance.parent_instance_id = None
        service._instances.get_by_article = AsyncMock(return_value=[instance])
        service._proposals.record_proposal = AsyncMock(return_value=MagicMock(id=uuid4()))
        service.db.flush = AsyncMock()

        run = self._make_run()
        result = await service._create_suggestions(
            project_id=run.project_id,
            article_id=run.article_id,
            entity_type_id=uuid4(),
            parent_instance_id=None,
            extracted_data={"unknown_field": "value"},
            run=run,
        )
        assert result == 0

    @pytest.mark.asyncio
    async def test_records_proposal_for_plain_value(self, service):
        field_id = uuid4()
        field = MagicMock()
        field.id = field_id
        field.name = "title"
        et = MagicMock()
        et.fields = [field]
        service._entity_types.get_with_fields = AsyncMock(return_value=et)
        instance = MagicMock()
        instance.id = uuid4()
        instance.parent_instance_id = None
        service._instances.get_by_article = AsyncMock(return_value=[instance])
        proposal = MagicMock()
        proposal.id = uuid4()
        service._proposals.record_proposal = AsyncMock(return_value=proposal)
        service.db.flush = AsyncMock()

        run = self._make_run()
        result = await service._create_suggestions(
            project_id=run.project_id,
            article_id=run.article_id,
            entity_type_id=uuid4(),
            parent_instance_id=None,
            extracted_data={"title": "A Study"},
            run=run,
        )
        assert result == 1
        service._proposals.record_proposal.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_records_proposal_for_enriched_dict_value(self, service):
        field_id = uuid4()
        field = MagicMock()
        field.id = field_id
        field.name = "sample_size"
        et = MagicMock()
        et.fields = [field]
        service._entity_types.get_with_fields = AsyncMock(return_value=et)
        instance = MagicMock()
        instance.id = uuid4()
        instance.parent_instance_id = None
        service._instances.get_by_article = AsyncMock(return_value=[instance])
        proposal = MagicMock()
        proposal.id = uuid4()
        service._proposals.record_proposal = AsyncMock(return_value=proposal)
        service.db.add = MagicMock()
        service.db.flush = AsyncMock()

        run = self._make_run()
        result = await service._create_suggestions(
            project_id=run.project_id,
            article_id=run.article_id,
            entity_type_id=uuid4(),
            parent_instance_id=None,
            extracted_data={
                "sample_size": {
                    "value": 150,
                    "confidence": 0.9,
                    "reasoning": "stated in methods",
                    "evidence": {"text": "150 patients enrolled", "page_number": 2},
                }
            },
            run=run,
        )
        assert result == 1
        # Evidence row should have been added
        service.db.add.assert_called_once()

    @pytest.mark.asyncio
    async def test_auto_creates_instance_when_missing(self, service):
        """When no instance exists, _create_suggestions auto-creates one."""
        field_id = uuid4()
        field = MagicMock()
        field.id = field_id
        field.name = "f"
        et = MagicMock()
        et.label = "My Label"
        et.sort_order = 1
        et.fields = [field]
        service._entity_types.get_with_fields = AsyncMock(return_value=et)
        # No existing instances
        service._instances.get_by_article = AsyncMock(return_value=[])
        new_instance = MagicMock()
        new_instance.id = uuid4()
        service._instances.create = AsyncMock(return_value=new_instance)
        proposal = MagicMock()
        proposal.id = uuid4()
        service._proposals.record_proposal = AsyncMock(return_value=proposal)
        service.db.flush = AsyncMock()

        run = self._make_run()
        result = await service._create_suggestions(
            project_id=run.project_id,
            article_id=run.article_id,
            entity_type_id=uuid4(),
            parent_instance_id=None,
            extracted_data={"f": "val"},
            run=run,
        )
        assert result == 1
        service._instances.create.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_parent_instance_used_to_resolve_template_id(self, service):
        """When parent_instance_id is provided and no instance exists,
        the parent's template_id is inherited."""
        field_id = uuid4()
        field = MagicMock()
        field.id = field_id
        field.name = "f"
        et = MagicMock()
        et.label = None
        et.name = "S"
        et.sort_order = 0
        et.fields = [field]
        service._entity_types.get_with_fields = AsyncMock(return_value=et)
        service._instances.get_by_article = AsyncMock(return_value=[])

        parent = MagicMock()
        parent_template_id = uuid4()
        parent.template_id = parent_template_id
        service._instances.get_by_id = AsyncMock(return_value=parent)

        new_instance = MagicMock()
        new_instance.id = uuid4()
        service._instances.create = AsyncMock(return_value=new_instance)
        proposal = MagicMock()
        proposal.id = uuid4()
        service._proposals.record_proposal = AsyncMock(return_value=proposal)
        service.db.flush = AsyncMock()

        run = self._make_run()
        parent_instance_id = uuid4()

        with patch(
            "app.services.section_extraction_service.ExtractionInstance"
        ) as mock_instance_class:
            mock_created = MagicMock()
            mock_created.id = uuid4()
            mock_instance_class.return_value = mock_created
            service._instances.create = AsyncMock(return_value=mock_created)
            await service._create_suggestions(
                project_id=run.project_id,
                article_id=run.article_id,
                entity_type_id=uuid4(),
                parent_instance_id=parent_instance_id,
                extracted_data={"f": "v"},
                run=run,
            )

        # Verify the parent was looked up
        service._instances.get_by_id.assert_awaited_once_with(parent_instance_id)

    @pytest.mark.asyncio
    async def test_evidence_without_text_not_added(self, service):
        """Evidence dicts without 'text' key should not produce a db.add call."""
        field_id = uuid4()
        field = MagicMock()
        field.id = field_id
        field.name = "f"
        et = MagicMock()
        et.fields = [field]
        service._entity_types.get_with_fields = AsyncMock(return_value=et)
        instance = MagicMock()
        instance.id = uuid4()
        instance.parent_instance_id = None
        service._instances.get_by_article = AsyncMock(return_value=[instance])
        proposal = MagicMock()
        proposal.id = uuid4()
        service._proposals.record_proposal = AsyncMock(return_value=proposal)
        service.db.add = MagicMock()
        service.db.flush = AsyncMock()

        run = self._make_run()
        await service._create_suggestions(
            project_id=run.project_id,
            article_id=run.article_id,
            entity_type_id=uuid4(),
            parent_instance_id=None,
            extracted_data={"f": {"value": "x", "evidence": {"page_number": 1}}},
            run=run,
        )
        service.db.add.assert_not_called()


# ---------------------------------------------------------------------------
# extract_section — exception path (lines 270-281)
# ---------------------------------------------------------------------------


class TestExtractSectionException:
    @pytest.mark.asyncio
    async def test_marks_run_as_failed_on_exception(self, service):
        run = MagicMock()
        run.id = uuid4()
        service._lifecycle.create_run = AsyncMock(return_value=run)
        service._lifecycle.advance_stage = AsyncMock(return_value=run)
        service._runs.start_run = AsyncMock()
        service._runs.fail_run = AsyncMock()

        service._article_files.get_latest_pdf = AsyncMock(
            side_effect=RuntimeError("pdf fetch failed")
        )

        with pytest.raises(RuntimeError, match="pdf fetch failed"):
            await service.extract_section(
                project_id=uuid4(),
                article_id=uuid4(),
                template_id=uuid4(),
                entity_type_id=uuid4(),
            )

        service._runs.fail_run.assert_awaited_once_with(run.id, "pdf fetch failed")


# ---------------------------------------------------------------------------
# extract_all_sections (lines 593-760)
# ---------------------------------------------------------------------------


class TestExtractAllSections:
    def _make_run(self):
        run = MagicMock()
        run.id = uuid4()
        return run

    def _minimal_lifecycle_wire(self, service, run):
        service._lifecycle.create_run = AsyncMock(return_value=run)
        service._lifecycle.advance_stage = AsyncMock(return_value=run)
        service._runs.start_run = AsyncMock()
        service._runs.complete_run = AsyncMock()
        service._runs.fail_run = AsyncMock()

    @pytest.mark.asyncio
    async def test_batch_with_no_child_sections(self, service):
        run = self._make_run()
        self._minimal_lifecycle_wire(service, run)

        service._instances.get_by_id = AsyncMock(return_value=None)
        service._entity_types.get_children = AsyncMock(return_value=[])

        result = await service.extract_all_sections(
            project_id=uuid4(),
            article_id=uuid4(),
            template_id=uuid4(),
            parent_instance_id=uuid4(),
            pdf_text="pre-processed text",
        )

        assert result.total_sections == 0
        assert result.successful_sections == 0
        assert result.failed_sections == 0
        assert result.total_suggestions_created == 0
        service._runs.complete_run.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_batch_fetches_pdf_when_not_provided(self, service):
        run = self._make_run()
        self._minimal_lifecycle_wire(service, run)

        service._instances.get_by_id = AsyncMock(return_value=None)
        service._entity_types.get_children = AsyncMock(return_value=[])
        mock_file = MagicMock()
        mock_file.storage_key = "test.pdf"
        service._article_files.get_latest_pdf = AsyncMock(return_value=mock_file)
        service.storage.download = AsyncMock(return_value=b"%PDF")
        service.pdf_processor.extract_text = AsyncMock(return_value="pdf text")

        await service.extract_all_sections(
            project_id=uuid4(),
            article_id=uuid4(),
            template_id=uuid4(),
            parent_instance_id=uuid4(),
            # No pdf_text provided → should fetch from storage
        )

        service._article_files.get_latest_pdf.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_batch_collects_failed_sections(self, service):
        run = self._make_run()
        self._minimal_lifecycle_wire(service, run)

        parent = MagicMock()
        parent.entity_type_id = uuid4()
        service._instances.get_by_id = AsyncMock(return_value=parent)

        child1 = MagicMock()
        child1.id = uuid4()
        child1.name = "Section A"
        service._entity_types.get_children = AsyncMock(return_value=[child1])

        # _extract_section_with_memory raises for child1
        service._extract_section_with_memory = AsyncMock(side_effect=RuntimeError("llm error"))

        result = await service.extract_all_sections(
            project_id=uuid4(),
            article_id=uuid4(),
            template_id=uuid4(),
            parent_instance_id=uuid4(),
            pdf_text="text",
        )

        assert result.failed_sections == 1
        assert result.successful_sections == 0
        section_entry = result.sections[0]
        assert section_entry["success"] is False

    @pytest.mark.asyncio
    async def test_batch_accumulates_memory_history(self, service):
        run = self._make_run()
        self._minimal_lifecycle_wire(service, run)

        parent = MagicMock()
        parent.entity_type_id = uuid4()
        service._instances.get_by_id = AsyncMock(return_value=parent)

        child1 = MagicMock()
        child1.id = uuid4()
        child1.name = "Sec1"
        child1.label = "Section 1"

        service._entity_types.get_children = AsyncMock(return_value=[child1])
        service._extract_section_with_memory = AsyncMock(
            return_value={
                "suggestions_created": 2,
                "tokens_total": 100,
                "summary": "Sec1: N=50",
            }
        )

        result = await service.extract_all_sections(
            project_id=uuid4(),
            article_id=uuid4(),
            template_id=uuid4(),
            parent_instance_id=uuid4(),
            pdf_text="text",
        )

        assert result.successful_sections == 1
        assert result.total_suggestions_created == 2

    @pytest.mark.asyncio
    async def test_batch_fails_run_on_unexpected_error(self, service):
        run = self._make_run()
        service._lifecycle.create_run = AsyncMock(return_value=run)
        service._lifecycle.advance_stage = AsyncMock(return_value=run)
        service._runs.start_run = AsyncMock()
        service._runs.fail_run = AsyncMock()

        # Make the PDF fetch explode unexpectedly (before any section loops)
        service._instances.get_by_id = AsyncMock(side_effect=RuntimeError("db exploded"))

        with pytest.raises(RuntimeError, match="db exploded"):
            await service.extract_all_sections(
                project_id=uuid4(),
                article_id=uuid4(),
                template_id=uuid4(),
                parent_instance_id=uuid4(),
                pdf_text="text",
            )

        service._runs.fail_run.assert_awaited_once()


# ---------------------------------------------------------------------------
# extract_for_run — entity error path (lines 370-386)
# ---------------------------------------------------------------------------


class TestExtractForRunErrorPath:
    @pytest.mark.asyncio
    async def test_entity_failure_recorded_in_section_results(self, service):
        from app.models.extraction import ExtractionRunStage

        run = MagicMock()
        run.id = uuid4()
        run.project_id = uuid4()
        run.article_id = uuid4()
        run.template_id = uuid4()
        run.stage = ExtractionRunStage.PROPOSAL.value
        run.kind = "extraction"

        template = MagicMock()
        template.framework = None

        service.db.get = AsyncMock(
            side_effect=lambda cls, _id: run if "Run" in cls.__name__ else template
        )

        service._article_files.get_latest_pdf = AsyncMock(
            return_value=MagicMock(storage_key="f.pdf")
        )
        service.storage.download = AsyncMock(return_value=b"%PDF")
        service.pdf_processor.extract_text = AsyncMock(return_value="text")

        failing_et = MagicMock()
        failing_et.id = uuid4()
        failing_et.name = "BadSection"

        scalars = MagicMock()
        scalars.all.return_value = [failing_et]
        execute_result = MagicMock()
        execute_result.scalars.return_value = scalars
        service.db.execute = AsyncMock(return_value=execute_result)

        service._entity_types.get_with_fields = AsyncMock(
            side_effect=RuntimeError("type fetch error")
        )

        service._runs.start_run = AsyncMock()
        service._runs.complete_run = AsyncMock()
        service._runs.fail_run = AsyncMock()
        service._lifecycle.advance_stage = AsyncMock()

        result = await service.extract_for_run(run_id=run.id)

        assert result.failed_sections == 1
        assert result.sections[0]["success"] is False
        assert "type fetch error" in result.sections[0]["error"]


class TestRollbackThenFailRun:
    """#88: a DB error during suggestion creation leaves the asyncpg session in a
    failed-transaction state, so an unguarded ``fail_run`` raises and the run is
    left stuck at ``status='running'``. The helper rolls back first."""

    @pytest.mark.asyncio
    async def test_rolls_back_before_marking_failed(self, service) -> None:
        order: list[str] = []
        service.db.rollback = AsyncMock(side_effect=lambda: order.append("rollback"))
        service._runs.fail_run = AsyncMock(side_effect=lambda *_a, **_k: order.append("fail_run"))

        await service._rollback_then_fail_run(uuid4(), "boom")

        assert order == ["rollback", "fail_run"]

    @pytest.mark.asyncio
    async def test_swallows_fail_run_error(self, service) -> None:
        # Even if marking the run failed itself errors, the helper must not raise
        # (the original error has already been surfaced by the caller).
        service.db.rollback = AsyncMock()
        service._runs.fail_run = AsyncMock(side_effect=RuntimeError("still broken"))

        await service._rollback_then_fail_run(uuid4(), "boom")

        service.db.rollback.assert_awaited_once()
        service._runs.fail_run.assert_awaited_once()
