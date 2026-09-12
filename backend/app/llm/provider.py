"""Credentials → pydantic-ai model instances, driven by the registry.

Three LLM providers today (``app.llm.registry``): ``openai`` and
``anthropic`` (a caller's key, else the operator's global key), and
``openai_compatible`` (needs a ``base_url``; key optional — keyless
hosts get the literal placeholder ``"no-key-required"``). Hosted
providers ignore ``base_url``. A parsing provider is not buildable."""

from pydantic_ai.models import Model
from pydantic_ai.models.openai import OpenAIChatModel
from pydantic_ai.providers.openai import OpenAIProvider

from app.llm.registry import get_provider, global_key_for


class MissingLLMKeyError(ValueError):
    """No usable API key: neither the caller's nor the global fallback is set."""


def build_model(
    provider: str, model_name: str, *, api_key: str | None = None, base_url: str | None = None
) -> Model:
    if not model_name or not model_name.strip():
        raise ValueError("model_name must be a non-empty string.")
    provider = (provider or "openai").lower()
    spec = get_provider(provider)
    if spec is None or spec.serves != "llm":
        raise ValueError(f"Unsupported LLM provider: {provider!r}")

    if spec.needs_host:
        if not base_url:
            raise ValueError(f"{provider} requires a base_url.")
        return OpenAIChatModel(
            model_name,
            provider=OpenAIProvider(api_key=api_key or "no-key-required", base_url=base_url),
        )

    key = api_key or global_key_for(provider)
    if not key:
        raise MissingLLMKeyError(
            f"No {spec.label} API key available: pass a key or set {spec.global_key_setting}."
        )
    if provider == "openai":
        return OpenAIChatModel(model_name, provider=OpenAIProvider(api_key=key))
    if provider == "anthropic":
        # Lazy import: only needed on the Anthropic path.
        from pydantic_ai.models.anthropic import AnthropicModel
        from pydantic_ai.providers.anthropic import AnthropicProvider

        return AnthropicModel(model_name, provider=AnthropicProvider(api_key=key))
    raise ValueError(f"Unsupported LLM provider: {provider!r}")
