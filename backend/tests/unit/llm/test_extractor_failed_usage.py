"""A call that raises still reports what it consumed — no network.

``extract_structured`` attaches the tokens and response ids of every attempt
it made to the exception it raises, so metering can record a failed call with
the usage the provider actually billed (``failed_usage``).
"""

import json

import pytest
from pydantic import BaseModel, ConfigDict, Field
from pydantic_ai import ModelResponse, ModelRetry, TextPart, UsageLimits
from pydantic_ai.exceptions import UnexpectedModelBehavior, UsageLimitExceeded
from pydantic_ai.models.function import AgentInfo, FunctionModel
from pydantic_ai.usage import RequestUsage

from app.llm.extractor import LlmUsage, extract_structured, failed_usage


class Demo(BaseModel):
    model_config = ConfigDict(extra="forbid")

    answer: str = Field(description="The answer.")


def _numbered_replies() -> FunctionModel:
    counter = {"n": 0}

    def respond(messages, info: AgentInfo) -> ModelResponse:  # noqa: ARG001
        counter["n"] += 1
        return ModelResponse(
            parts=[TextPart(json.dumps({"answer": "42"}))],
            usage=RequestUsage(input_tokens=100, output_tokens=7),
            provider_response_id=f"resp-{counter['n']}",
        )

    return FunctionModel(respond)


def _always_reject(_output: Demo) -> Demo:
    raise ModelRetry("try again")


async def test_an_exhausted_reask_budget_carries_every_attempts_usage():
    with pytest.raises(UnexpectedModelBehavior) as raised:
        await extract_structured(
            output_model=Demo,
            system_prompt="sys",
            user_prompt="user",
            model=_numbered_replies(),
            prompt_name="demo",
            prompt_version="abcdefabcdef",
            validators=[_always_reject],
            output_retries=1,
        )

    assert failed_usage(raised.value) == LlmUsage(200, 14, ["resp-1", "resp-2"])


async def test_a_request_ceiling_carries_the_usage_spent_before_it():
    with pytest.raises(UsageLimitExceeded) as raised:
        await extract_structured(
            output_model=Demo,
            system_prompt="sys",
            user_prompt="user",
            model=_numbered_replies(),
            prompt_name="demo",
            prompt_version="abcdefabcdef",
            validators=[_always_reject],
            output_retries=10,
            usage_limits=UsageLimits(request_limit=3),
        )

    assert failed_usage(raised.value) == LlmUsage(300, 21, ["resp-1", "resp-2", "resp-3"])


def test_an_exception_without_attached_usage_reads_zero():
    assert failed_usage(RuntimeError("boom")) == LlmUsage()
