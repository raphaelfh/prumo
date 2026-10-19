"""Provider request ids flow from pydantic-ai into ``LlmUsage`` — no network.

``FunctionModel`` stands in for the provider; each reply carries the
``provider_response_id`` a real provider would stamp on its response.
"""

import json

from pydantic import BaseModel, ConfigDict, Field
from pydantic_ai import ModelResponse, ModelRetry, TextPart
from pydantic_ai.models.function import AgentInfo, FunctionModel

from app.llm.extractor import LlmUsage, extract_structured


class Demo(BaseModel):
    model_config = ConfigDict(extra="forbid")

    answer: str = Field(description="The answer.")


async def test_request_ids_cover_every_attempt_including_validator_retries():
    ids = iter(["resp-1", "resp-2"])

    def respond(messages, info: AgentInfo) -> ModelResponse:  # noqa: ARG001
        return ModelResponse(
            parts=[TextPart(json.dumps({"answer": "42"}))], provider_response_id=next(ids)
        )

    attempts = {"n": 0}

    def reject_once(output: Demo) -> Demo:
        attempts["n"] += 1
        if attempts["n"] == 1:
            raise ModelRetry("try again")
        return output

    _, usage = await extract_structured(
        output_model=Demo,
        system_prompt="sys",
        user_prompt="user",
        model=FunctionModel(respond),
        prompt_name="demo",
        prompt_version="abcdefabcdef",
        validators=[reject_once],
    )

    assert usage.request_ids == ["resp-1", "resp-2"]


async def test_a_response_without_an_id_contributes_none():
    def respond(messages, info: AgentInfo) -> ModelResponse:  # noqa: ARG001
        return ModelResponse(parts=[TextPart(json.dumps({"answer": "42"}))])

    _, usage = await extract_structured(
        output_model=Demo,
        system_prompt="sys",
        user_prompt="user",
        model=FunctionModel(respond),
        prompt_name="demo",
        prompt_version="abcdefabcdef",
    )

    assert usage.request_ids == []


def test_adding_usages_concatenates_request_ids():
    total = LlmUsage(1, 2, ["a"]) + LlmUsage(3, 4, ["b"])

    assert total == LlmUsage(4, 6, ["a", "b"])
    assert total.total_tokens == 10
