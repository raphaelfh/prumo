"""Bug #3 — a batch where every section fails must FAIL the run, not report
success. Stubs the service collaborators and asserts the all-failed guard
raises BatchAllSectionsFailed (→ rollback_and_fail) instead of completing."""

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.services.section_extraction_service import (
    BatchAllSectionsFailed,
    SectionExtractionService,
)


@pytest.mark.asyncio
async def test_extract_for_run_raises_when_all_sections_fail():
    # LoggerMixin.logger is a stateless read-only property — leave it real.
    svc = SectionExtractionService.__new__(SectionExtractionService)
    svc.trace_id = "t"

    run = SimpleNamespace(
        id="r", template_id="tpl", article_id="a", kind="extraction", stage="extract"
    )
    template = SimpleNamespace(framework="CHARMS")
    # db.get is called twice: first the run, then the template.
    svc.db = SimpleNamespace(get=AsyncMock(side_effect=[run, template]))
    svc._runs = SimpleNamespace(
        start_run=AsyncMock(),
        complete_run=AsyncMock(),
        rollback_and_fail=AsyncMock(),
    )
    svc._get_pdf = AsyncMock(return_value=b"%PDF")
    svc.pdf_processor = SimpleNamespace(extract_text=AsyncMock(return_value="text"))
    entity_type = SimpleNamespace(id="e1", name="Sec")
    svc._top_level_entity_types_for_template = AsyncMock(return_value=[entity_type])
    # Every entity-type extraction fails -> successful == 0.
    svc._extract_one_entity_type_for_run = AsyncMock(side_effect=RuntimeError("llm down"))

    with pytest.raises(BatchAllSectionsFailed):
        await svc.extract_for_run(run_id="r")

    svc._runs.complete_run.assert_not_called()
    svc._runs.rollback_and_fail.assert_awaited()
