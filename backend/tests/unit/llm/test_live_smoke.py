"""Opt-in live round-trip against the real OpenAI API.

Run with: PRUMO_LLM_SMOKE=1 OPENAI_API_KEY=sk-... uv run pytest -m llm
Never runs in CI (deselected by addopts; skipped without the env var)."""

import os

import pytest
from pydantic import BaseModel, ConfigDict, Field

pytestmark = [
    pytest.mark.llm,
    pytest.mark.skipif(
        not os.getenv("PRUMO_LLM_SMOKE"),
        reason="live LLM smoke test; set PRUMO_LLM_SMOKE=1 and OPENAI_API_KEY to run",
    ),
]


class SmokeOutput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    capital: str = Field(description="The capital city.")
    confidence: float = Field(ge=0.0, le=1.0)


async def test_live_extraction_round_trip():
    import pydantic_ai.models as pai_models

    from app.llm.extractor import extract_structured
    from app.llm.provider import build_model

    previous = pai_models.ALLOW_MODEL_REQUESTS
    pai_models.ALLOW_MODEL_REQUESTS = True
    try:
        output, usage = await extract_structured(
            output_model=SmokeOutput,
            system_prompt="You answer geography questions as structured data.",
            user_prompt="What is the capital of France?",
            model=build_model("gpt-4o-mini"),
            prompt_name="live_smoke",
            prompt_version="live",
        )
    finally:
        pai_models.ALLOW_MODEL_REQUESTS = previous

    assert output.capital == "Paris"
    assert usage.total_tokens > 0
