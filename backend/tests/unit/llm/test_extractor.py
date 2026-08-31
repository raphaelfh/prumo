"""The typed LLM call — no network.

Most cases run on FunctionModel; the last one drives the real OpenAI model
class over a canned wire response, because FunctionModel cannot reach the
provider-usage extraction path that zeroed prod's token counts.
"""

import json

import httpx
import pytest
from openai import AsyncOpenAI
from pydantic import BaseModel, ConfigDict, Field
from pydantic_ai import (
    ModelResponse,
    ModelRetry,
    NativeOutput,
    TextPart,
    ToolOutput,
    UnexpectedModelBehavior,
)
from pydantic_ai.models import override_allow_model_requests
from pydantic_ai.models.function import AgentInfo, FunctionModel
from pydantic_ai.models.openai import OpenAIChatModel
from pydantic_ai.providers.openai import OpenAIProvider

from app.llm.extractor import LlmUsage, _output_for, extract_structured


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


class _OutModel(BaseModel):
    value: str


class _FakeAnthropic:  # only the .system provider name matters to _output_for
    system = "anthropic"


def test_output_for_uses_native_for_non_anthropic():
    # Any model whose provider is not "anthropic" (OpenAI, FunctionModel, or a
    # bare object with no .system) stays on NativeOutput.
    assert isinstance(_output_for(object(), _OutModel), NativeOutput)


def test_output_for_uses_tooloutput_for_anthropic():
    assert isinstance(_output_for(_FakeAnthropic(), _OutModel), ToolOutput)


# ---------------------------------------------------------------------------
# Provider-usage regression guard (prod incident 2026-08-10 .. 2026-08-30)
# ---------------------------------------------------------------------------
#
# Every test above runs on FunctionModel, which ESTIMATES usage locally and
# never reaches pydantic-ai's provider-usage extraction. That blind spot let a
# dependency drift zero every token count in prod for three weeks while CI
# stayed green: genai-prices 0.1.4 added ``output_reasoning_tokens`` to its
# ``Usage``, pydantic-ai's ``RequestUsage`` has no such field, and
# ``RequestUsage.extract`` swallows the resulting ``TypeError`` under a bare
# ``except Exception`` and returns a ZERO usage. ``extract_structured``'s
# ``or 0`` then records that zero as fact.
#
# So this one exercises the real OpenAI model class over a canned wire
# response (no network): SDK parsing -> _map_usage -> RequestUsage.extract ->
# LlmUsage. It fails on any version pair that cannot carry the counts through.


def _canned_openai_transport(body: dict) -> httpx.AsyncClient:
    """An httpx client that answers every request with *body*."""

    def handler(request: httpx.Request) -> httpx.Response:  # noqa: ARG001
        return httpx.Response(200, json=body)

    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


#: A real chat-completions payload. The ``*_tokens_details`` blocks are the
#: point: a bare prompt/completion/total triple maps fine even on the broken
#: pair, so a simplified body would not catch the drift.
_OPENAI_RESPONSE = {
    "id": "chatcmpl-regression",
    "object": "chat.completion",
    "created": 0,
    "model": "gpt-4o-mini",
    "choices": [
        {
            "index": 0,
            "finish_reason": "stop",
            "message": {"role": "assistant", "content": '{"answer": "42"}'},
        }
    ],
    "usage": {
        "prompt_tokens": 20199,
        "completion_tokens": 970,
        "total_tokens": 21169,
        "prompt_tokens_details": {"audio_tokens": 0, "cached_tokens": 19200},
        "completion_tokens_details": {
            "accepted_prediction_tokens": 0,
            "audio_tokens": 0,
            "reasoning_tokens": 640,
            "rejected_prediction_tokens": 0,
        },
    },
}


async def test_provider_reported_usage_is_never_silently_zeroed():
    """The provider's token counts must survive the pydantic-ai/genai-prices seam."""
    client = AsyncOpenAI(api_key="test-key", http_client=_canned_openai_transport(_OPENAI_RESPONSE))
    model = OpenAIChatModel("gpt-4o-mini", provider=OpenAIProvider(openai_client=client))

    # ``conftest`` sets ALLOW_MODEL_REQUESTS = False so no test can reach a real
    # provider. The transport above is a MockTransport, so nothing leaves the
    # process — lift the guard for this call only, and restore it after.
    with override_allow_model_requests(True):
        output, usage = await extract_structured(
            output_model=Demo,
            system_prompt="sys",
            user_prompt="user",
            model=model,
            prompt_name="demo",
            prompt_version="abcdefabcdef",
        )

    assert output.answer == "42"
    # The exact counts the provider reported — not 0, and not an estimate.
    assert usage.prompt_tokens == 20199, (
        "provider usage was dropped: pydantic-ai could not map the response's "
        "usage block (see RequestUsage.extract's bare `except Exception`). "
        "Check the pydantic-ai / genai-prices / openai version triple."
    )
    assert usage.completion_tokens == 970
    assert usage.total_tokens == 21169
