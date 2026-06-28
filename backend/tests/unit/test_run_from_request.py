"""Unit tests for SectionExtractionService.run_from_request.

Verifies that the 3-branch dispatch routes to the correct underlying
method with the correct kwargs for a given SectionExtractionRequest, and
that the result is returned unchanged.  No DB or LLM calls — each branch
method is AsyncMock-patched on the service instance.
"""

from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.infrastructure.storage import StorageAdapter
from app.schemas.extraction import SectionExtractionRequest
from app.services.section_extraction_service import (
    BatchExtractionResult,
    SectionExtractionResult,
    SectionExtractionService,
)


@pytest.fixture()
def service():
    """Minimal SectionExtractionService with all repositories mocked out."""
    db = AsyncMock(spec=AsyncSession)
    storage = MagicMock(spec=StorageAdapter)
    with (
        __import__("unittest.mock", fromlist=["patch"]).patch(
            "app.services.section_extraction_service.ArticleFileRepository"
        ),
        __import__("unittest.mock", fromlist=["patch"]).patch(
            "app.services.section_extraction_service.ExtractionEntityTypeRepository"
        ),
        __import__("unittest.mock", fromlist=["patch"]).patch(
            "app.services.section_extraction_service.ExtractionInstanceRepository"
        ),
        __import__("unittest.mock", fromlist=["patch"]).patch(
            "app.services.section_extraction_service.ExtractionProposalService"
        ),
        __import__("unittest.mock", fromlist=["patch"]).patch(
            "app.services.section_extraction_service.ExtractionRunRepository"
        ),
        __import__("unittest.mock", fromlist=["patch"]).patch(
            "app.services.section_extraction_service.RunLifecycleService"
        ),
    ):
        svc = SectionExtractionService(
            db=db,
            user_id="00000000-0000-0000-0000-000000000001",
            storage=storage,
            trace_id="test-trace",
        )
    return svc


def _make_single_result(run_id: str, entity_type_id: str) -> SectionExtractionResult:
    return SectionExtractionResult(
        extraction_run_id=run_id,
        entity_type_id=entity_type_id,
        suggestions_created=3,
        tokens_prompt=100,
        tokens_completion=50,
        tokens_total=150,
        duration_ms=200.0,
    )


def _make_batch_result(run_id: str) -> BatchExtractionResult:
    return BatchExtractionResult(
        extraction_run_id=run_id,
        total_sections=2,
        successful_sections=2,
        failed_sections=0,
        total_suggestions_created=6,
        total_tokens_used=300,
        duration_ms=400.0,
        sections=[],
    )


# ---------------------------------------------------------------------------
# Branch 1: entity_type_id present → extract_section
# ---------------------------------------------------------------------------


class TestRunFromRequestSingleSection:
    @pytest.mark.asyncio
    async def test_routes_to_extract_section_when_entity_type_id_set(self, service):
        project_id = uuid4()
        article_id = uuid4()
        template_id = uuid4()
        entity_type_id = uuid4()
        run_id = uuid4()
        expected = _make_single_result(str(run_id), str(entity_type_id))

        service.extract_section = AsyncMock(return_value=expected)
        service.extract_for_run = AsyncMock(
            side_effect=AssertionError("extract_for_run must NOT be called")
        )
        service.extract_all_sections = AsyncMock(
            side_effect=AssertionError("extract_all_sections must NOT be called")
        )

        payload = SectionExtractionRequest(
            projectId=str(project_id),
            articleId=str(article_id),
            templateId=str(template_id),
            entityTypeId=str(entity_type_id),
        )
        result = await service.run_from_request(payload)

        assert result is expected
        service.extract_section.assert_awaited_once_with(
            project_id=project_id,
            article_id=article_id,
            template_id=template_id,
            entity_type_id=entity_type_id,
            parent_instance_id=None,
            model=payload.model,
            run_id=None,
        )

    @pytest.mark.asyncio
    async def test_passes_run_id_and_parent_instance_id_to_extract_section(self, service):
        project_id = uuid4()
        article_id = uuid4()
        template_id = uuid4()
        entity_type_id = uuid4()
        parent_instance_id = uuid4()
        existing_run_id = uuid4()
        expected = _make_single_result(str(existing_run_id), str(entity_type_id))

        service.extract_section = AsyncMock(return_value=expected)

        payload = SectionExtractionRequest(
            projectId=str(project_id),
            articleId=str(article_id),
            templateId=str(template_id),
            entityTypeId=str(entity_type_id),
            parentInstanceId=str(parent_instance_id),
            runId=str(existing_run_id),
        )
        result = await service.run_from_request(payload)

        assert result is expected
        service.extract_section.assert_awaited_once_with(
            project_id=project_id,
            article_id=article_id,
            template_id=template_id,
            entity_type_id=entity_type_id,
            parent_instance_id=parent_instance_id,
            model=payload.model,
            run_id=existing_run_id,
        )


# ---------------------------------------------------------------------------
# Branch 2: run_id set (no entity_type_id) → extract_for_run
# ---------------------------------------------------------------------------


class TestRunFromRequestForRun:
    @pytest.mark.asyncio
    async def test_routes_to_extract_for_run_when_only_run_id_set(self, service):
        project_id = uuid4()
        article_id = uuid4()
        template_id = uuid4()
        run_id = uuid4()
        expected = _make_batch_result(str(run_id))

        service.extract_section = AsyncMock(
            side_effect=AssertionError("extract_section must NOT be called")
        )
        service.extract_for_run = AsyncMock(return_value=expected)
        service.extract_all_sections = AsyncMock(
            side_effect=AssertionError("extract_all_sections must NOT be called")
        )

        payload = SectionExtractionRequest(
            projectId=str(project_id),
            articleId=str(article_id),
            templateId=str(template_id),
            runId=str(run_id),
            skipFieldsWithHumanProposals=True,
            autoAdvanceToReview=False,
        )
        result = await service.run_from_request(payload)

        assert result is expected
        service.extract_for_run.assert_awaited_once_with(
            run_id=run_id,
            skip_fields_with_human_proposals=True,
            auto_advance_to_review=False,
            model=payload.model,
        )


# ---------------------------------------------------------------------------
# Branch 3: extract_all_sections (parent_instance_id required)
# ---------------------------------------------------------------------------


class TestRunFromRequestAllSections:
    @pytest.mark.asyncio
    async def test_routes_to_extract_all_sections_when_extract_all_set(self, service):
        project_id = uuid4()
        article_id = uuid4()
        template_id = uuid4()
        parent_instance_id = uuid4()
        run_id = uuid4()
        expected = _make_batch_result(str(run_id))

        service.extract_section = AsyncMock(
            side_effect=AssertionError("extract_section must NOT be called")
        )
        service.extract_for_run = AsyncMock(
            side_effect=AssertionError("extract_for_run must NOT be called")
        )
        service.extract_all_sections = AsyncMock(return_value=expected)

        payload = SectionExtractionRequest(
            projectId=str(project_id),
            articleId=str(article_id),
            templateId=str(template_id),
            parentInstanceId=str(parent_instance_id),
            extractAllSections=True,
        )
        result = await service.run_from_request(payload)

        assert result is expected
        service.extract_all_sections.assert_awaited_once_with(
            project_id=project_id,
            article_id=article_id,
            template_id=template_id,
            parent_instance_id=parent_instance_id,
            section_ids=None,
            pdf_text=None,
            model=payload.model,
        )
