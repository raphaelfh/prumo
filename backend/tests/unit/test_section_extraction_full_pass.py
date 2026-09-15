"""Full pass (spec §7.3): top-level + entries, then every entry's child sections."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest

from app.schemas.extraction import SectionExtractionRequest
from app.services.section_extraction_service import (
    BatchAllSectionsFailed,
    BatchExtractionResult,
    SectionExtractionService,
)


def _result(total: int, ok: int, failed: int, suggestions: int) -> BatchExtractionResult:
    return BatchExtractionResult(
        extraction_run_id="run",
        total_sections=total,
        successful_sections=ok,
        failed_sections=failed,
        total_suggestions_created=suggestions,
        sections=[{"entity_type_id": "x", "success": True}] * total,
    )


def _service(run: SimpleNamespace) -> SectionExtractionService:
    service = SectionExtractionService.__new__(SectionExtractionService)
    service.db = MagicMock()
    service.db.get = AsyncMock(return_value=run)
    service.user_id = str(uuid4())
    return service


@pytest.mark.asyncio
async def test_run_id_with_extract_all_sections_routes_to_the_full_pass() -> None:
    run_id = uuid4()
    service = _service(SimpleNamespace(id=run_id))
    service.extract_full_pass = AsyncMock(return_value=_result(1, 1, 0, 1))
    service.extract_for_run = AsyncMock()
    request = SectionExtractionRequest(
        project_id=uuid4(),
        article_id=uuid4(),
        template_id=uuid4(),
        run_id=run_id,
        extract_all_sections=True,
    )

    await service.run_from_request(request, engine=MagicMock())

    service.extract_full_pass.assert_awaited_once()
    service.extract_for_run.assert_not_awaited()


@pytest.mark.asyncio
async def test_plain_run_id_still_routes_to_extract_for_run() -> None:
    run_id = uuid4()
    service = _service(SimpleNamespace(id=run_id))
    service.extract_full_pass = AsyncMock()
    service.extract_for_run = AsyncMock(return_value=_result(1, 1, 0, 1))
    request = SectionExtractionRequest(
        project_id=uuid4(), article_id=uuid4(), template_id=uuid4(), run_id=run_id
    )

    await service.run_from_request(request, engine=MagicMock())

    service.extract_for_run.assert_awaited_once()
    service.extract_full_pass.assert_not_awaited()


@pytest.mark.asyncio
async def test_full_pass_sweeps_every_entry_and_merges_counts() -> None:
    run = SimpleNamespace(id=uuid4(), project_id=uuid4(), article_id=uuid4(), template_id=uuid4())
    entries = [uuid4(), uuid4()]
    service = _service(run)
    service.extract_for_run = AsyncMock(return_value=_result(3, 3, 0, 5))
    service._root_entry_instance_ids = AsyncMock(return_value=entries)
    service.extract_all_sections = AsyncMock(
        side_effect=[_result(4, 3, 1, 7), BatchAllSectionsFailed("all failed")]
    )
    engine = MagicMock()

    result = await service.extract_full_pass(
        run_id=run.id, skip_fields_with_human_proposals=True, engine=engine
    )

    service.extract_for_run.assert_awaited_once_with(
        run_id=run.id, skip_fields_with_human_proposals=True, engine=engine
    )
    swept = [
        call.kwargs["parent_instance_id"] for call in service.extract_all_sections.await_args_list
    ]
    assert swept == entries
    assert all(
        call.kwargs["run_id"] == run.id for call in service.extract_all_sections.await_args_list
    )
    assert (result.total_sections, result.successful_sections, result.failed_sections) == (8, 6, 2)
    assert result.total_suggestions_created == 12
    assert result.extraction_run_id == str(run.id)
