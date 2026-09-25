"""Helpers over the SDK in-memory client for MCP tool-logic tests."""

from __future__ import annotations

from typing import Any

from mcp.types import CallToolResult


async def call_tool(
    mcp_client: Any, pat: Any, name: str, arguments: dict[str, Any]
) -> CallToolResult:
    """One tool call as the PAT's user (in-process, so coverage registers)."""
    async with mcp_client(pat) as client:
        return await client.call_tool(name, arguments)


def structured(result: CallToolResult) -> dict[str, Any]:
    assert not result.is_error, result
    assert result.structured_content is not None
    return result.structured_content


def error_payload(result: CallToolResult) -> dict[str, Any]:
    """The §7 error body: {code, message, retryable, next_step, ...extras}."""
    assert result.is_error, result
    return result.structured_content
