"""OAuth discovery for /mcp: RFC 9728 protected-resource metadata, RFC 8414
authorization-server metadata, their rate limit and their CORS (ADR 0022)."""

from __future__ import annotations

import pytest
from httpx import AsyncClient

from app.core.config import Settings
from tests.integration.mcp.conftest import OAUTH_BASE_URL

PRM_PATH = "/.well-known/oauth-protected-resource/mcp"
AS_METADATA_PATH = "/.well-known/oauth-authorization-server"
PREFLIGHT = {
    "Origin": "https://unlisted.example",
    "Access-Control-Request-Method": "GET",
}


async def test_prm_document(oauth_http_client: AsyncClient) -> None:
    r = await oauth_http_client.get(PRM_PATH)
    assert r.status_code == 200
    body = r.json()
    assert body["resource"] == OAUTH_BASE_URL + "/mcp"
    assert body["scopes_supported"] == ["read", "write"]
    assert body["bearer_methods_supported"] == ["header"]


async def test_as_metadata_document(oauth_http_client: AsyncClient) -> None:
    r = await oauth_http_client.get(AS_METADATA_PATH)
    assert r.status_code == 200
    body = r.json()
    assert body["code_challenge_methods_supported"] == ["S256"]
    assert body["grant_types_supported"] == ["authorization_code", "refresh_token"]
    assert body["response_types_supported"] == ["code"]
    assert body["token_endpoint_auth_methods_supported"] == ["none"]
    assert body["revocation_endpoint_auth_methods_supported"] == ["none"]
    assert body["scopes_supported"] == ["read", "write", "offline_access"]
    assert body["authorization_endpoint"] == OAUTH_BASE_URL + "/authorize"
    assert body["token_endpoint"] == OAUTH_BASE_URL + "/token"
    assert body["registration_endpoint"] == OAUTH_BASE_URL + "/register"
    assert body["revocation_endpoint"] == OAUTH_BASE_URL + "/revoke"


async def test_prm_issuer_matches_as_metadata_issuer(oauth_http_client: AsyncClient) -> None:
    prm = (await oauth_http_client.get(PRM_PATH)).json()
    as_meta = (await oauth_http_client.get(AS_METADATA_PATH)).json()
    assert prm["authorization_servers"] == [as_meta["issuer"]]
    assert as_meta["issuer"].rstrip("/") == OAUTH_BASE_URL


async def test_metadata_is_404_when_oauth_off(mcp_http_client: AsyncClient) -> None:
    for path in (PRM_PATH, AS_METADATA_PATH):
        r = await mcp_http_client.get(path)
        assert r.status_code == 404, path


@pytest.mark.parametrize("path", [PRM_PATH, AS_METADATA_PATH], ids=["prm", "as-metadata"])
async def test_metadata_over_ip_limit_is_429(oauth_http_client: AsyncClient, path: str) -> None:
    statuses = [(await oauth_http_client.get(path)).status_code for _ in range(60)]
    assert statuses == [200] * 60

    r = await oauth_http_client.get(path)
    assert r.status_code == 429
    assert int(r.headers["retry-after"]) >= 1


async def test_preflights_are_not_counted(oauth_http_client: AsyncClient) -> None:
    for _ in range(70):
        await oauth_http_client.options(AS_METADATA_PATH, headers=PREFLIGHT)

    r = await oauth_http_client.get(AS_METADATA_PATH)
    assert r.status_code == 200


async def test_preflight_from_unlisted_origin(oauth_http_client: AsyncClient) -> None:
    for path in (AS_METADATA_PATH, PRM_PATH):
        r = await oauth_http_client.options(path, headers=PREFLIGHT)
        assert r.headers.get("access-control-allow-origin") == "*", path
        assert "access-control-allow-credentials" not in r.headers, path

    for path in ("/api/v1/me/tokens", "/mcp"):
        r = await oauth_http_client.options(path, headers=PREFLIGHT)
        assert r.headers.get("access-control-allow-origin") != "*", path


@pytest.mark.parametrize(
    ("value", "enabled"),
    [(None, False), ("", False), ("  ", False), ("http://localhost:8000/", True)],
    ids=["none", "empty", "blank", "trailing-slash"],
)
def test_settings_fail_closed(value: str | None, enabled: bool) -> None:
    built = Settings(PUBLIC_API_URL=value)  # type: ignore[call-arg]
    assert built.oauth_enabled is enabled
    if enabled:
        assert built.public_api_url == "http://localhost:8000"
        assert built.mcp_resource_url == "http://localhost:8000/mcp"
    else:
        with pytest.raises(RuntimeError):
            _ = built.public_api_url


async def test_authorize_and_register_are_404_when_oauth_off(mcp_http_client: AsyncClient) -> None:
    assert (await mcp_http_client.get("/authorize")).status_code == 404
    assert (await mcp_http_client.post("/register", json={})).status_code == 404


async def test_register_preflight_from_unlisted_origin(oauth_http_client: AsyncClient) -> None:
    preflight = {**PREFLIGHT, "Access-Control-Request-Method": "POST"}
    r = await oauth_http_client.options("/register", headers=preflight)
    assert r.headers.get("access-control-allow-origin") == "*"
    assert "access-control-allow-credentials" not in r.headers
