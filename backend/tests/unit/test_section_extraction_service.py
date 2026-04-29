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

        # The run lifecycle gets two distinct stage advances: pending → proposal
        # before the LLM call, and proposal → review after recording proposals
        # so the form can immediately accept ReviewerDecisions.
        from app.models.extraction import ExtractionRunStage

        advance_calls = service._lifecycle.advance_stage.await_args_list
        target_stages = [call.kwargs.get("target_stage") for call in advance_calls]
        assert ExtractionRunStage.PROPOSAL in target_stages
        assert ExtractionRunStage.REVIEW in target_stages
        # And REVIEW comes after PROPOSAL.
        assert target_stages.index(ExtractionRunStage.REVIEW) > target_stages.index(
            ExtractionRunStage.PROPOSAL
        )


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
