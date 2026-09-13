"""Cheap authenticated call per HOSTED provider (§4 verify).

A transport smoke test, never a quality gate: 200 and 429 are ``ok``
(a rate-limited key is a real key), 401/403 (400 for Google) are
``unauthorized``, anything else is ``http_<status>``, and a transport
error is ``unreachable``. The key travels in a header — httpx embeds the
URL in transport-error text, so a query-string key would leak into logs.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Literal

import httpx

from app.core.logging import get_logger
from app.llm.registry import get_provider

logger = get_logger(__name__)

_TIMEOUT_S = 10.0

Outcome = tuple[Literal["ok", "failed"], str | None]


def _outcome(status: int, *, unauthorized: tuple[int, ...]) -> Outcome:
    if status in (200, 429):
        return ("ok", None)
    if status in unauthorized:
        return ("failed", "unauthorized")
    return ("failed", f"http_{status}")


async def _probe_openai(client: httpx.AsyncClient, api_key: str) -> Outcome:
    r = await client.get(
        "https://api.openai.com/v1/models",
        headers={"Authorization": f"Bearer {api_key}"},
        timeout=_TIMEOUT_S,
    )
    return _outcome(r.status_code, unauthorized=(401,))


async def _probe_anthropic(client: httpx.AsyncClient, api_key: str) -> Outcome:
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


async def _probe_google(client: httpx.AsyncClient, api_key: str) -> Outcome:
    r = await client.get(
        "https://generativelanguage.googleapis.com/v1/models",
        headers={"x-goog-api-key": api_key},
        timeout=_TIMEOUT_S,
    )
    return _outcome(r.status_code, unauthorized=(400, 401, 403))


async def _probe_llama_cloud(client: httpx.AsyncClient, api_key: str) -> Outcome:
    r = await client.get(
        "https://api.cloud.llamaindex.ai/api/v1/parsing/supported_file_extensions",
        headers={"Authorization": f"Bearer {api_key}"},
        timeout=_TIMEOUT_S,
    )
    return _outcome(r.status_code, unauthorized=(401, 403))


async def _probe_ollama(client: httpx.AsyncClient, api_key: str) -> Outcome:
    # /api/me, not /v1/models: the model listings answer 200 to any key.
    r = await client.post(
        "https://ollama.com/api/me",
        headers={"Authorization": f"Bearer {api_key}"},
        timeout=_TIMEOUT_S,
    )
    return _outcome(r.status_code, unauthorized=(401, 403))


_PROBES: dict[str, Callable[[httpx.AsyncClient, str], Awaitable[Outcome]]] = {
    "openai": _probe_openai,
    "anthropic": _probe_anthropic,
    "google": _probe_google,
    "ollama": _probe_ollama,
    "llama_cloud": _probe_llama_cloud,
}


async def probe_hosted_key(provider: str, api_key: str) -> Outcome:
    spec = get_provider(provider)
    if spec is None or spec.needs_host:
        raise ValueError(f"{provider!r} is not a hosted provider")
    probe = _PROBES[provider]
    try:
        async with httpx.AsyncClient() as client:
            return await probe(client, api_key)
    except Exception:
        # Never echo transport detail (it can embed request data); the log has it.
        logger.warning("provider_key_probe_unreachable", provider=provider, exc_info=True)
        return ("failed", "unreachable")
