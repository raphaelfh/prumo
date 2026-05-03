"""Unit tests for the API key provider validation registry.

Covers the dispatch logic in ``api_key_service``: how a ``ProviderValidator``
config is translated into an HTTP call and how the response is classified
back into ``{status, message}``. Uses ``httpx.MockTransport`` so no network
traffic occurs.
"""

from typing import Any

import httpx
import pytest

from app.services.api_key_service import (
    PROVIDER_VALIDATORS,
    ProviderValidator,
    _anthropic_headers,
    _bearer_auth,
    _call_provider_validator,
    _gemini_url,
)

# ---------------------------------------------------------------------------
# Helper builders
# ---------------------------------------------------------------------------


def _mock_response(status_code: int, *, body: dict[str, Any] | None = None) -> httpx.Response:
    return httpx.Response(status_code, json=body or {})


def _patched_validator(
    monkeypatch: pytest.MonkeyPatch,
    handler,
) -> None:
    """Make ``httpx.AsyncClient`` use a MockTransport with `handler`."""
    real_init = httpx.AsyncClient.__init__

    def patched(self, *args, **kwargs):
        kwargs["transport"] = httpx.MockTransport(handler)
        real_init(self, *args, **kwargs)

    monkeypatch.setattr(httpx.AsyncClient, "__init__", patched)


# ---------------------------------------------------------------------------
# Header / URL builders
# ---------------------------------------------------------------------------


def test_bearer_auth_builds_authorization_header() -> None:
    assert _bearer_auth("sk-test") == {"Authorization": "Bearer sk-test"}


def test_anthropic_headers_include_required_version() -> None:
    headers = _anthropic_headers("ant-key")
    assert headers["x-api-key"] == "ant-key"
    assert headers["anthropic-version"] == "2023-06-01"
    assert headers["Content-Type"] == "application/json"


def test_gemini_url_includes_key_in_query_string() -> None:
    url = _gemini_url("g-test")
    assert url.startswith("https://generativelanguage.googleapis.com/v1/models")
    assert "key=g-test" in url


# ---------------------------------------------------------------------------
# Registry
# ---------------------------------------------------------------------------


def test_registry_contains_all_supported_providers() -> None:
    assert set(PROVIDER_VALIDATORS) == {"openai", "anthropic", "gemini", "grok"}


def test_registry_entries_are_provider_validator_instances() -> None:
    for name, config in PROVIDER_VALIDATORS.items():
        assert isinstance(config, ProviderValidator), name


def test_anthropic_uses_post_with_json_body() -> None:
    config = PROVIDER_VALIDATORS["anthropic"]
    assert config.method == "POST"
    assert config.json_body is not None
    assert "messages" in config.json_body


def test_gemini_uses_callable_url_so_key_is_in_query_string() -> None:
    assert callable(PROVIDER_VALIDATORS["gemini"].url)


# ---------------------------------------------------------------------------
# _call_provider_validator: classification
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_200_classifies_as_valid(monkeypatch: pytest.MonkeyPatch) -> None:
    _patched_validator(monkeypatch, lambda _req: _mock_response(200))
    result = await _call_provider_validator(PROVIDER_VALIDATORS["openai"], "k")
    assert result == {"status": "valid", "message": "Valid API key"}


@pytest.mark.asyncio
async def test_401_classifies_as_invalid(monkeypatch: pytest.MonkeyPatch) -> None:
    _patched_validator(monkeypatch, lambda _req: _mock_response(401))
    result = await _call_provider_validator(PROVIDER_VALIDATORS["openai"], "k")
    assert result["status"] == "invalid"


@pytest.mark.asyncio
async def test_429_classifies_as_valid_rate_limited(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _patched_validator(monkeypatch, lambda _req: _mock_response(429))
    result = await _call_provider_validator(PROVIDER_VALIDATORS["openai"], "k")
    assert result == {"status": "valid", "message": "Valid API key (rate limited)"}


@pytest.mark.asyncio
async def test_provider_specific_invalid_codes_are_respected(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Anthropic should treat 403 as invalid (its registry adds it)."""
    _patched_validator(monkeypatch, lambda _req: _mock_response(403))
    result = await _call_provider_validator(PROVIDER_VALIDATORS["anthropic"], "k")
    assert result["status"] == "invalid"


@pytest.mark.asyncio
async def test_unknown_status_code_classifies_as_invalid_with_code(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _patched_validator(monkeypatch, lambda _req: _mock_response(503))
    result = await _call_provider_validator(PROVIDER_VALIDATORS["openai"], "k")
    assert result["status"] == "invalid"
    assert "503" in result["message"]


# ---------------------------------------------------------------------------
# _call_provider_validator: HTTP request shape
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_get_request_sends_bearer_header(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured: dict[str, Any] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["method"] = request.method
        captured["url"] = str(request.url)
        captured["auth"] = request.headers.get("authorization")
        return _mock_response(200)

    _patched_validator(monkeypatch, handler)
    await _call_provider_validator(PROVIDER_VALIDATORS["openai"], "sk-abc")

    assert captured["method"] == "GET"
    assert captured["url"] == "https://api.openai.com/v1/models"
    assert captured["auth"] == "Bearer sk-abc"


@pytest.mark.asyncio
async def test_post_request_sends_json_body_and_anthropic_headers(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured: dict[str, Any] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["method"] = request.method
        captured["x-api-key"] = request.headers.get("x-api-key")
        captured["anthropic-version"] = request.headers.get("anthropic-version")
        captured["body"] = request.content
        return _mock_response(200)

    _patched_validator(monkeypatch, handler)
    await _call_provider_validator(PROVIDER_VALIDATORS["anthropic"], "ant-xyz")

    assert captured["method"] == "POST"
    assert captured["x-api-key"] == "ant-xyz"
    assert captured["anthropic-version"] == "2023-06-01"
    assert b"claude-3-haiku" in captured["body"]


@pytest.mark.asyncio
async def test_callable_url_is_resolved_with_api_key(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured_url: dict[str, str] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured_url["url"] = str(request.url)
        return _mock_response(200)

    _patched_validator(monkeypatch, handler)
    await _call_provider_validator(PROVIDER_VALIDATORS["gemini"], "g-xyz")

    assert "key=g-xyz" in captured_url["url"]


# ---------------------------------------------------------------------------
# Custom config (additivity)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_custom_provider_validator_works(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Demonstrates how to add a hypothetical 5th provider with one config object.

    This is the documentation contract for adding new providers.
    """
    custom = ProviderValidator(
        url="https://hypothetical.example.com/v1/whoami",
        headers_factory=_bearer_auth,
        invalid_status_codes=(401, 418),
    )

    next_status: dict[str, int] = {"code": 418}
    _patched_validator(monkeypatch, lambda _req: _mock_response(next_status["code"]))

    result = await _call_provider_validator(custom, "k")
    assert result["status"] == "invalid"

    next_status["code"] = 200
    result = await _call_provider_validator(custom, "k")
    assert result["status"] == "valid"
