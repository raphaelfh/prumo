"""_extract_with_llm prepends the pinned general instruction to the user
prompt AND to the persisted composition re-render (constitution §IX —
provenance must record the prompt actually sent)."""

from unittest.mock import AsyncMock, MagicMock

import pytest

from app.llm.extractor import LlmUsage
from app.services.section_extraction_service import SectionExtractionService


class _Field:
    name = "sample_size"
    label = "Sample size"
    description = ""
    field_type = "number"
    is_required = False
    validation_schema = None
    allowed_values = None
    unit = None
    allowed_units = None
    allow_other = False
    other_label = None
    other_placeholder = None
    allows_not_applicable = False
    allows_not_evaluated = False


class _EntityType:
    name = "Population"
    description = "Who was studied"
    fields = [_Field()]


@pytest.mark.asyncio
async def test_extract_with_llm_prepends_general_instructions(monkeypatch) -> None:
    captured: dict[str, str] = {}

    async def fake_extract_structured(**kwargs):
        captured["user_prompt"] = kwargs["user_prompt"]
        return MagicMock(), LlmUsage()

    monkeypatch.setattr(
        "app.services.section_extraction_service.extract_structured",
        fake_extract_structured,
    )
    monkeypatch.setattr(
        "app.services.section_extraction_service.dump_extraction",
        lambda output: {},
    )
    # Unconditional: build_model raises MissingLLMKeyError without a key;
    # every existing direct _extract_with_llm test patches it.
    monkeypatch.setattr(
        "app.services.section_extraction_service.build_model",
        lambda *a, **k: MagicMock(),
    )

    service = SectionExtractionService(
        db=AsyncMock(),
        user_id="00000000-0000-0000-0000-000000000001",
        storage=MagicMock(),
        trace_id="t",
    )
    await service._extract_with_llm(
        pdf_text="ARTICLE",
        entity_type=_EntityType(),
        model="gpt-test",
        general_instructions="Report values exactly as stated.",
    )
    assert captured["user_prompt"].startswith(
        "General instructions for this review:\nReport values exactly as stated.\n\n"
    )
    # Constitution §IX: the persisted composition re-render must be
    # byte-faithful — it carries the same leading block.
    composition = service._run_provenance["prompt_composition"]
    assert composition["section_instruction"].startswith(
        "General instructions for this review:\nReport values exactly as stated.\n\n"
    )
