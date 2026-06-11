"""BYOK key resolution → pydantic-ai model instances.

The single place that knows which providers exist. Adding Anthropic
later is one new branch here — services stay provider-agnostic."""

from pydantic_ai.models import Model
from pydantic_ai.models.openai import OpenAIChatModel
from pydantic_ai.providers.openai import OpenAIProvider

from app.core.config import settings


class MissingLLMKeyError(ValueError):
    """No usable API key: neither BYOK nor the global fallback is set."""


def build_model(model_name: str, *, api_key: str | None = None) -> Model:
    key = api_key or settings.OPENAI_API_KEY
    if not key:
        raise MissingLLMKeyError(
            "No OpenAI API key available: pass a BYOK key or set OPENAI_API_KEY."
        )
    return OpenAIChatModel(model_name, provider=OpenAIProvider(api_key=key))
