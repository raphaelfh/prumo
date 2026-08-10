"""The server owns the default model (C1).

The frontend used to send its own `'gpt-4o-mini'` from three places, one of
which (`app.config.ts`) advertised `'gpt-5-mini'` that nothing ever read.
C1 deleted all three, so the request now omits `model` entirely and these
defaults are what actually decides. If they stop defaulting, extraction
silently changes model — so they are pinned here.
"""

from __future__ import annotations

from app.core.config import settings
from app.schemas.extraction import ExtractionOptions, SectionExtractionRequest


def test_the_section_request_defaults_to_the_configured_model() -> None:
    payload = SectionExtractionRequest(
        projectId="ffffffff-9999-0001-0000-000000000001",
        articleId="ffffffff-9999-0002-0000-0000000009c1",
        templateId="ffffffff-9999-0003-0000-000000000001",
        entityTypeId="ffffffff-9999-0004-0000-000000000001",
    )
    assert payload.model == settings.LLM_DEFAULT_MODEL


def test_extraction_options_default_to_the_configured_model() -> None:
    assert ExtractionOptions().model == settings.LLM_DEFAULT_MODEL


def test_an_explicit_model_still_wins() -> None:
    assert ExtractionOptions(model="gpt-5").model == "gpt-5"
    payload = SectionExtractionRequest(
        projectId="ffffffff-9999-0001-0000-000000000001",
        articleId="ffffffff-9999-0002-0000-0000000009c1",
        templateId="ffffffff-9999-0003-0000-000000000001",
        entityTypeId="ffffffff-9999-0004-0000-000000000001",
        model="gpt-5",
    )
    assert payload.model == "gpt-5"
