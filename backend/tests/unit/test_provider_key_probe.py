"""One cheap authenticated call per hosted provider (§4 verify), through
``probe_hosted_key`` — the registry row's ``probe`` is the call."""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

import app.llm.registry as registry
from app.llm.registry import REGISTRY, ProviderSpec
from app.services.provider_key_probe import probe_hosted_key


def _client_returning(status_code: int, *, method: str) -> MagicMock:
    response = MagicMock()
    response.status_code = status_code
    response.text = ""
    client = MagicMock()
    setattr(client.return_value.__aenter__.return_value, method, AsyncMock(return_value=response))
    return client


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("provider", "method", "status_code", "expected"),
    [
        ("openai", "get", 200, ("ok", None)),
        ("openai", "get", 429, ("ok", None)),
        ("openai", "get", 401, ("failed", "unauthorized")),
        ("anthropic", "post", 200, ("ok", None)),
        ("anthropic", "post", 403, ("failed", "unauthorized")),
        ("google", "get", 400, ("failed", "unauthorized")),
        ("llama_cloud", "get", 500, ("failed", "http_500")),
        ("ollama", "post", 200, ("ok", None)),
        ("ollama", "post", 401, ("failed", "unauthorized")),
    ],
)
async def test_status_maps_to_outcome(
    provider: str, method: str, status_code: int, expected
) -> None:
    with patch("httpx.AsyncClient", _client_returning(status_code, method=method)):
        assert await probe_hosted_key(provider, "sk-x") == expected


@pytest.mark.asyncio
async def test_transport_error_is_failed_unreachable_never_raised() -> None:
    client = MagicMock()
    client.return_value.__aenter__.return_value.get = AsyncMock(side_effect=OSError("boom"))
    with patch("httpx.AsyncClient", client):
        assert await probe_hosted_key("openai", "sk-x") == ("failed", "unreachable")


@pytest.mark.asyncio
async def test_key_travels_in_a_header_never_the_url() -> None:
    client = _client_returning(200, method="get")
    with patch("httpx.AsyncClient", client):
        await probe_hosted_key("google", "sk-secret")
    call = client.return_value.__aenter__.return_value.get.call_args
    assert (
        "sk-secret" not in call.args[0] and call.kwargs["headers"]["x-goog-api-key"] == "sk-secret"
    )


@pytest.mark.parametrize("spec", REGISTRY, ids=lambda s: s.id)
def test_exactly_the_hosted_rows_carry_a_key_probe(spec: ProviderSpec) -> None:
    # A hosted row without a probe would make verify raise (a 500); a host
    # row's connections run the endpoint ladder instead.
    assert (spec.probe is not None) == (not spec.needs_host)


@pytest.mark.asyncio
async def test_ollama_key_travels_in_a_bearer_header() -> None:
    client = _client_returning(200, method="post")
    with patch("httpx.AsyncClient", client):
        await probe_hosted_key("ollama", "ollama-secret")
    call = client.return_value.__aenter__.return_value.post.call_args
    assert "ollama-secret" not in call.args[0]
    assert call.kwargs["headers"]["Authorization"] == "Bearer ollama-secret"


@pytest.mark.asyncio
async def test_host_bearing_provider_is_not_probed_here() -> None:
    with pytest.raises(ValueError, match="hosted"):
        await probe_hosted_key("openai_compatible", "k")


@pytest.mark.asyncio
async def test_the_rows_probe_is_the_call(monkeypatch: pytest.MonkeyPatch) -> None:
    """A fake hosted row: ``probe_hosted_key`` hands the key to ITS probe and
    returns its verdict — no table keyed by provider id in between."""
    seen: list[str] = []

    async def probe(_client: Any, api_key: str) -> tuple[Any, str | None]:
        seen.append(api_key)
        return ("failed", "http_418")

    fake = ProviderSpec(
        id="fake",
        label="Fake",
        description="a row under test",
        needs_host=False,
        key_optional=False,
        global_key_setting="OPENAI_API_KEY",
        docs_url="https://fake.example",
        scopes=frozenset({"user"}),
        llm=None,
        probe=probe,
    )
    monkeypatch.setattr(registry, "REGISTRY", (*REGISTRY, fake))
    assert await probe_hosted_key("fake", "sk-fake") == ("failed", "http_418")
    assert seen == ["sk-fake"]
