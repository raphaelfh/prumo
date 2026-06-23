"""BYOK key resolution → pydantic-ai model instances.

The single place that knows which providers exist — services stay
provider-agnostic. Claude is BYOK-only (no global Anthropic key)."""

from pydantic_ai.models import Model
from pydantic_ai.models.openai import OpenAIChatModel
from pydantic_ai.providers.openai import OpenAIProvider

from app.core.config import settings


class MissingLLMKeyError(ValueError):
    """No usable API key: neither BYOK nor the global fallback is set."""


def build_model(provider: str, model_name: str, *, api_key: str | None = None) -> Model:
    if not model_name or not model_name.strip():
        raise ValueError("model_name must be a non-empty string.")
    provider = (provider or "openai").lower()
    if provider == "openai":
        key = api_key or settings.OPENAI_API_KEY
        if not key:
            raise MissingLLMKeyError(
                "No OpenAI API key available: pass a BYOK key or set OPENAI_API_KEY."
            )
        return OpenAIChatModel(model_name, provider=OpenAIProvider(api_key=key))
    if provider == "anthropic":
        if not api_key:
            raise MissingLLMKeyError(
                "No Anthropic API key available: add an 'anthropic' BYOK key "
                "(no global Anthropic key is configured)."
            )
        # Lazy import: only needed on the Anthropic path.
        from pydantic_ai.models.anthropic import AnthropicModel
        from pydantic_ai.providers.anthropic import AnthropicProvider

        return AnthropicModel(model_name, provider=AnthropicProvider(api_key=api_key))
    raise ValueError(f"Unsupported LLM provider: {provider!r}")
