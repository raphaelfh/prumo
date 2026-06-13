"""The typed LLM call, exercised through FunctionModel — no network."""

import json

import pytest
from pydantic import BaseModel, ConfigDict, Field
from pydantic_ai import ModelResponse, ModelRetry, TextPart, UnexpectedModelBehavior
from pydantic_ai.models.function import AgentInfo, FunctionModel

from app.llm.extractor import LlmUsage, extract_structured


class Demo(BaseModel):
    model_config = ConfigDict(extra="forbid")

    answer: str = Field(description="The answer.")


def _canned(payload: dict) -> FunctionModel:
    def respond(messages, info: AgentInfo) -> ModelResponse:  # noqa: ARG001
        return ModelResponse(parts=[TextPart(json.dumps(payload))])

    return FunctionModel(respond)


async def test_returns_typed_output_and_usage():
    output, usage = await extract_structured(
        output_model=Demo,
        system_prompt="sys",
        user_prompt="user",
        model=_canned({"answer": "42"}),
        prompt_name="demo",
        prompt_version="abcdefabcdef",
    )
    assert output.answer == "42"
    assert isinstance(usage, LlmUsage)
    # FunctionModel populates non-zero estimated usage — the input→prompt /
    # output→completion mapping must carry it through, not zero it out.
    assert usage.prompt_tokens > 0
    assert usage.completion_tokens > 0
    assert usage.total_tokens == usage.prompt_tokens + usage.completion_tokens


async def test_usage_accumulates_across_reask_retries():
    attempts = {"n": 0}

    def reject_once(output: Demo) -> Demo:
        attempts["n"] += 1
        if attempts["n"] == 1:
            raise ModelRetry("try again")
        return output

    _, clean_usage = await extract_structured(
        output_model=Demo,
        system_prompt="sys",
        user_prompt="user",
        model=_canned({"answer": "42"}),
        prompt_name="demo",
        prompt_version="abcdefabcdef",
    )
    attempts["n"] = 0
    _, retried_usage = await extract_structured(
        output_model=Demo,
        system_prompt="sys",
        user_prompt="user",
        model=_canned({"answer": "42"}),
        prompt_name="demo",
        prompt_version="abcdefabcdef",
        validators=[reject_once],
    )
    assert retried_usage.total_tokens > clean_usage.total_tokens


async def test_validator_rejection_exhausts_retries_and_raises():
    def always_reject(output: Demo) -> Demo:  # noqa: ARG001
        raise ModelRetry("not good enough")

    with pytest.raises(UnexpectedModelBehavior):
        await extract_structured(
            output_model=Demo,
            system_prompt="sys",
            user_prompt="user",
            model=_canned({"answer": "x"}),
            prompt_name="demo",
            prompt_version="abcdefabcdef",
            validators=[always_reject],
            output_retries=1,
        )


async def test_invalid_payload_exhausts_retries_and_raises():
    with pytest.raises(UnexpectedModelBehavior):
        await extract_structured(
            output_model=Demo,
            system_prompt="sys",
            user_prompt="user",
            model=_canned({"wrong_key": True}),
            prompt_name="demo",
            prompt_version="abcdefabcdef",
            output_retries=1,
        )


def test_llm_usage_addition():
    total = LlmUsage(prompt_tokens=10, completion_tokens=5) + LlmUsage(
        prompt_tokens=1, completion_tokens=2
    )
    assert (total.prompt_tokens, total.completion_tokens, total.total_tokens) == (11, 7, 18)
