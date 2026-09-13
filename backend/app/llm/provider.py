"""Credentials → pydantic-ai model instances, driven by the registry.

Five LLM providers today (``app.llm.registry``): ``openai``,
``anthropic``, ``google`` and ``ollama`` (a caller's key, else the operator's
global key), and ``openai_compatible`` (needs a ``base_url``; key optional —
keyless hosts get the literal placeholder ``"no-key-required"``). A host that
routes to Ollama Cloud gets an ``OllamaModel`` instead (see
:func:`_routes_to_ollama_cloud`), as does the hosted ``ollama`` provider.
Hosted providers ignore ``base_url``. A parsing provider is not buildable."""

from urllib.parse import urlparse

from pydantic_ai.models import Model
from pydantic_ai.models.openai import OpenAIChatModel
from pydantic_ai.providers.openai import OpenAIProvider

from app.llm.registry import get_provider, global_key_for


class MissingLLMKeyError(ValueError):
    """No usable API key: neither the caller's nor the global fallback is set."""


def _routes_to_ollama_cloud(base_url: str, model_name: str) -> bool:
    """A host on ``ollama.com``, or a ``-cloud`` model a local daemon forwards.

    Ollama Cloud accepts a json_schema ``response_format`` but does not enforce
    it (pydantic-ai#4917, ollama/ollama#12362). ``OllamaModel`` turns that
    capability off, so its ``system`` ("ollama") steers ``_output_for`` to
    tool-calling. Mirrors pydantic-ai's private ``_routes_to_ollama_cloud``.
    """
    hostname = urlparse(base_url).hostname or ""
    return (
        hostname == "ollama.com"
        or hostname.endswith(".ollama.com")
        or model_name.endswith("-cloud")
    )


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
        host_key = api_key or "no-key-required"
        if _routes_to_ollama_cloud(base_url, model_name):
            # Lazy import: only needed on the Ollama Cloud path.
            from pydantic_ai.models.ollama import OllamaModel
            from pydantic_ai.providers.ollama import OllamaProvider

            return OllamaModel(
                model_name, provider=OllamaProvider(base_url=base_url, api_key=host_key)
            )
        return OpenAIChatModel(
            model_name, provider=OpenAIProvider(api_key=host_key, base_url=base_url)
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
    if provider == "google":
        # Lazy import: google-genai is only needed on the Gemini path.
        from pydantic_ai.models.google import GoogleModel
        from pydantic_ai.providers.google import GoogleProvider

        return GoogleModel(model_name, provider=GoogleProvider(api_key=key))
    if provider == "ollama":
        # OllamaModel, not OpenAIChatModel: on the ollama.com host it turns off
        # json_schema output, which Ollama Cloud accepts but never enforces.
        from pydantic_ai.models.ollama import OllamaModel
        from pydantic_ai.providers.ollama import OllamaProvider

        return OllamaModel(
            model_name,
            provider=OllamaProvider(base_url="https://ollama.com/v1", api_key=key),
        )
    raise ValueError(f"Unsupported LLM provider: {provider!r}")
