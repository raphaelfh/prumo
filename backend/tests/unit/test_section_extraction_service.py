"""
Unit tests for SectionExtractionService.

Covers PDF fetching, entity-type lookups, orchestration of
extract_section / extract_for_run / extract_all_sections, suggestion
creation, and the _extract_with_llm wiring into the typed LLM call
layer (app.llm). Schema-building behaviour is covered by
tests/unit/llm/test_schema.py; prompt content by
tests/unit/llm/test_prompts.py.
"""

from pathlib import Path
from unittest.mock import ANY, AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.infrastructure.storage import StorageAdapter
from app.llm.extractor import LlmUsage
from app.schemas.llm_target import LlmTarget
from app.services.extraction_prompt_input import PromptInputInfo
from app.services.run_engine_freeze import build_run_provenance
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
        patch("app.services.section_extraction_service.ArticleFileRepository") as mock_article_repo,
        patch("app.services.extraction_prompt_input.ArticleTextBlockRepository") as mock_block_repo,
        patch("app.services.extraction_prompt_input.DocumentParsingService") as mock_parsing_cls,
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
        # Mock repositories
        mock_article_repo_instance = MagicMock()
        # Return a mock file with content_markdown so build_prompt_input doesn't
        # need to trigger an on-demand parse in unit tests. Individual tests that
        # want to exercise _assemble_prompt_text can mock it on the service directly.
        mock_file = MagicMock()
        mock_file.content_markdown = "mocked article text"
        mock_article_repo_instance.get_latest_pdf = AsyncMock(return_value=mock_file)
        mock_article_repo.return_value = mock_article_repo_instance

        # ArticleTextBlockRepository: return non-empty blocks so the on-demand
        # parse branch is not triggered by default.
        mock_block_repo_instance = MagicMock()
        mock_block_repo_instance.list_ordered_for_file = AsyncMock(return_value=[MagicMock()])
        mock_block_repo.return_value = mock_block_repo_instance

        # DocumentParsingService: no-op in unit tests (on-demand parse not needed).
        mock_parsing_instance = MagicMock()
        mock_parsing_instance.parse_article_file = AsyncMock(return_value=None)
        mock_parsing_cls.return_value = mock_parsing_instance

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
        svc._article_files = mock_article_repo_instance
        svc._entity_types = mock_entity_repo_instance
        svc._instances = mock_instance_repo_instance
        svc._proposals = mock_proposal_instance
        svc._runs = mock_run_repo_instance
        svc._lifecycle = mock_lifecycle_instance
        # Engine freeze: None = "the run names no engine", so the service keeps
        # the settings-derived candidate. Stubbed explicitly rather than left to
        # a MagicMock auto-attribute, which is not awaitable.
        svc._runs.freeze_engine = AsyncMock(return_value=None)

        # B-2: the run-pinned snapshot provider is a service seam now. Default
        # to an empty pinned tree so ``extract_section`` routes through the
        # live-lookup fallback (the read the pre-B-2 assertions encode); tests
        # that exercise the pinned branch override this per test.
        svc._pinned_entity_types = AsyncMock(return_value=[])

        return svc


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
        parent_instance_id = uuid4()
        parent_entity_type_id = uuid4()

        run = MagicMock()
        run.version_id = uuid4()
        run.template_id = uuid4()

        # Mock parent instance
        mock_parent = MagicMock()
        mock_parent.entity_type_id = parent_entity_type_id
        service._instances.get_by_id = AsyncMock(return_value=mock_parent)

        # B-2: children come from the run-pinned tree, filtered by parent id.
        mock_child1 = MagicMock()
        mock_child1.id = uuid4()
        mock_child1.name = "Section 1"
        mock_child1.parent_entity_type_id = parent_entity_type_id

        mock_child2 = MagicMock()
        mock_child2.id = uuid4()
        mock_child2.name = "Section 2"
        mock_child2.parent_entity_type_id = parent_entity_type_id

        service._pinned_entity_types = AsyncMock(return_value=[mock_child1, mock_child2])

        result = await service._get_child_entity_types(
            run=run,
            parent_instance_id=parent_instance_id,
        )

        assert len(result) == 2
        assert result[0].name == "Section 1"


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

        # Mock PDF storage + article-file lookup
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
        mock_entity.parent_entity_type_id = None
        mock_entity.fields = [mock_field]
        service._entity_types.get_with_fields = AsyncMock(return_value=mock_entity)
        # B-2: the entity type is served from the run-pinned tree; the live
        # ``get_with_fields`` above only feeds the field-id intersection.
        service._pinned_entity_types = AsyncMock(return_value=[mock_entity])

        # Mock run resolution — the standalone path goes through the
        # resolve-or-create gate (one-live-run invariant); created=True keeps
        # the standalone lifecycle semantics (start/complete owned here).
        mock_run = MagicMock()
        mock_run.id = run_id
        service._lifecycle.resolve_or_create_extract_run = AsyncMock(return_value=(mock_run, True))
        service._runs.start_run = AsyncMock()
        service._runs.complete_run = AsyncMock()
        service._runs.fail_run = AsyncMock()

        # Mock proposal recording (returns a record-shaped object with .id)
        mock_proposal = MagicMock()
        mock_proposal.id = uuid4()
        service._proposals.record_proposal = AsyncMock(return_value=mock_proposal)

        # Mock instances (for _create_suggestions)
        service._instances.get_by_article = AsyncMock(return_value=[])

        # Mock the prompt assembly seam
        service._assemble_prompt_text = AsyncMock(return_value="Extracted text from PDF")

        # Mock the typed LLM call seam
        service._extract_with_llm = AsyncMock(
            return_value=(
                {"field_1": "Extracted value"},
                LlmUsage(prompt_tokens=100, completion_tokens=50),
            )
        )

        # Mock SQLAlchemy model class to avoid mapper issues
        with (
            patch(
                "app.services.section_extraction_service.ExtractionInstance"
            ) as mock_instance_class,
            patch(
                "app.services.extraction_prompt_input.ArticleTextBlockRepository"
            ) as mock_blk_repo,
        ):
            mock_created_instance = MagicMock()
            mock_created_instance.id = uuid4()
            mock_instance_class.return_value = mock_created_instance
            service._instances.create = AsyncMock(return_value=mock_created_instance)

            mock_blk_repo_inst = MagicMock()
            mock_blk_repo_inst.list_ordered_for_file = AsyncMock(return_value=[])
            mock_blk_repo.return_value = mock_blk_repo_inst

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

        # The gate delivers a run already parked in EXTRACT and the service
        # never advances it further: the run STAYS in EXTRACT after AI
        # proposing so ``useExtractedValues`` can hydrate from
        # ``runDetail.proposals`` and show the values in the form. The user
        # advances to CONSENSUS explicitly via "Start consensus" — an
        # auto-advance here skipped the extract-stage hydration and left the
        # form blank until F5 (#bug: AI extraction values not appearing).
        service._lifecycle.resolve_or_create_extract_run.assert_awaited_once()
        service._lifecycle.advance_stage.assert_not_awaited()


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
        mock_file = MagicMock()
        mock_file.storage_key = "test.pdf"
        service._article_files.get_latest_pdf = AsyncMock(return_value=mock_file)
        mock_storage.download = AsyncMock(return_value=b"%PDF-1.4 test")
        service._assemble_prompt_text = AsyncMock(return_value="text")

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

        # Typed LLM call seam.
        service._extract_with_llm = AsyncMock(
            return_value=({"field_1": "value"}, LlmUsage(prompt_tokens=10, completion_tokens=5))
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
        existing_run.stage = ExtractionRunStage.EXTRACT.value

        self._wire_pipeline(service, mock_storage, existing_run, entity_type_id)

        with (
            patch(
                "app.services.section_extraction_service.ExtractionInstance"
            ) as mock_instance_class,
            patch(
                "app.services.extraction_prompt_input.ArticleTextBlockRepository"
            ) as mock_blk_repo,
        ):
            inst = MagicMock()
            inst.id = uuid4()
            mock_instance_class.return_value = inst
            service._instances.create = AsyncMock(return_value=inst)

            mock_blk_repo_inst = MagicMock()
            mock_blk_repo_inst.list_ordered_for_file = AsyncMock(return_value=[])
            mock_blk_repo.return_value = mock_blk_repo_inst

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
    async def test_existing_run_id_rejects_non_extract_stage(self, service, mock_storage):
        """Run already moved past EXTRACT → reject (matches extract_for_run)."""
        from app.models.extraction import ExtractionRunStage

        existing_run = MagicMock()
        existing_run.id = uuid4()
        existing_run.stage = ExtractionRunStage.CONSENSUS.value

        self._wire_pipeline(service, mock_storage, existing_run, uuid4())

        with pytest.raises(ValueError, match="EXTRACT"):
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

        run.stage = ExtractionRunStage.EXTRACT.value
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
        service.db.get = AsyncMock(
            side_effect=lambda model_cls, _id: run if "Run" in model_cls.__name__ else template
        )

        # PDF + entity-type fetches
        service._article_files.get_latest_pdf = AsyncMock(
            return_value=MagicMock(storage_key="x.pdf")
        )
        service.storage.download = AsyncMock(return_value=b"%PDF")
        service._assemble_prompt_text = AsyncMock(return_value="article text")

        async def fake_get_with_fields(et_id):
            for et in top_level_entity_types:
                if et.id == et_id:
                    return et
            return None

        service._entity_types.get_with_fields = AsyncMock(side_effect=fake_get_with_fields)

        # B-2: the top-level set comes from the run-pinned tree seam.
        service._pinned_entity_types = AsyncMock(return_value=top_level_entity_types)

        # db.execute serves the human-proposal probe and the pinned
        # general-instruction fetch (scalar_one_or_none -> None).
        execute_result = MagicMock()
        execute_result.all.return_value = []  # for the human-proposal probe
        execute_result.scalar_one_or_none.return_value = None
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

        # Typed LLM call seam
        service._extract_with_llm = AsyncMock(
            return_value=({}, LlmUsage(prompt_tokens=10, completion_tokens=5))
        )

        # Proposal writes
        service._proposals.record_proposal = AsyncMock(return_value=MagicMock(id=uuid4()))

    @pytest.mark.asyncio
    async def test_extract_for_run_does_not_advance_when_disabled(
        self, service, qa_run, qa_template
    ):
        """``extract_for_run`` never flips the stage: the run stays in EXTRACT
        and the QA publish flow drives extract → consensus → finalized itself.
        With ``auto_advance_to_review=False`` no advance is attempted."""
        et = MagicMock()
        et.id = uuid4()
        et.name = "Participants"
        et.fields = []
        et.parent_entity_type_id = None
        self._wire_minimal_qa_pipeline(service, qa_run, qa_template, [et])
        service._assemble_prompt_text = AsyncMock(return_value="article text")

        await service.extract_for_run(
            run_id=qa_run.id,
            auto_advance_to_review=False,
        )

        service._lifecycle.advance_stage.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_extract_for_run_writes_no_aggregate_provenance_at_completion(
        self, service, qa_run, qa_template
    ):
        # Provenance is now written PER SECTION at the choke-point; the batch
        # completion must NOT also write a run-aggregate ``provenance`` key
        # (complete_run shallow-merges, so it would clobber the per-section
        # ``sections`` map with the last section's snapshot).
        et = MagicMock()
        et.id = uuid4()
        et.name = "Participants"
        et.fields = []
        et.parent_entity_type_id = None
        self._wire_minimal_qa_pipeline(service, qa_run, qa_template, [et])

        await service.extract_for_run(run_id=qa_run.id)

        results = service._runs.complete_run.await_args.kwargs["results"]
        assert "provenance" not in results

    @pytest.mark.asyncio
    async def test_extract_for_run_does_not_advance_even_when_enabled(
        self, service, qa_run, qa_template
    ):
        """``auto_advance_to_review`` is inert in the collapsed lifecycle:
        there is no separate review stage, so even with the flag True the run
        stays in EXTRACT and no stage advance is attempted."""
        et = MagicMock()
        et.id = uuid4()
        et.name = "Participants"
        et.fields = []
        et.parent_entity_type_id = None
        self._wire_minimal_qa_pipeline(service, qa_run, qa_template, [et])
        service._assemble_prompt_text = AsyncMock(return_value="article text")

        await service.extract_for_run(
            run_id=qa_run.id,
            auto_advance_to_review=True,
        )

        service._lifecycle.advance_stage.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_extract_for_run_rejects_non_extract_stage(self, service, qa_run, qa_template):
        from app.models.extraction import ExtractionRunStage

        qa_run.stage = ExtractionRunStage.CONSENSUS.value
        self._wire_minimal_qa_pipeline(service, qa_run, qa_template, [])

        with pytest.raises(ValueError, match="EXTRACT"):
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


class TestFieldsWithHumanDecision:
    """Re-run safety in the collapsed ``extract`` lifecycle: human
    *extraction* values land as per-reviewer ``ReviewerDecision`` rows (the
    blind-review write gate rejects ``human`` proposals for
    ``kind='extraction'``), so the proposal probe never sees them. A field
    whose *current* reviewer decision is ``edit`` or ``accept_proposal`` is
    protected; ``reject`` leaves the field eligible for a fresh AI guess."""

    @pytest.mark.asyncio
    async def test_returns_empty_set_for_empty_field_ids(self, service):
        result = await service._fields_with_human_decision(
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
    async def test_picks_edit_and_accept_proposal_but_not_reject(self, service):
        from app.models.extraction_workflow import ExtractionReviewerDecisionType

        f_edit = uuid4()
        f_accept = uuid4()
        f_reject = uuid4()
        rows = [
            (f_edit, ExtractionReviewerDecisionType.EDIT.value),
            (f_accept, ExtractionReviewerDecisionType.ACCEPT_PROPOSAL.value),
            (f_reject, ExtractionReviewerDecisionType.REJECT.value),
        ]
        execute_result = MagicMock()
        execute_result.all.return_value = rows
        service.db.execute = AsyncMock(return_value=execute_result)

        result = await service._fields_with_human_decision(
            run_id=uuid4(),
            instance_id=uuid4(),
            field_ids=[f_edit, f_accept, f_reject],
        )

        assert result == {f_edit, f_accept}

    @pytest.mark.asyncio
    async def test_fields_without_decisions_are_not_in_result(self, service):
        execute_result = MagicMock()
        execute_result.all.return_value = []
        service.db.execute = AsyncMock(return_value=execute_result)

        result = await service._fields_with_human_decision(
            run_id=uuid4(),
            instance_id=uuid4(),
            field_ids=[uuid4()],
        )

        assert result == set()


class TestExtractOneEntityTypeForRun:
    """No-mutation invariant: filtering out human-settled fields must NOT touch
    the ORM-managed ``full_entity_type.fields`` collection. It is
    ``cascade="all, delete-orphan"``, so dropping items schedules them for
    DELETE on the next flush — and a skipped field is exactly one a human
    proposal/decision references under an ``ondelete=RESTRICT`` FK, so the
    orphan delete raises ForeignKeyViolationError mid-extraction. The filtered
    subset is handed to the LLM via ``fields_override`` instead."""

    @pytest.fixture
    def run(self):
        from app.models.extraction import ExtractionRunStage

        run = MagicMock()
        run.id = uuid4()
        run.project_id = uuid4()
        run.article_id = uuid4()
        run.template_id = uuid4()
        run.stage = ExtractionRunStage.EXTRACT.value
        run.kind = "extraction"
        return run

    @pytest.mark.asyncio
    async def test_does_not_mutate_field_collection_when_filtering(self, service, run):
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
        service._fields_with_human_decision = AsyncMock(return_value=set())

        # Capture what the LLM is actually asked to fill — must be the override,
        # never a mutation of the ORM collection.
        captured: dict[str, list] = {}

        async def fake_llm(*, fields_override, **_kwargs):
            captured["override"] = [f.id for f in fields_override]
            return ({}, LlmUsage(prompt_tokens=1, completion_tokens=1))

        service._extract_with_llm = AsyncMock(side_effect=fake_llm)
        service._create_suggestions = AsyncMock(return_value=0)

        # B-2: the passed-in entity type is the PINNED fake and carries the
        # snapshot fields; ``_live_field_intersection`` intersects them with
        # the live ids served by the ``get_with_fields`` mock above.
        et_summary = MagicMock()
        et_summary.id = full_et.id
        et_summary.name = full_et.name
        et_summary.fields = [f_keep, f_skip]

        await service._extract_one_entity_type_for_run(
            run=run,
            entity_type=et_summary,
            pdf_text="text",
            framework=None,
            kind="extraction",
            skip_fields_with_human_proposals=True,
        )

        # Only the un-settled field is sent to the LLM (via the override) ...
        assert captured["override"] == [f_keep.id]
        # ... and the delete-orphan-cascaded ORM collection was never mutated.
        assert full_et.fields == [f_keep, f_skip]
        assert full_et.fields is original_fields_ref

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
        service._fields_with_human_decision = AsyncMock(return_value=set())
        # If filter logic is wrong the LLM gets called — fail loudly.
        service._extract_with_llm = AsyncMock(
            side_effect=AssertionError("LLM must NOT be called when all fields are human")
        )
        service._create_suggestions = AsyncMock(return_value=0)

        # B-2: the pinned fake carries the snapshot fields.
        et_summary = MagicMock()
        et_summary.id = full_et.id
        et_summary.name = "x"
        et_summary.fields = [f1, f2]

        result = await service._extract_one_entity_type_for_run(
            run=run,
            entity_type=et_summary,
            pdf_text="text",
            framework=None,
            kind="extraction",
            skip_fields_with_human_proposals=True,
        )

        assert result == {"suggestions_created": 0, "tokens_total": 0, "skipped": True}
        service._extract_with_llm.assert_not_called()

    @pytest.mark.asyncio
    async def test_no_filter_when_skip_flag_is_false(self, service, run):
        # ``MagicMock(name='a')`` sets the *mock's* name, not the .name attribute.
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
        service._fields_with_human_decision = AsyncMock(
            side_effect=AssertionError("human-decision probe must not run when skip flag is False")
        )
        service._extract_with_llm = AsyncMock(
            return_value=({}, LlmUsage(prompt_tokens=1, completion_tokens=1))
        )
        service._create_suggestions = AsyncMock(return_value=0)

        # B-2: the pinned fake carries the snapshot fields.
        et_summary = MagicMock()
        et_summary.id = full_et.id
        et_summary.name = "x"
        et_summary.fields = [f1]

        await service._extract_one_entity_type_for_run(
            run=run,
            entity_type=et_summary,
            pdf_text="text",
            framework=None,
            kind="extraction",
            skip_fields_with_human_proposals=False,
        )

        service._fields_with_recent_human_proposal.assert_not_called()
        service._fields_with_human_decision.assert_not_called()

    @pytest.mark.asyncio
    async def test_skip_set_unions_proposal_and_decision_probes(self, service, run):
        """The skip set is the UNION of human-proposal fields (the QA track)
        and human-decision fields (the extraction track). A field protected by
        EITHER probe is excluded from the LLM call; only the untouched field
        reaches the model."""
        f_proposal = MagicMock(id=uuid4())
        f_proposal.name = "via_proposal"
        f_decision = MagicMock(id=uuid4())
        f_decision.name = "via_decision"
        f_open = MagicMock(id=uuid4())
        f_open.name = "eligible"
        f_open.field_type = "string"
        f_open.description = ""
        f_open.is_required = False

        full_et = MagicMock()
        full_et.id = uuid4()
        full_et.name = "Section"
        full_et.description = ""
        full_et.fields = [f_proposal, f_decision, f_open]

        service._entity_types.get_with_fields = AsyncMock(return_value=full_et)
        service._instances.get_by_article = AsyncMock(
            return_value=[MagicMock(id=uuid4(), parent_instance_id=None)]
        )
        service._fields_with_recent_human_proposal = AsyncMock(return_value={f_proposal.id})
        service._fields_with_human_decision = AsyncMock(return_value={f_decision.id})

        captured: dict[str, list] = {}

        async def fake_llm(*, entity_type, fields_override, **_kwargs):
            captured["override"] = [f.id for f in fields_override]
            captured["entity_fields"] = [f.id for f in entity_type.fields]
            return ({}, LlmUsage(prompt_tokens=1, completion_tokens=1))

        service._extract_with_llm = AsyncMock(side_effect=fake_llm)
        service._create_suggestions = AsyncMock(return_value=0)

        # B-2: the pinned fake carries the snapshot fields.
        et_summary = MagicMock()
        et_summary.id = full_et.id
        et_summary.name = "x"
        et_summary.fields = [f_proposal, f_decision, f_open]

        await service._extract_one_entity_type_for_run(
            run=run,
            entity_type=et_summary,
            pdf_text="text",
            framework=None,
            kind="extraction",
            skip_fields_with_human_proposals=True,
        )

        # Only the untouched field is sent to the LLM, via the override ...
        assert captured["override"] == [f_open.id]
        # ... while the pinned fields collection keeps all three (never mutated).
        assert captured["entity_fields"] == [f_proposal.id, f_decision.id, f_open.id]


# ---------------------------------------------------------------------------
# _generate_extraction_summary
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
# _get_child_entity_types edge cases
# ---------------------------------------------------------------------------


class TestGetChildEntityTypesEdgeCases:
    @staticmethod
    def _make_run():
        run = MagicMock()
        run.version_id = uuid4()
        run.template_id = uuid4()
        return run

    @pytest.mark.asyncio
    async def test_returns_empty_when_parent_instance_not_found(self, service):
        service._instances.get_by_id = AsyncMock(return_value=None)
        result = await service._get_child_entity_types(
            run=self._make_run(),
            parent_instance_id=uuid4(),
        )
        assert result == []

    @pytest.mark.asyncio
    async def test_returns_empty_when_no_child_entity_types(self, service):
        parent = MagicMock()
        parent.entity_type_id = uuid4()
        service._instances.get_by_id = AsyncMock(return_value=parent)
        service._pinned_entity_types = AsyncMock(return_value=[])
        result = await service._get_child_entity_types(
            run=self._make_run(),
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
        et1.parent_entity_type_id = parent.entity_type_id
        et2 = MagicMock()
        et2.id = id2
        et2.parent_entity_type_id = parent.entity_type_id
        service._pinned_entity_types = AsyncMock(return_value=[et1, et2])

        result = await service._get_child_entity_types(
            run=self._make_run(),
            parent_instance_id=uuid4(),
            section_ids=[id1],
        )
        assert len(result) == 1
        assert result[0].id == id1


# ---------------------------------------------------------------------------
# _create_suggestions — branches
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

    def _wire_one_field(self, service):
        field1 = MagicMock()
        field1.id, field1.name = uuid4(), "f1"
        field1.field_type = "text"
        field1.allowed_values = None
        et = MagicMock()
        et.fields = [field1]
        service._entity_types.get_with_fields = AsyncMock(return_value=et)
        instance = MagicMock()
        instance.id = uuid4()
        instance.parent_instance_id = None
        service._instances.get_by_article = AsyncMock(return_value=[instance])
        service._proposals.record_proposal = AsyncMock(return_value=MagicMock(id=uuid4()))
        service.db.flush = AsyncMock()
        # Stub the per-section provenance merge explicitly: an auto-attribute on
        # the MagicMock would let a typo'd method name pass the assertions.
        service._runs.merge_provenance_section = AsyncMock()

    @pytest.mark.asyncio
    async def test_persists_provenance_at_chokepoint_when_llm_ran(self, service):
        # Provenance is written ONCE at the proposal choke-point, keyed by
        # entity_type_id, so EVERY suggestion-owning run records how each section
        # was generated and concurrent sections don't clobber each other.
        self._wire_one_field(service)
        entity_type_id = uuid4()
        service._engine = LlmTarget(provider="openai", model="gpt-x")
        service._run_provenance = build_run_provenance(
            ran_by_user_id=service.user_id,
            engine=service._engine,
            key_scope=service._credentials.key_scope,
            prompt_name="extract",
            prompt_version="1",
            usage=LlmUsage(prompt_tokens=10, completion_tokens=5),
        )

        run = self._make_run()
        await service._create_suggestions(
            project_id=run.project_id,
            article_id=run.article_id,
            entity_type_id=entity_type_id,
            parent_instance_id=None,
            extracted_data={"f1": "value"},
            run=run,
        )

        # Provenance lands through the per-section merge, keyed by entity type.
        service._runs.merge_provenance_section.assert_awaited_once()
        merged_run_id, merged_et_id, snapshot = (
            service._runs.merge_provenance_section.await_args.args
        )
        assert merged_run_id == run.id
        assert merged_et_id == entity_type_id
        assert snapshot["model"] == "gpt-x"
        assert snapshot["tokens"] == {"prompt": 10, "completion": 5, "total": 15}

    @pytest.mark.asyncio
    async def test_sequential_sections_each_get_own_snapshot(self, service):
        # ``self._run_provenance`` is shared instance state overwritten per
        # section by _extract_with_llm. Two sequential sections on one run must
        # each merge THEIR OWN snapshot under THEIR OWN entity_type_id — a stale
        # snapshot leaking to the wrong section is the mis-attribution this
        # feature exists to prevent.
        self._wire_one_field(service)
        run = self._make_run()
        et_a, et_b = uuid4(), uuid4()

        service._engine = LlmTarget(provider="openai", model="m-a")
        service._run_provenance = build_run_provenance(
            ran_by_user_id=service.user_id,
            engine=service._engine,
            key_scope=service._credentials.key_scope,
            prompt_name="extract",
            prompt_version="1",
        )
        await service._create_suggestions(
            project_id=run.project_id,
            article_id=run.article_id,
            entity_type_id=et_a,
            parent_instance_id=None,
            extracted_data={"f1": "value"},
            run=run,
        )
        service._engine = LlmTarget(provider="openai", model="m-b")
        service._run_provenance = build_run_provenance(
            ran_by_user_id=service.user_id,
            engine=service._engine,
            key_scope=service._credentials.key_scope,
            prompt_name="extract",
            prompt_version="1",
        )
        await service._create_suggestions(
            project_id=run.project_id,
            article_id=run.article_id,
            entity_type_id=et_b,
            parent_instance_id=None,
            extracted_data={"f1": "value"},
            run=run,
        )

        calls = service._runs.merge_provenance_section.await_args_list
        assert len(calls) == 2
        (rid_a, key_a, snap_a), _ = calls[0]
        (rid_b, key_b, snap_b), _ = calls[1]
        assert (rid_a, key_a, snap_a["model"]) == (run.id, et_a, "m-a")
        assert (rid_b, key_b, snap_b["model"]) == (run.id, et_b, "m-b")

    @pytest.mark.asyncio
    async def test_skips_provenance_when_no_llm_ran(self, service):
        # No provenance snapshot → nothing to record; never write a null provenance.
        self._wire_one_field(service)
        service._run_provenance = None

        run = self._make_run()
        await service._create_suggestions(
            project_id=run.project_id,
            article_id=run.article_id,
            entity_type_id=uuid4(),
            parent_instance_id=None,
            extracted_data={"f1": "value"},
            run=run,
        )

        service._runs.merge_provenance_section.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_creates_no_info_proposal_for_none_and_abstention(self, service):
        # "No information found" outcomes (bare None + status=not_found) are
        # recorded as first-class proposals carrying the coded no-information
        # marker ``{value:null, absent_reason:"no_information"}`` (ADR-0016
        # Phase 1) so the run is traceable and the coordinate counts as a
        # *resolved* abstention — not silently dropped and not a bare null.
        # Never wrap the status dict; drop the misleading not_found confidence;
        # keep the "why not found" reasoning.
        f1, f2 = uuid4(), uuid4()
        field1, field2 = MagicMock(), MagicMock()
        field1.id, field1.name = f1, "f1"
        field2.id, field2.name = f2, "f2"
        et = MagicMock()
        et.fields = [field1, field2]
        service._entity_types.get_with_fields = AsyncMock(return_value=et)
        instance = MagicMock()
        instance.id = uuid4()
        instance.parent_instance_id = None
        service._instances.get_by_article = AsyncMock(return_value=[instance])
        recorded: list[dict] = []

        async def _rec(**kwargs):
            recorded.append(kwargs)
            return MagicMock(id=uuid4())

        service._proposals.record_proposal = AsyncMock(side_effect=_rec)
        service.db.flush = AsyncMock()

        run = self._make_run()
        result = await service._create_suggestions(
            project_id=run.project_id,
            article_id=run.article_id,
            entity_type_id=uuid4(),
            parent_instance_id=None,
            extracted_data={
                "f1": None,
                "f2": {
                    "status": "not_found",
                    "value": None,
                    "reasoning": "not stated in the article",
                    "confidence": 0.0,
                    "evidence": [],
                },
            },
            run=run,
        )
        assert result == 2
        by_field = {k["field_id"]: k for k in recorded}
        assert by_field[f1]["proposed_value"] == {
            "value": None,
            "absent_reason": "no_information",
        }
        assert by_field[f1]["confidence_score"] is None
        assert by_field[f2]["proposed_value"] == {
            "value": None,
            "absent_reason": "no_information",
        }
        assert by_field[f2]["confidence_score"] is None  # no misleading 0% on a no-info card
        assert by_field[f2]["rationale"] == "not stated in the article"

    @pytest.mark.asyncio
    async def test_ambiguous_status_records_no_marker(self, service):
        # ADR-0016 Phase 1 splits the recording branch: ``status='ambiguous'``
        # ("present but conflicting") is NOT "absent". It must stay a
        # needs-attention proposal — a found-style value with its confidence
        # preserved and NO ``absent_reason`` marker — so it still blocks the
        # finalize gate (never silently collapsed to no_information).
        f1 = uuid4()
        field1 = MagicMock()
        field1.id, field1.name = f1, "f1"
        et = MagicMock()
        et.fields = [field1]
        service._entity_types.get_with_fields = AsyncMock(return_value=et)
        instance = MagicMock()
        instance.id = uuid4()
        instance.parent_instance_id = None
        service._instances.get_by_article = AsyncMock(return_value=[instance])
        recorded: list[dict] = []

        async def _rec(**kwargs):
            recorded.append(kwargs)
            return MagicMock(id=uuid4())

        service._proposals.record_proposal = AsyncMock(side_effect=_rec)
        service.db.flush = AsyncMock()

        run = self._make_run()
        result = await service._create_suggestions(
            project_id=run.project_id,
            article_id=run.article_id,
            entity_type_id=uuid4(),
            parent_instance_id=None,
            extracted_data={
                "f1": {
                    "status": "ambiguous",
                    "value": "Maybe A or B",
                    "reasoning": "two conflicting statements",
                    "confidence": 0.3,
                    "evidence": [],
                },
            },
            run=run,
        )
        assert result == 1
        prop = recorded[0]
        # No marker — the value is preserved and the confidence survives so the
        # card reads as a real low-confidence proposal, not a resolved abstention.
        assert "absent_reason" not in prop["proposed_value"]
        assert prop["proposed_value"] == {"value": "Maybe A or B"}
        assert prop["confidence_score"] == 0.3
        assert prop["rationale"] == "two conflicting statements"

    @pytest.mark.asyncio
    async def test_verdict_annotates_found_proposal(self, service):
        # Verified mode: the verdict is a TYPED-dump ANNOTATION sibling on
        # proposed_value — the absent_reason precedent — never a mutation of
        # the value or the confidence (§IX).
        self._wire_one_field(service)
        run = self._make_run()
        await service._create_suggestions(
            project_id=run.project_id,
            article_id=run.article_id,
            entity_type_id=uuid4(),
            parent_instance_id=None,
            extracted_data={
                "f1": {
                    "value": "x",
                    "confidence": 0.9,
                    "reasoning": None,
                    "evidence": [],
                    "status": "found",
                }
            },
            run=run,
            verdicts={"f1": "unsupported"},
        )
        kwargs = service._proposals.record_proposal.await_args.kwargs
        assert kwargs["proposed_value"] == {
            "value": "x",
            "verification": {"verdict": "unsupported"},
        }
        assert kwargs["confidence_score"] == 0.9  # never rewritten

    @pytest.mark.asyncio
    async def test_unmatched_verdict_key_logs_a_warning(self, service, monkeypatch):
        # Panel A4: a verdict keyed outside the field vocabulary would
        # silently annotate nothing — the drift must be loud.
        self._wire_one_field(service)
        mock_logger = MagicMock()
        monkeypatch.setattr(SectionExtractionService, "logger", mock_logger)
        run = self._make_run()
        await service._create_suggestions(
            project_id=run.project_id,
            article_id=run.article_id,
            entity_type_id=uuid4(),
            parent_instance_id=None,
            extracted_data={
                "f1": {
                    "value": "x",
                    "confidence": 0.9,
                    "reasoning": None,
                    "evidence": [],
                    "status": "found",
                }
            },
            run=run,
            verdicts={"f1": "confirmed", "ghost": "confirmed"},
        )
        events = [c.args[0] for c in mock_logger.warning.call_args_list]
        assert "verify_verdict_unmatched" in events

    def test_build_run_provenance_shape(self):
        # Per-section snapshot of how the suggestions were generated; params come
        # from the single-source extractor constants so they can't drift from
        # what was actually sent. No prompt_text — the system prompt lives in the
        # prompt_composition (a duplicate flat copy serves no reader).
        prov = build_run_provenance(
            ran_by_user_id="user-123",
            engine=LlmTarget(provider="openai", model="gpt-4o-mini"),
            key_scope=None,
            prompt_name="section_extraction",
            prompt_version="v3",
        )
        assert prov["ran_by_user_id"] == "user-123"
        assert prov["model"] == "gpt-4o-mini"
        assert prov["strategy"] == "section_extraction"
        assert prov["prompt_version"] == "v3"
        assert "prompt_text" not in prov
        assert prov["params"]["temperature"] == 0.1
        assert prov["params"]["output_retries"] == 2
        assert "timeout_seconds" in prov["params"]
        assert "provider" in prov

    def test_build_run_provenance_includes_composition_and_tokens(self, service):
        # The complete section snapshot: token usage in {prompt, completion,
        # total} shape + the structured composition, both optional kwargs.
        from app.schemas.prompt_composition import (
            PromptComposition,
            PromptCompositionArticleRef,
        )

        snap = build_run_provenance(
            ran_by_user_id=service.user_id,
            engine=service._engine,
            key_scope=None,
            prompt_name="section_extraction",
            prompt_version="v1",
            usage=LlmUsage(prompt_tokens=10, completion_tokens=5),
            prompt_composition=PromptComposition(
                section_name="Source of Data",
                system_prompt="SYS",
                section_instruction="I",
                article_ref=PromptCompositionArticleRef(),
                fields_requested=["data_source"],
                llm_calls=1,
            ),
        )
        assert snap["tokens"] == {"prompt": 10, "completion": 5, "total": 15}
        assert snap["prompt_composition"]["section_name"] == "Source of Data"
        assert snap["prompt_composition"]["fields_requested"] == ["data_source"]

    def test_build_run_provenance_omits_optional_keys_when_absent(self, service):
        # No usage / no composition → those keys are simply absent (the no-LLM
        # and legacy-caller shapes), never null placeholders.
        snap = build_run_provenance(
            ran_by_user_id=service.user_id,
            engine=service._engine,
            key_scope=None,
            prompt_name="section_extraction",
            prompt_version="v1",
        )
        assert "tokens" not in snap
        assert "prompt_composition" not in snap

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
# extract_section — exception path
# ---------------------------------------------------------------------------


class TestExtractSectionException:
    @pytest.mark.asyncio
    async def test_marks_run_as_failed_on_exception(self, service):
        run = MagicMock()
        run.id = uuid4()
        # Standalone path resolves through the one-live-run gate; created=True
        # keeps the standalone lifecycle semantics.
        service._lifecycle.resolve_or_create_extract_run = AsyncMock(return_value=(run, True))
        service._runs.start_run = AsyncMock()
        service._runs.rollback_and_fail = AsyncMock()

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

        # The service delegates rollback-then-fail to the repository (mechanics
        # covered by test_extraction_run_repository).
        service._runs.rollback_and_fail.assert_awaited_once_with(
            run.id,
            "pdf fetch failed",
            logger=ANY,
            trace_id=service.trace_id,
            log_prefix="section_extraction",
        )


# ---------------------------------------------------------------------------
# extract_section — LLM failure on the standalone path (legacy semantics)
# ---------------------------------------------------------------------------


class TestExtractSectionLlmFailure:
    """Standalone extract_section path: an LLM failure still calls
    rollback_and_fail (legacy parity — the standalone run owns its own
    transaction and there are no sibling sections to protect)."""

    @staticmethod
    def _wire_pipeline(service, mock_storage):
        mock_file = MagicMock()
        mock_file.storage_key = "test.pdf"
        service._article_files.get_latest_pdf = AsyncMock(return_value=mock_file)
        mock_storage.download = AsyncMock(return_value=b"%PDF-1.4 test")
        service._assemble_prompt_text = AsyncMock(return_value="text")

        mock_field = MagicMock()
        mock_field.name = "field_1"
        mock_field.field_type = "string"
        mock_field.description = "f"
        mock_field.is_required = True
        mock_entity = MagicMock()
        mock_entity.id = uuid4()
        mock_entity.name = "EntityX"
        mock_entity.description = "d"
        mock_entity.fields = [mock_field]
        service._entity_types.get_with_fields = AsyncMock(return_value=mock_entity)

        run = MagicMock()
        run.id = uuid4()
        # Standalone path resolves through the one-live-run gate; created=True
        # keeps the standalone lifecycle semantics.
        service._lifecycle.resolve_or_create_extract_run = AsyncMock(return_value=(run, True))
        service._runs.start_run = AsyncMock()
        service._runs.complete_run = AsyncMock()
        service._runs.fail_run = AsyncMock()
        service._runs.rollback_and_fail = AsyncMock()
        return run

    @pytest.mark.asyncio
    async def test_standalone_llm_failure_calls_rollback_and_fail(self, service, mock_storage):
        from pydantic_ai import UnexpectedModelBehavior

        run = self._wire_pipeline(service, mock_storage)
        service._assemble_prompt_text = AsyncMock(return_value="article text")

        service._extract_with_llm = AsyncMock(
            side_effect=UnexpectedModelBehavior("reask exhausted")
        )

        with pytest.raises(UnexpectedModelBehavior):
            await service.extract_section(
                project_id=uuid4(),
                article_id=uuid4(),
                template_id=uuid4(),
                entity_type_id=uuid4(),
            )

        # Standalone path: rollback_and_fail is the single handler for ALL
        # exceptions (legacy semantics — this run owns its own transaction).
        service._runs.rollback_and_fail.assert_awaited_once_with(
            run.id,
            "reask exhausted",
            logger=ANY,
            trace_id=service.trace_id,
            log_prefix="section_extraction",
        )


# ---------------------------------------------------------------------------
# extract_all_sections
# ---------------------------------------------------------------------------


class TestExtractAllSections:
    def _make_run(self):
        run = MagicMock()
        run.id = uuid4()
        return run

    def _minimal_lifecycle_wire(self, service, run):
        # Standalone path resolves through the one-live-run gate; created=True
        # keeps the standalone lifecycle semantics.
        service._lifecycle.resolve_or_create_extract_run = AsyncMock(return_value=(run, True))
        service._runs.start_run = AsyncMock()
        service._runs.complete_run = AsyncMock()
        service._runs.fail_run = AsyncMock()
        # Batch tests exercise the flow, not assembly: stub the prompt-text source
        # (the elif path also calls it for its stash side-effect when pdf_text is
        # supplied). Tests that assert on it re-assign their own mock below.
        service._assemble_prompt_text = AsyncMock(return_value="article text")

    @pytest.mark.asyncio
    async def test_batch_with_no_child_sections(self, service):
        run = self._make_run()
        self._minimal_lifecycle_wire(service, run)

        service._instances.get_by_id = AsyncMock(return_value=None)

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
        service._assemble_prompt_text = AsyncMock(return_value="pdf text")

        await service.extract_all_sections(
            project_id=uuid4(),
            article_id=uuid4(),
            template_id=uuid4(),
            parent_instance_id=uuid4(),
            # No pdf_text provided → _assemble_prompt_text is invoked
        )

        service._assemble_prompt_text.assert_awaited()

    @pytest.mark.asyncio
    async def test_batch_with_supplied_pdf_text_still_populates_anchor_stash(self, service):
        """When a caller supplies pdf_text (the assembly fast-path is skipped), the
        run anchor stash must STILL be populated so _create_suggestions can ground
        evidence — otherwise evidence silently gets position={} despite blocks
        existing. Regression guard for the build_prompt_input wiring."""
        run = self._make_run()
        self._minimal_lifecycle_wire(service, run)

        service._instances.get_by_id = AsyncMock(return_value=None)
        service._assemble_prompt_text = AsyncMock(return_value="ignored")
        assert service._run_anchor_blocks == []  # empty stash at the start of the run

        await service.extract_all_sections(
            project_id=uuid4(),
            article_id=uuid4(),
            template_id=uuid4(),
            parent_instance_id=uuid4(),
            pdf_text="caller-supplied precomputed text",
        )

        # The elif branch invokes _assemble_prompt_text for its stash side-effect.
        service._assemble_prompt_text.assert_awaited()

    @pytest.mark.asyncio
    async def test_batch_collects_failed_sections(self, service):
        run = self._make_run()
        self._minimal_lifecycle_wire(service, run)

        parent = MagicMock()
        parent.entity_type_id = uuid4()
        service._instances.get_by_id = AsyncMock(return_value=parent)

        child_ok = MagicMock()
        child_ok.id = uuid4()
        child_ok.name = "Section OK"
        child_ok.label = "Section OK"
        child_ok.parent_entity_type_id = parent.entity_type_id
        child_bad = MagicMock()
        child_bad.id = uuid4()
        child_bad.name = "Section A"
        child_bad.label = "Section A"
        child_bad.parent_entity_type_id = parent.entity_type_id
        # B-2: children come from the run-pinned tree seam.
        service._pinned_entity_types = AsyncMock(return_value=[child_ok, child_bad])

        # First section succeeds, second raises — a partial-failure batch
        # completes (the all-failed guard does not fire) and records the failure.
        service._extract_section_with_memory = AsyncMock(
            side_effect=[
                {"suggestions_created": 1, "tokens_total": 10, "summary": "ok"},
                RuntimeError("llm error"),
            ]
        )

        result = await service.extract_all_sections(
            project_id=uuid4(),
            article_id=uuid4(),
            template_id=uuid4(),
            parent_instance_id=uuid4(),
            pdf_text="text",
        )

        assert result.successful_sections == 1
        assert result.failed_sections == 1
        failed_entry = next(s for s in result.sections if s["success"] is False)
        assert failed_entry["entity_type_name"] == "Section A"

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
        child1.parent_entity_type_id = parent.entity_type_id

        # B-2: children come from the run-pinned tree seam.
        service._pinned_entity_types = AsyncMock(return_value=[child1])
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
        # Standalone path resolves through the one-live-run gate; created=True
        # keeps the standalone lifecycle semantics.
        service._lifecycle.resolve_or_create_extract_run = AsyncMock(return_value=(run, True))
        service._runs.start_run = AsyncMock()
        service._runs.rollback_and_fail = AsyncMock()
        service._assemble_prompt_text = AsyncMock(return_value="text")

        # Make the instance fetch explode unexpectedly (after assembly, before loops)
        service._instances.get_by_id = AsyncMock(side_effect=RuntimeError("db exploded"))

        with pytest.raises(RuntimeError, match="db exploded"):
            await service.extract_all_sections(
                project_id=uuid4(),
                article_id=uuid4(),
                template_id=uuid4(),
                parent_instance_id=uuid4(),
                pdf_text="text",
            )

        service._runs.rollback_and_fail.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_mid_batch_llm_failure_does_not_roll_back_batch_transaction(self, service):
        """An LLM-layer exception in _extract_section_with_memory must call
        fail_run (session healthy) — NOT rollback_and_fail — so sibling
        sections' uncommitted writes and the parent batch run are preserved."""
        from pydantic_ai import UnexpectedModelBehavior

        batch_run = self._make_run()
        self._minimal_lifecycle_wire(service, batch_run)

        # Wire rollback_and_fail too so we can assert it was never touched.
        service._runs.rollback_and_fail = AsyncMock()

        parent = MagicMock()
        parent.entity_type_id = uuid4()
        service._instances.get_by_id = AsyncMock(return_value=parent)

        child1 = MagicMock()
        child1.id = uuid4()
        child1.name = "Section A"
        child1.label = "Section A"
        child1.parent_entity_type_id = parent.entity_type_id

        child2 = MagicMock()
        child2.id = uuid4()
        child2.name = "Section B"
        child2.label = "Section B"
        child2.parent_entity_type_id = parent.entity_type_id

        child3 = MagicMock()
        child3.id = uuid4()
        child3.name = "Section C"
        child3.label = "Section C"
        child3.parent_entity_type_id = parent.entity_type_id

        # B-2: children come from the run-pinned tree seam.
        service._pinned_entity_types = AsyncMock(return_value=[child1, child2, child3])

        # Wire _extract_section_with_memory: section 2 (child2) raises LLM error;
        # sections 1 and 3 succeed. Sections share THE batch run (no per-section
        # runs since the one-live-run invariant), so the parent loop simply
        # counts the failure; we check that at the batch level rollback_and_fail
        # is never called.
        call_count = 0

        async def _fake_extract_with_memory(**kwargs):  # noqa: ARG001
            nonlocal call_count
            call_count += 1
            if call_count == 2:
                raise UnexpectedModelBehavior("reask budget exhausted")
            return {"suggestions_created": 1, "tokens_total": 50, "summary": "ok"}

        service._extract_section_with_memory = AsyncMock(side_effect=_fake_extract_with_memory)

        result = await service.extract_all_sections(
            project_id=uuid4(),
            article_id=uuid4(),
            template_id=uuid4(),
            parent_instance_id=uuid4(),
            pdf_text="text",
        )

        # Batch completes — 2 successes, 1 failure.
        assert result.failed_sections == 1
        assert result.successful_sections == 2

        # Batch-level complete_run must be called (parent run row survives).
        service._runs.complete_run.assert_awaited()

        # rollback_and_fail must NOT have been called at the batch level —
        # the LLM exception leaves the session healthy.
        service._runs.rollback_and_fail.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_section_llm_failure_fails_only_the_batch_run(self, service):
        """Drive the REAL _extract_section_with_memory with the LLM seam
        raising. Sections no longer own runs (one-live-run invariant): the
        exception propagates to the batch loop, and when it was the only
        section the batch is all-failed — BatchAllSectionsFailed, with the
        BATCH run rolled back + failed. No per-section run is ever created
        or failed."""
        from pydantic_ai import UnexpectedModelBehavior

        from app.services.section_extraction_service import BatchAllSectionsFailed

        batch_run = self._make_run()
        service._lifecycle.resolve_or_create_extract_run = AsyncMock(return_value=(batch_run, True))
        service._lifecycle.create_run = AsyncMock()
        service._runs.start_run = AsyncMock()
        service._runs.complete_run = AsyncMock()
        service._runs.fail_run = AsyncMock()
        service._runs.rollback_and_fail = AsyncMock()
        service._assemble_prompt_text = AsyncMock(return_value="text")

        parent = MagicMock()
        parent.entity_type_id = uuid4()
        service._instances.get_by_id = AsyncMock(return_value=parent)

        child = MagicMock()
        child.id = uuid4()
        child.name = "Section A"
        child.label = "Section A"
        child.parent_entity_type_id = parent.entity_type_id
        # B-2: children come from the run-pinned tree seam.
        service._pinned_entity_types = AsyncMock(return_value=[child])

        service._extract_with_llm = AsyncMock(
            side_effect=UnexpectedModelBehavior("reask budget exhausted")
        )

        with pytest.raises(BatchAllSectionsFailed):
            await service.extract_all_sections(
                project_id=uuid4(),
                article_id=uuid4(),
                template_id=uuid4(),
                parent_instance_id=uuid4(),
                pdf_text="text",
            )

        # ONE run total: the batch run, resolved through the gate — the old
        # one-run-per-section create is gone.
        service._lifecycle.create_run.assert_not_called()
        service._runs.fail_run.assert_not_awaited()
        # The batch guard failed THE batch run with the all-failed summary
        # (the per-section LLM error lives in section_results / the logs).
        service._runs.rollback_and_fail.assert_awaited_once()
        assert service._runs.rollback_and_fail.await_args.args[0] == batch_run.id
        assert "All 1 section(s) failed" in service._runs.rollback_and_fail.await_args.args[1]


# ---------------------------------------------------------------------------
# extract_for_run — entity error path
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
        run.stage = ExtractionRunStage.EXTRACT.value
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
        service._assemble_prompt_text = AsyncMock(return_value="article text")

        good_et = MagicMock()
        good_et.id = uuid4()
        good_et.name = "GoodSection"
        good_et.parent_entity_type_id = None
        bad_et = MagicMock()
        bad_et.id = uuid4()
        bad_et.name = "BadSection"
        bad_et.parent_entity_type_id = None

        # B-2: the top-level set comes from the run-pinned tree seam;
        # db.execute serves the pinned general-instruction fetch.
        service._pinned_entity_types = AsyncMock(return_value=[good_et, bad_et])
        execute_result = MagicMock()
        execute_result.scalar_one_or_none.return_value = None
        service.db.execute = AsyncMock(return_value=execute_result)

        # One entity succeeds, one raises — a partial-failure batch completes
        # (the all-failed guard does not fire) and records the failed entity.
        service._extract_one_entity_type_for_run = AsyncMock(
            side_effect=[
                {"suggestions_created": 1, "tokens_total": 10},
                RuntimeError("type fetch error"),
            ]
        )

        service._runs.start_run = AsyncMock()
        service._runs.complete_run = AsyncMock()
        service._runs.fail_run = AsyncMock()
        service._lifecycle.advance_stage = AsyncMock()

        result = await service.extract_for_run(run_id=run.id)

        assert result.successful_sections == 1
        assert result.failed_sections == 1
        failed_entry = next(s for s in result.sections if s["success"] is False)
        assert "type fetch error" in failed_entry["error"]


# ---------------------------------------------------------------------------
# _extract_with_llm — wiring into the typed call layer (app.llm)
# ---------------------------------------------------------------------------


class TestExtractWithLlmWiring:
    """The service-level _extract_with_llm: prompt selection, chunk merge,
    usage accumulation — through the real schema builder, no network."""

    @staticmethod
    def _entity_type(n_fields=1):
        from types import SimpleNamespace

        fields = [
            SimpleNamespace(
                name=f"field_{i}",
                field_type="text",
                llm_description="d",
                description=None,
                allowed_values=None,
                is_required=False,
            )
            for i in range(n_fields)
        ]
        return SimpleNamespace(name="population", description="who", fields=fields)

    async def test_no_fields_skips_llm_entirely(self, service):
        with patch("app.services.section_extraction_service.extract_structured") as mock_x:
            data, usage = await service._extract_with_llm(
                pdf_text="text", entity_type=self._entity_type(0)
            )
        assert data == {}
        assert usage.total_tokens == 0
        mock_x.assert_not_called()

    async def test_single_chunk_success_returns_data_and_usage(self, service):
        from app.llm.schema import build_output_models

        entity_type = self._entity_type(2)
        [model_cls] = build_output_models(entity_type)
        output = model_cls.model_validate(
            {
                "field_0": {
                    "value": "150",
                    "confidence": 0.9,
                    "reasoning": None,
                    "evidence": [],
                    "status": "found",
                },
                "field_1": {
                    "value": "RCT",
                    "confidence": 0.8,
                    "reasoning": None,
                    "evidence": [],
                    "status": "found",
                },
            }
        )
        mock_x = AsyncMock(return_value=(output, LlmUsage(prompt_tokens=100, completion_tokens=50)))
        with (
            patch("app.services.section_extraction_service.extract_structured", mock_x),
            patch("app.services.section_extraction_service.build_model", MagicMock()),
        ):
            extracted, usage = await service._extract_with_llm(
                pdf_text="Sample text from PDF...",
                entity_type=entity_type,
            )
        assert extracted["field_0"]["value"] == "150"
        assert extracted["field_1"]["value"] == "RCT"
        assert usage.total_tokens == 150
        mock_x.assert_awaited_once()

    async def test_chunked_template_merges_results_and_usage(self, service):
        from app.llm.schema import build_output_models

        entity_type = self._entity_type(30)  # > 14 fields → 2+ chunks
        chunk_models = build_output_models(entity_type)
        assert len(chunk_models) >= 2

        def _payload(model_cls):
            return model_cls.model_validate(
                {
                    info.alias: {
                        "value": "v",
                        "confidence": 0.5,
                        "reasoning": None,
                        "evidence": [],
                        "status": "found",
                    }
                    for info in model_cls.model_fields.values()
                }
            )

        outputs = [
            (_payload(m), LlmUsage(prompt_tokens=10, completion_tokens=5)) for m in chunk_models
        ]
        with (
            patch(
                "app.services.section_extraction_service.extract_structured",
                AsyncMock(side_effect=outputs),
            ),
            patch("app.services.section_extraction_service.build_model", MagicMock()),
        ):
            data, usage = await service._extract_with_llm(pdf_text="text", entity_type=entity_type)
        assert len(data) == 30
        assert usage.prompt_tokens == 10 * len(chunk_models)

    async def test_extraction_kind_selects_extraction_prompt(self, service):
        from app.llm.prompts import section_extraction
        from app.llm.schema import build_output_models

        entity_type = self._entity_type(1)
        [model_cls] = build_output_models(entity_type)
        output = model_cls.model_validate(
            {
                "field_0": {
                    "value": "v",
                    "confidence": 0.5,
                    "reasoning": None,
                    "evidence": [],
                    "status": "found",
                }
            }
        )
        mock_x = AsyncMock(return_value=(output, LlmUsage(prompt_tokens=1, completion_tokens=1)))
        with (
            patch("app.services.section_extraction_service.extract_structured", mock_x),
            patch("app.services.section_extraction_service.build_model", MagicMock()),
        ):
            await service._extract_with_llm(
                pdf_text="text",
                entity_type=entity_type,
                kind="extraction",
                framework=None,
            )
        kwargs = mock_x.call_args.kwargs
        assert kwargs["prompt_name"] == section_extraction.NAME
        assert "extracting structured data" in kwargs["system_prompt"]
        assert "Section: population" in kwargs["user_prompt"]
        assert "PROBAST" not in kwargs["system_prompt"]
        assert "PROBAST" not in kwargs["user_prompt"]

    async def test_quality_assessment_kind_selects_qa_prompt(self, service):
        from app.llm.prompts import quality_assessment
        from app.llm.schema import build_output_models

        entity_type = self._entity_type(1)
        [model_cls] = build_output_models(entity_type)
        output = model_cls.model_validate(
            {
                "field_0": {
                    "value": "Low",
                    "confidence": 0.5,
                    "reasoning": None,
                    "evidence": [],
                    "status": "found",
                }
            }
        )
        mock_x = AsyncMock(return_value=(output, LlmUsage(prompt_tokens=1, completion_tokens=1)))
        with (
            patch("app.services.section_extraction_service.extract_structured", mock_x),
            patch("app.services.section_extraction_service.build_model", MagicMock()),
        ):
            await service._extract_with_llm(
                pdf_text="text",
                entity_type=entity_type,
                kind="quality_assessment",
                framework="PROBAST",
            )
        kwargs = mock_x.call_args.kwargs
        assert kwargs["prompt_name"] == quality_assessment.NAME
        assert "PROBAST" in kwargs["system_prompt"]
        assert "PROBAST" in kwargs["user_prompt"]

    async def test_extract_with_llm_builds_marker_composition(self, service):
        from app.llm.schema import build_output_models
        from app.services.section_extraction_service import ARTICLE_MARKDOWN_MARKER

        entity_type = self._entity_type(2)
        [model_cls] = [build_output_models(entity_type)[0]]
        output = model_cls.model_validate(
            {
                info.alias: {
                    "value": "v",
                    "confidence": 0.5,
                    "reasoning": None,
                    "evidence": [],
                    "status": "found",
                }
                for info in model_cls.model_fields.values()
            }
        )
        mock_x = AsyncMock(return_value=(output, LlmUsage(prompt_tokens=7, completion_tokens=3)))
        # Assembly info the composition should reflect (source file + no truncation).
        service._prompt_input_info = PromptInputInfo(
            anchor_blocks=[],
            anchor_file_id=uuid4(),
            file_name="teste3.pdf",
            truncated=False,
            est_tokens=1234,
        )
        with (
            patch("app.services.section_extraction_service.extract_structured", mock_x),
            patch("app.services.section_extraction_service.build_model", MagicMock()),
        ):
            data, usage = await service._extract_with_llm(
                pdf_text="ARTICLE BODY", entity_type=entity_type
            )
        # The glue builds the snapshot post-verify (fast mode → pure no-op).
        await service._maybe_verify(uuid4(), uuid4(), "extraction", "ARTICLE BODY", data, usage)

        comp = service._run_provenance["prompt_composition"]
        # The article is replaced by a marker in the persisted instruction, and
        # the real body is NOT stored per section.
        assert ARTICLE_MARKDOWN_MARKER in comp["section_instruction"]
        assert "ARTICLE BODY" not in comp["section_instruction"]
        assert comp["section_name"] == "population"
        assert comp["fields_requested"] == ["field_0", "field_1"]
        assert comp["llm_calls"] == 1
        assert comp["article_ref"]["file_name"] == "teste3.pdf"
        assert comp["article_ref"]["truncated"] is False
        assert comp["article_ref"]["est_tokens"] == 1234
        # The section snapshot also carries this section's token usage.
        assert service._run_provenance["tokens"] == {"prompt": 7, "completion": 3, "total": 10}

    async def test_quality_assessment_composition_uses_qa_template(self, service):
        from app.llm.schema import build_output_models
        from app.services.section_extraction_service import ARTICLE_MARKDOWN_MARKER

        entity_type = self._entity_type(1)
        [model_cls] = build_output_models(entity_type)
        output = model_cls.model_validate(
            {
                "field_0": {
                    "value": "Low",
                    "confidence": 0.5,
                    "reasoning": None,
                    "evidence": [],
                    "status": "found",
                }
            }
        )
        mock_x = AsyncMock(return_value=(output, LlmUsage(prompt_tokens=1, completion_tokens=1)))
        with (
            patch("app.services.section_extraction_service.extract_structured", mock_x),
            patch("app.services.section_extraction_service.build_model", MagicMock()),
        ):
            data, usage = await service._extract_with_llm(
                pdf_text="text",
                entity_type=entity_type,
                kind="quality_assessment",
                framework="PROBAST",
            )
        # The glue builds the snapshot post-verify (fast mode → pure no-op).
        await service._maybe_verify(uuid4(), uuid4(), "quality_assessment", "text", data, usage)
        comp = service._run_provenance["prompt_composition"]
        # QA composition uses the QA template (framework rendered) + the marker.
        assert "PROBAST" in comp["section_instruction"]
        assert ARTICLE_MARKDOWN_MARKER in comp["section_instruction"]

    @pytest.mark.asyncio
    async def test_llm_failure_propagates_instead_of_empty_dict(self, service):
        from pydantic_ai import UnexpectedModelBehavior

        with (
            patch(
                "app.services.section_extraction_service.extract_structured",
                AsyncMock(side_effect=UnexpectedModelBehavior("reask budget exhausted")),
            ),
            patch("app.services.section_extraction_service.build_model", MagicMock()),
            pytest.raises(UnexpectedModelBehavior),
        ):
            await service._extract_with_llm(pdf_text="text", entity_type=self._entity_type(1))

    async def test_memory_context_included_in_user_prompt(self, service):
        from app.llm.schema import build_output_models

        entity_type = self._entity_type(1)
        [model_cls] = build_output_models(entity_type)
        output = model_cls.model_validate(
            {
                "field_0": {
                    "value": "v",
                    "confidence": 0.5,
                    "reasoning": None,
                    "evidence": [],
                    "status": "found",
                }
            }
        )
        mock_x = AsyncMock(return_value=(output, LlmUsage(prompt_tokens=1, completion_tokens=1)))
        with (
            patch("app.services.section_extraction_service.extract_structured", mock_x),
            patch("app.services.section_extraction_service.build_model", MagicMock()),
        ):
            await service._extract_with_llm(
                pdf_text="article text",
                entity_type=entity_type,
                memory_context=[
                    {"entity_type_name": "Participants", "summary": "N=100 patients"},
                ],
            )
        user_prompt = mock_x.call_args.kwargs["user_prompt"]
        assert "CONTEXT FROM PREVIOUSLY EXTRACTED SECTIONS" in user_prompt
        assert "Participants" in user_prompt
        assert "N=100 patients" in user_prompt


# ---------------------------------------------------------------------------
# build_prompt_input call-site wiring — _assemble_prompt_text
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_build_prompt_input_called_with_correct_kwargs(mock_db, mock_storage):
    """_assemble_prompt_text passes storage/user_id/trace_id from the service
    to build_prompt_input. Bypasses _wire_pipeline so the real method runs."""
    mock_bpi = AsyncMock(
        return_value=(
            "md",
            PromptInputInfo(
                anchor_blocks=[], anchor_file_id=None, file_name=None, truncated=False, est_tokens=1
            ),
        )
    )
    with (
        patch("app.services.section_extraction_service.ArticleFileRepository"),
        patch("app.services.section_extraction_service.ExtractionEntityTypeRepository"),
        patch("app.services.section_extraction_service.ExtractionInstanceRepository"),
        patch("app.services.section_extraction_service.ExtractionProposalService"),
        patch("app.services.section_extraction_service.ExtractionRunRepository"),
        patch("app.services.section_extraction_service.RunLifecycleService"),
        patch("app.services.section_extraction_service.build_prompt_input", mock_bpi),
    ):
        svc = SectionExtractionService(
            db=mock_db,
            user_id="bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
            storage=mock_storage,
            trace_id="trace-section-wiring",
        )
        await svc._assemble_prompt_text(uuid4(), "gpt-4o-mini")

    mock_bpi.assert_awaited_once()
    kwargs = mock_bpi.await_args.kwargs
    assert kwargs["user_id"] == "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
    assert kwargs["trace_id"] == "trace-section-wiring"
    assert kwargs["storage"] is mock_storage


class TestLlmExclusion:
    """§3 (spec 2026-08-22): assessor-owned coordinates — every derived-spec
    entry's target/rationale/summary — never reach the model. The filter
    lives inside ``_extract_with_llm``, the one seam every extraction path
    funnels through, INCLUDING the re-pin fallback that carries
    ``fields_override=None`` (the path a helper-level filter would miss)."""

    @staticmethod
    def _fields(*names: str) -> list:
        out = []
        for n in names:
            f = MagicMock()
            f.id = uuid4()
            f.name = n
            out.append(f)
        return out

    @staticmethod
    def _entity(name: str, fields: list):
        et = MagicMock()
        et.id = uuid4()
        et.name = name
        et.description = "desc"
        et.fields = fields
        return et

    @pytest.mark.asyncio
    async def test_exclusion_filters_exactly_the_assessor_owned_fields(self, service):
        """Anti-over-exclusion control: the mixed v2 section keeps its
        describes, SQs, applicability AND applicability rationale — only the
        spec-named judgment + judgment rationale drop."""
        fields = self._fields(
            "desc_data_sources",
            "q1_appropriate_data_sources",
            "q2_appropriate_study_design",
            "applicability_concerns",
            "applicability_concerns_rationale",
            "quality_concern",
            "quality_concern_rationale",
        )
        et = self._entity("dev_d1_participants", fields)
        excluded = {
            ("dev_d1_participants", "quality_concern"),
            ("dev_d1_participants", "quality_concern_rationale"),
            ("overall_judgement", "summary_quality_development"),
        }
        with patch(
            "app.services.section_extraction_service.build_output_models", return_value=[]
        ) as bom:
            await service._extract_with_llm(
                pdf_text="text",
                entity_type=et,
                fields_override=list(fields),
                excluded_coordinates=excluded,
            )
        sent = [f.name for f in bom.call_args.kwargs["fields"]]
        assert sent == [
            "desc_data_sources",
            "q1_appropriate_data_sources",
            "q2_appropriate_study_design",
            "applicability_concerns",
            "applicability_concerns_rationale",
        ]

    @pytest.mark.asyncio
    async def test_all_excluded_section_skips_the_llm_call(self, service):
        """overall_judgement: every field is a summary -> no call at all."""
        fields = self._fields("summary_quality_development", "summary_rob_evaluation")
        et = self._entity("overall_judgement", fields)
        excluded = {
            ("overall_judgement", "summary_quality_development"),
            ("overall_judgement", "summary_rob_evaluation"),
        }
        with patch(
            "app.services.section_extraction_service.build_output_models", return_value=[]
        ) as bom:
            extracted, usage = await service._extract_with_llm(
                pdf_text="text",
                entity_type=et,
                fields_override=list(fields),
                excluded_coordinates=excluded,
            )
        assert bom.call_args.kwargs["fields"] == []
        assert extracted == {}
        assert usage.prompt_tokens == 0

    @pytest.mark.asyncio
    async def test_fallback_path_without_override_is_still_filtered(self, service):
        """The re-pin race hands _extract_with_llm fields_override=None and the
        LIVE entity type — the leak a call-site filter cannot cover."""
        fields = self._fields("q1", "risk_of_bias", "risk_of_bias_rationale")
        et = self._entity("eval_d4_judgment", fields)
        excluded = {
            ("eval_d4_judgment", "risk_of_bias"),
            ("eval_d4_judgment", "risk_of_bias_rationale"),
        }
        with patch(
            "app.services.section_extraction_service.build_output_models", return_value=[]
        ) as bom:
            await service._extract_with_llm(
                pdf_text="text",
                entity_type=et,
                fields_override=None,
                excluded_coordinates=excluded,
            )
        sent = [f.name for f in bom.call_args.kwargs["fields"]]
        assert sent == ["q1"]

    @pytest.mark.asyncio
    async def test_spec_less_template_passes_the_field_list_through_untouched(self, service):
        """Modularity guard (§3): no spec -> the exact same list object reaches
        build_output_models, so extraction templates are byte-identical."""
        fields = self._fields("a", "b")
        et = self._entity("any_section", fields)
        override = list(fields)
        with patch(
            "app.services.section_extraction_service.build_output_models", return_value=[]
        ) as bom:
            await service._extract_with_llm(
                pdf_text="text",
                entity_type=et,
                fields_override=override,
                excluded_coordinates=set(),
            )
        assert bom.call_args.kwargs["fields"] is override

    @pytest.mark.asyncio
    async def test_dangling_exclusion_coordinate_warns_and_fails_open(self, service):
        """A live rename that orphans an exclusion must never be silent: it
        would quietly re-open an assessor-owned field to the model (§9)."""
        fields = self._fields("q1", "quality_score")  # renamed live
        et = self._entity("dev_d1_participants", fields)
        excluded = {("dev_d1_participants", "quality_concern")}  # stale spec name
        mock_logger = MagicMock()
        with (
            patch.object(SectionExtractionService, "logger", mock_logger),
            patch(
                "app.services.section_extraction_service.build_output_models", return_value=[]
            ) as bom,
        ):
            await service._extract_with_llm(
                pdf_text="text",
                entity_type=et,
                fields_override=list(fields),
                excluded_coordinates=excluded,
            )
        sent = [f.name for f in bom.call_args.kwargs["fields"]]
        assert sent == ["q1", "quality_score"]  # fails open...
        warned = [
            c
            for c in mock_logger.warning.call_args_list
            if c.args[:1] == ("qa_derived_spec_dangling_ref",)
        ]
        assert warned, "expected a qa_derived_spec_dangling_ref warning on the extraction path"
        assert warned[0].kwargs["coordinates"] == [("dev_d1_participants", "quality_concern")]


def test_no_qa_kind_branch_in_the_extraction_path():
    """§3 modularity invariant: the exclusion filter is template-data-driven —
    nothing in this module branches on the QA kind. Docstrings and comments
    are stripped; the canonical enum spelling and the negated forms are all
    banned (a lowercase-literal-only grep would miss
    ``TemplateKind.QUALITY_ASSESSMENT.value`` and ``kind != "extraction"``)."""
    import re

    import app.services.section_extraction_service as mod

    source = Path(mod.__file__).read_text()
    source = re.sub(r'("""|\'\'\')(?s:.*?)\1', "", source)
    source = "\n".join(line.split("#", 1)[0] for line in source.splitlines())
    low = source.lower()
    assert "quality_assessment" not in low
    assert 'kind != "extraction"' not in low
    assert "kind not in" not in low
    # The natural enum spellings evade the literal greps above — comparing
    # against TemplateKind.EXTRACTION (or importing the enum at all) is the
    # same forbidden branch wearing different clothes. The module handles
    # ``kind`` as an opaque pass-through string only.
    assert "templatekind" not in low
    assert 'kind == "extraction"' not in low


class TestLlmExclusionWiring:
    """The template→exclusion WIRING, not just the filter: a run whose
    project template declares a v2-shaped derived spec must have its
    assessor-owned fields subtracted on the REAL call path
    (run.template_id → _excluded_field_names → _extract_with_llm), with only
    the model-facing leaf mocked. The TestLlmExclusion suite passes
    excluded_coordinates by hand and proves the filter; this proves the
    plumbing that feeds it (adversarial-review finding: the suite alone
    would stay green if no call site threaded the template at all)."""

    @pytest.mark.asyncio
    async def test_run_path_threads_the_template_spec_into_the_filter(self, service):
        from app.models.extraction import ExtractionRunStage

        run = MagicMock()
        run.id = uuid4()
        run.project_id = uuid4()
        run.article_id = uuid4()
        run.template_id = uuid4()
        run.stage = ExtractionRunStage.EXTRACT.value
        run.kind = "extraction"
        run.version_id = uuid4()

        q1 = MagicMock()
        q1.id = uuid4()
        q1.name = "q1_appropriate_data_sources"
        judgment = MagicMock()
        judgment.id = uuid4()
        judgment.name = "quality_concern"
        rationale = MagicMock()
        rationale.id = uuid4()
        rationale.name = "quality_concern_rationale"

        entity = MagicMock()
        entity.id = uuid4()
        entity.name = "dev_d1_participants"
        entity.description = "desc"
        entity.fields = [q1, judgment, rationale]

        template = MagicMock()
        template.schema_ = {
            "derived_judgments": [
                {
                    "id": "dev_d1_quality",
                    "label": "Development D1: quality",
                    "rule": "signaling_worst",
                    "target": {
                        "section": "dev_d1_participants",
                        "field": "quality_concern",
                    },
                    "rationale": {
                        "section": "dev_d1_participants",
                        "field": "quality_concern_rationale",
                    },
                    "inputs": [
                        {
                            "section": "dev_d1_participants",
                            "field": "q1_appropriate_data_sources",
                        }
                    ],
                }
            ]
        }

        # Real _excluded_field_names reads the template off the session.
        service.db.get = AsyncMock(return_value=template)
        # Live-intersection + instance probes use the harness mocks.
        service._entity_types.get_with_fields = AsyncMock(return_value=entity)
        service._instances.get_by_article = AsyncMock(
            return_value=[MagicMock(id=uuid4(), parent_instance_id=None)]
        )
        service._create_suggestions = AsyncMock(return_value=0)
        service._maybe_verify = AsyncMock(side_effect=lambda *_a, **_k: (None, LlmUsage()))

        with patch(
            "app.services.section_extraction_service.build_output_models",
            return_value=[],
        ) as bom:
            await service._extract_one_entity_type_for_run(
                run=run,
                entity_type=entity,
                pdf_text="text",
                framework=None,
                kind="extraction",
                skip_fields_with_human_proposals=False,
            )

        sent = [f.name for f in bom.call_args.kwargs["fields"]]
        assert sent == ["q1_appropriate_data_sources"]
