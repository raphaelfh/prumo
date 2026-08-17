"""_extract_with_llm prepends the pinned general instruction to the user
prompt AND to the persisted composition re-render (constitution §IX —
provenance must record the prompt actually sent)."""

from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest

from app.llm.extractor import LlmUsage
from app.llm.prompts import render_general_instructions_section
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
        lambda _output: {},
    )
    # Unconditional: build_model raises MissingLLMKeyError without a key;
    # every existing direct _extract_with_llm test patches it.
    monkeypatch.setattr(
        "app.services.section_extraction_service.build_model",
        lambda *_a, **_k: MagicMock(),
    )

    service = SectionExtractionService(
        db=AsyncMock(),
        user_id="00000000-0000-0000-0000-000000000001",
        storage=MagicMock(),
        trace_id="t",
    )
    data, usage = await service._extract_with_llm(
        pdf_text="ARTICLE",
        entity_type=_EntityType(),
        general_instructions="Report values exactly as stated.",
    )
    # The glue builds the snapshot post-verify (fast mode → pure no-op).
    await service._maybe_verify(uuid4(), uuid4(), "ARTICLE", data, usage)
    # Threading is under test here; the block's exact wording is golden-
    # tested in tests/unit/llm/test_prompts.py, so build the expected
    # prefix through the renderer instead of duplicating the literal.
    expected_prefix = render_general_instructions_section("Report values exactly as stated.")
    assert expected_prefix  # non-empty guard: a broken renderer must not pass
    assert captured["user_prompt"].startswith(expected_prefix)
    # Constitution §IX: the persisted composition re-render must be
    # byte-faithful — it carries the same leading block.
    composition = service._run_provenance["prompt_composition"]
    assert composition["section_instruction"].startswith(expected_prefix)
