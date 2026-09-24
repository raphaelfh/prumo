"""JSON-RPC helper shared by the /mcp integration tests (spec §3, §8)."""

from __future__ import annotations

from httpx import AsyncClient, Response

RPC_HEADERS = {
    "Accept": "application/json, text/event-stream",
    "Content-Type": "application/json",
    "MCP-Protocol-Version": "2025-11-25",
}
INIT_PARAMS = {
    "protocolVersion": "2025-11-25",
    "capabilities": {},
    "clientInfo": {"name": "pytest", "version": "0"},
}


async def rpc(
    client: AsyncClient,
    method: str,
    params: dict | None = None,
    headers: dict[str, str] | None = None,
) -> Response:
    body = {"jsonrpc": "2.0", "id": 1, "method": method, "params": params or {}}
    return await client.post("/mcp", json=body, headers={**RPC_HEADERS, **(headers or {})})
