"""One cheap authenticated call per hosted provider (§4 verify)."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

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


@pytest.mark.asyncio
async def test_host_bearing_provider_is_not_probed_here() -> None:
    with pytest.raises(ValueError, match="hosted"):
        await probe_hosted_key("openai_compatible", "k")
