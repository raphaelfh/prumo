"""The typed LLM call.

A fresh tools-free Agent is built per call: the output type changes per
template, and per-run output_type is incompatible with agent-level
validators in pydantic-ai v1. Agents are cheap objects; this also keeps
BYOK fully state-free.

How structured output travels (json_schema ``response_format``,
tool-calling or a prompted schema) is the MODEL's fact, not this module's:
``build_model`` pins the registry row's ``output_mode`` — or the custom
host's probed one — into the model profile's
``default_structured_output_mode``, and pydantic-ai resolves the bare
``output_type`` against it per request. Nothing here names a provider.

Callers should catch ``pydantic_ai.exceptions.AgentRunError`` — it covers
both ``UnexpectedModelBehavior`` (reask budget exhausted) and
``UsageLimitExceeded`` (request ceiling hit)."""

from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import Any, TypeVar

import logfire
from pydantic import BaseModel
from pydantic_ai import Agent, UsageLimits
from pydantic_ai.models import Model

from app.core.config import settings

OutputT = TypeVar("OutputT", bound=BaseModel)

# Reask ceiling: the initial request plus output retries, with headroom.
# Under BYOK the key is the user's — a runaway reask loop is their bill.
# Note: this caps REQUESTS per call, not tokens; per-request token spend
# is bounded by the model's context window and visible per-span in Logfire.
# LLM_TIMEOUT_SECONDS (below) bounds each HTTP request, so the worst-case
# wall-clock for one call is ~ request_limit × LLM_TIMEOUT_SECONDS.
DEFAULT_USAGE_LIMITS = UsageLimits(request_limit=5)

# Generation params — single source of truth so run provenance records the
# exact settings used (extraction_runs.results["provenance"].params). Keep these
# the ONLY definition; both the Agent config below and the provenance snapshot
# import them, so the recorded params can never drift from what was sent.
LLM_TEMPERATURE = 0.1
OUTPUT_RETRIES_DEFAULT = 2


@dataclass
class LlmUsage:
    """Token accounting in the legacy OpenAIUsage vocabulary so
    extraction_runs.results keeps its tokens_* keys unchanged."""

    prompt_tokens: int = 0
    completion_tokens: int = 0

    @property
    def total_tokens(self) -> int:
        return self.prompt_tokens + self.completion_tokens

    def __add__(self, other: "LlmUsage") -> "LlmUsage":
        return LlmUsage(
            prompt_tokens=self.prompt_tokens + other.prompt_tokens,
            completion_tokens=self.completion_tokens + other.completion_tokens,
        )


async def extract_structured(
    *,
    output_model: type[OutputT],
    system_prompt: str,
    user_prompt: str,
    model: Model,
    prompt_name: str,
    prompt_version: str,
    validators: Sequence[Callable[..., Any]] = (),
    output_retries: int = OUTPUT_RETRIES_DEFAULT,
    usage_limits: UsageLimits | None = None,
) -> tuple[OutputT, LlmUsage]:
    agent: Agent[None, OutputT] = Agent(
        model,
        output_type=output_model,
        instructions=system_prompt,
        retries={"output": output_retries},
        model_settings={
            "temperature": LLM_TEMPERATURE,
            "timeout": settings.LLM_TIMEOUT_SECONDS,
        },
    )
    for validator in validators:
        agent.output_validator(validator)
    with logfire.span(
        "llm_extraction",
        **{"prompt.name": prompt_name, "prompt.version": prompt_version},
    ):
        result = await agent.run(user_prompt, usage_limits=usage_limits or DEFAULT_USAGE_LIMITS)
    return result.output, LlmUsage(
        prompt_tokens=result.usage.input_tokens or 0,
        completion_tokens=result.usage.output_tokens or 0,
    )
