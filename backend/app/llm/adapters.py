"""Per-provider adapters the registry rows point at (§1).

Two callables per provider, both referenced from its :class:`ProviderSpec`
in ``app.llm.registry`` so that adding a provider is one row there plus
its adapters here, and nothing else learns the provider's name:

* ``build(model_name, api_key, base_url, output_mode) -> Model`` — the
  pydantic-ai model instance for already-resolved credentials. The key is
  always a string by the time it arrives (``build_model`` resolves the
  global fallback for hosted providers and the ``"no-key-required"``
  placeholder for a keyless host); hosted providers ignore ``base_url``.
  The resolved ``output_mode`` is written into the model profile's
  ``default_structured_output_mode`` — the one place pydantic-ai reads how
  structured output travels for this model — so the extractor needs no
  provider knowledge of its own.
* ``probe(client, api_key) -> Outcome`` — one cheap authenticated call
  per HOSTED provider (§4 verify). A transport smoke test, never a quality
  gate: 200 and 429 are ``ok`` (a rate-limited key is a real key), 401/403
  (400 for Google) are ``unauthorized``, anything else is ``http_<status>``.
  The key travels in a header — httpx embeds the URL in transport-error
  text, so a query-string key would leak into logs. A host-bearing
  provider has no key probe: its connections run the endpoint ladder
  (``app.services.llm_endpoint_probe``) instead.

pydantic-ai imports are lazy inside each builder: a provider's SDK is only
loaded on its own path, and the registry (imported by the ORM model for
its CHECK literals) stays light.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import replace
from typing import TYPE_CHECKING, Any, Literal

if TYPE_CHECKING:
    import httpx
    from pydantic_ai.models import Model
    from pydantic_ai.providers import Provider

OutputMode = Literal["native", "tool", "prompted"]
Outcome = tuple[Literal["ok", "failed"], str | None]

_TIMEOUT_S = 10.0


def _pinned(
    model_cls: Callable[..., Model],
    provider: Provider[Any],
    model_name: str,
    output_mode: OutputMode,
) -> Model:
    """``model_cls`` on ``provider`` with the output mode pinned into the
    provider's own profile — ``replace`` keeps the provider-specific subclass
    (its JSON-schema transformer, reasoning flags) intact."""
    from pydantic_ai.profiles import DEFAULT_PROFILE

    base = provider.model_profile(model_name) or DEFAULT_PROFILE
    profile = replace(base, default_structured_output_mode=output_mode)
    return model_cls(model_name, provider=provider, profile=profile)


def build_openai(
    model_name: str, api_key: str, base_url: str | None, output_mode: OutputMode
) -> Model:
    """OpenAI itself (``base_url`` None) and any OpenAI-compatible host. For
    a host, ``output_mode`` is what the endpoint probe measured on this
    connection (``build_model`` passes it in), never a guess from the host
    name — the same ``ollama.com`` URL can serve both."""
    from pydantic_ai.models.openai import OpenAIChatModel
    from pydantic_ai.providers.openai import OpenAIProvider

    provider = OpenAIProvider(api_key=api_key, base_url=base_url)
    return _pinned(OpenAIChatModel, provider, model_name, output_mode)


def build_anthropic(
    model_name: str, api_key: str, _base_url: str | None, output_mode: OutputMode
) -> Model:
    from pydantic_ai.models.anthropic import AnthropicModel
    from pydantic_ai.providers.anthropic import AnthropicProvider

    return _pinned(AnthropicModel, AnthropicProvider(api_key=api_key), model_name, output_mode)


def build_google(
    model_name: str, api_key: str, _base_url: str | None, output_mode: OutputMode
) -> Model:
    from pydantic_ai.models.google import GoogleModel
    from pydantic_ai.providers.google import GoogleProvider

    return _pinned(GoogleModel, GoogleProvider(api_key=api_key), model_name, output_mode)


def build_ollama(
    model_name: str, api_key: str, _base_url: str | None, output_mode: OutputMode
) -> Model:
    """Ollama Cloud: the hosted ``ollama.com`` endpoint. It accepts a
    json_schema ``response_format`` without enforcing it (pydantic-ai#4917,
    ollama/ollama#12362), which is why its registry row says ``tool``."""
    from pydantic_ai.models.ollama import OllamaModel
    from pydantic_ai.providers.ollama import OllamaProvider

    provider = OllamaProvider(base_url="https://ollama.com/v1", api_key=api_key)
    return _pinned(OllamaModel, provider, model_name, output_mode)


def _outcome(status: int, *, unauthorized: tuple[int, ...]) -> Outcome:
    if status in (200, 429):
        return ("ok", None)
    if status in unauthorized:
        return ("failed", "unauthorized")
    return ("failed", f"http_{status}")


async def probe_openai(client: httpx.AsyncClient, api_key: str) -> Outcome:
    r = await client.get(
        "https://api.openai.com/v1/models",
        headers={"Authorization": f"Bearer {api_key}"},
        timeout=_TIMEOUT_S,
    )
    return _outcome(r.status_code, unauthorized=(401,))


async def probe_anthropic(client: httpx.AsyncClient, api_key: str) -> Outcome:
    r = await client.post(
        "https://api.anthropic.com/v1/messages",
        headers={
            "x-api-key": api_key,
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json",
        },
        json={
            "model": "claude-3-haiku-20240307",
            "max_tokens": 1,
            "messages": [{"role": "user", "content": "hi"}],
        },
        timeout=_TIMEOUT_S,
    )
    return _outcome(r.status_code, unauthorized=(401, 403))


async def probe_google(client: httpx.AsyncClient, api_key: str) -> Outcome:
    r = await client.get(
        "https://generativelanguage.googleapis.com/v1/models",
        headers={"x-goog-api-key": api_key},
        timeout=_TIMEOUT_S,
    )
    return _outcome(r.status_code, unauthorized=(400, 401, 403))


async def probe_ollama(client: httpx.AsyncClient, api_key: str) -> Outcome:
    # /api/me, not /v1/models: the model listings answer 200 to any key.
    r = await client.post(
        "https://ollama.com/api/me",
        headers={"Authorization": f"Bearer {api_key}"},
        timeout=_TIMEOUT_S,
    )
    return _outcome(r.status_code, unauthorized=(401, 403))


async def probe_llama_cloud(client: httpx.AsyncClient, api_key: str) -> Outcome:
    r = await client.get(
        "https://api.cloud.llamaindex.ai/api/v1/parsing/supported_file_extensions",
        headers={"Authorization": f"Bearer {api_key}"},
        timeout=_TIMEOUT_S,
    )
    return _outcome(r.status_code, unauthorized=(401, 403))
