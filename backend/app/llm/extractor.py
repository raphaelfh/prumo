"""The typed LLM call.

A fresh tools-free Agent is built per call: the output type changes per
template, and per-run output_type is incompatible with agent-level
validators in pydantic-ai v1. Agents are cheap objects; this also keeps
BYOK fully state-free."""

from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import Any, TypeVar

import logfire
from pydantic import BaseModel
from pydantic_ai import Agent, NativeOutput, UsageLimits
from pydantic_ai.models import Model

OutputT = TypeVar("OutputT", bound=BaseModel)

# Reask ceiling: the initial request plus output retries, with headroom.
# Under BYOK the key is the user's — a runaway reask loop is their bill.
DEFAULT_USAGE_LIMITS = UsageLimits(request_limit=5)


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
    output_retries: int = 2,
    usage_limits: UsageLimits | None = None,
) -> tuple[OutputT, LlmUsage]:
    agent: Agent[None, OutputT] = Agent(
        model,
        output_type=NativeOutput(output_model),
        instructions=system_prompt,
        output_retries=output_retries,
        model_settings={"temperature": 0.1},
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
