"""Bug #3 — a batch where every section fails must FAIL the run, not report
success. Stubs the service collaborators and asserts the all-failed guard
raises BatchAllSectionsFailed (→ rollback_and_fail) instead of completing."""

from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from app.schemas.llm_target import LlmTarget
from app.schemas.run_prompt_context import RunPromptContext
from app.services.engine_credentials import EngineCredentials
from app.services.section_extraction_service import (
    BatchAllSectionsFailed,
    SectionExtractionService,
)


@pytest.mark.asyncio
@patch(
    "app.services.section_extraction_service.resolve_run_prompt_context",
    AsyncMock(return_value=RunPromptContext()),
)
async def test_extract_for_run_raises_when_all_sections_fail():
    # LoggerMixin.logger is a stateless read-only property — leave it real.
    svc = SectionExtractionService.__new__(SectionExtractionService)
    svc.trace_id = "t"
    # __new__ skips __init__ — supply the env-default candidate it would set.
    svc._engine = LlmTarget(provider="openai", model="m")
    # ...and the credentials + identity marker (``_key_provider=None`` is the
    # unknown caller: the injected credentials are never re-resolved).
    svc._credentials = EngineCredentials(None, None, None, None)
    svc._key_provider = None
    # A retry-shaped construction: defer to whatever the run is pinned to.
    svc._repin = False
    svc.user_id = "u"

    run = SimpleNamespace(
        id="r",
        project_id="p",
        template_id="tpl",
        article_id="a",
        kind="extraction",
        stage="extract",
        version_id="v",
    )
    template = SimpleNamespace(framework="CHARMS")
    # db.get is called twice: first the run, then the template. The hoisted
    # run-constant fetch is stubbed at the decorator (it needs a real run row).
    svc.db = SimpleNamespace(
        get=AsyncMock(side_effect=[run, template]),
        execute=AsyncMock(return_value=SimpleNamespace(scalar_one_or_none=lambda: None)),
    )
    svc._runs = SimpleNamespace(
        start_run=AsyncMock(),
        complete_run=AsyncMock(),
        rollback_and_fail=AsyncMock(),
        # None = "no engine recorded", so the run falls back to the candidate.
        freeze_engine=AsyncMock(return_value=None),
    )
    # Mock _assemble_prompt_text to bypass build_prompt_input (PDF/storage not needed).
    svc._assemble_prompt_text = AsyncMock(return_value="text")
    # B-2: the top-level set comes from the run-pinned tree seam.
    entity_type = SimpleNamespace(id="e1", name="Sec", parent_entity_type_id=None)
    svc._pinned_entity_types = AsyncMock(return_value=[entity_type])
    # Every entity-type extraction fails -> successful == 0.
    svc._extract_one_entity_type_for_run = AsyncMock(side_effect=RuntimeError("llm down"))

    with pytest.raises(BatchAllSectionsFailed):
        await svc.extract_for_run(run_id="r")

    svc._runs.complete_run.assert_not_called()
    svc._runs.rollback_and_fail.assert_awaited()
