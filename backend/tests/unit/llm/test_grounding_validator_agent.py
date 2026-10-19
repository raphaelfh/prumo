"""The grounding validator inside a real pydantic-ai agent: a reply citing an
unknown block ref is sent back and the corrected reply is the result.

The recorded fake ignores validators, so this drives ``extract_structured``
with a ``FunctionModel`` double (no network).
"""

from __future__ import annotations

from types import SimpleNamespace

import pytest
from pydantic_ai import ModelResponse, ToolCallPart
from pydantic_ai.models.function import AgentInfo, FunctionModel

from app.domain.evidence_block_refs import BlockRefIndex
from app.infrastructure.parsing.base import ParsedBlock
from app.llm.extractor import extract_structured
from app.llm.schema import build_output_models
from app.llm.validators import GroundingStats, evidence_grounding_validator

_QUOTE = "We enrolled 142 adults."


def _reply(block_ref: str) -> dict:
    return {
        "population": {
            "value": "adults",
            "confidence": 0.9,
            "reasoning": None,
            "evidence": [{"block_ref": block_ref, "quote": _QUOTE}],
            "status": "found",
        }
    }


@pytest.mark.asyncio
async def test_unknown_ref_is_retried_and_the_valid_reply_wins() -> None:
    answers = iter([_reply("p7·b3"), _reply("p1·b0")])

    def respond(messages, info: AgentInfo) -> ModelResponse:  # noqa: ARG001
        return ModelResponse(parts=[ToolCallPart(info.output_tools[0].name, next(answers))])

    field = SimpleNamespace(
        name="population",
        field_type="text",
        llm_description="d",
        description=None,
        allowed_values=None,
        is_required=False,
    )
    [model] = build_output_models(SimpleNamespace(name="s", description="", fields=[field]))
    index = BlockRefIndex(
        [
            ParsedBlock(
                page_number=1,
                block_index=0,
                text=_QUOTE,
                char_start=0,
                char_end=len(_QUOTE),
                bbox={"x": 0.0, "y": 0.0, "width": 1.0, "height": 1.0},
                block_type="paragraph",
            )
        ]
    )
    stats = GroundingStats()

    output, _ = await extract_structured(
        output_model=model,
        system_prompt="s",
        user_prompt="u",
        model=FunctionModel(respond),
        prompt_name="section_extraction",
        prompt_version="test",
        validators=[evidence_grounding_validator(index, stats)],
    )

    assert output.model_dump(by_alias=True)["population"]["evidence"] == [
        {"block_ref": "p1·b0", "quote": _QUOTE}
    ]
    assert stats.retried == 1
