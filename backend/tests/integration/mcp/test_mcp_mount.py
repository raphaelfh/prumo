"""Mount + guard tests for /mcp (spec §3, §8, task 2a).

Proves the route is an exact Starlette Route (not app.mount, which 307s
POST /mcp to /mcp/), that it answers JSON (not SSE) for a stateless client,
and that the Host/Origin transport-security guard is wired to settings.
"""

import pytest
from httpx import AsyncClient, Response

from app.api.mcp.server import build_mcp_asgi

_HEADERS = {
    "Accept": "application/json, text/event-stream",
    "Content-Type": "application/json",
    "MCP-Protocol-Version": "2025-11-25",
}
_INIT = {
    "protocolVersion": "2025-11-25",
    "capabilities": {},
    "clientInfo": {"name": "pytest", "version": "0"},
}


async def _rpc(
    client: AsyncClient,
    method: str,
    params: dict | None = None,
    headers: dict[str, str] | None = None,
) -> Response:
    body = {"jsonrpc": "2.0", "id": 1, "method": method, "params": params or {}}
    return await client.post("/mcp", json=body, headers={**_HEADERS, **(headers or {})})


async def test_post_mcp_is_not_redirected(mcp_http_client: AsyncClient) -> None:
    r = await _rpc(mcp_http_client, "initialize", _INIT)
    assert not r.is_redirect
    assert r.status_code == 200


async def test_initialize_answers_json_with_server_name(mcp_http_client: AsyncClient) -> None:
    r = await _rpc(mcp_http_client, "initialize", _INIT)
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("application/json")
    assert r.json()["result"]["serverInfo"]["name"] == "prumo"


async def test_tools_list_is_empty_before_any_tool(mcp_http_client: AsyncClient) -> None:
    r = await _rpc(mcp_http_client, "tools/list")
    assert r.status_code == 200
    assert r.json()["result"]["tools"] == []


async def test_wrong_host_is_421(mcp_http_client: AsyncClient) -> None:
    r = await _rpc(mcp_http_client, "initialize", _INIT, headers={"Host": "evil.example"})
    assert r.status_code == 421


async def test_disallowed_origin_is_403_and_absent_origin_passes(
    mcp_http_client: AsyncClient,
) -> None:
    r = await _rpc(mcp_http_client, "initialize", _INIT, headers={"Origin": "https://evil.example"})
    assert r.status_code == 403

    r = await _rpc(mcp_http_client, "initialize", _INIT)
    assert r.status_code == 200


async def test_each_build_has_its_own_manager() -> None:
    _, m1 = build_mcp_asgi()
    _, m2 = build_mcp_asgi()
    assert m1 is not m2

    async with m1.run():
        with pytest.raises(RuntimeError):
            async with m1.run():
                pass

    async with m2.run():
        pass
