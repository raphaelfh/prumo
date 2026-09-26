"""The MCP tool-error payload shape (spec §7)."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict


class McpToolErrorPayload(BaseModel):
    """The ``structuredContent`` / text-copy body of an error ``CallToolResult``.

    Per-code extras (``holder_name``, ``field``, ``op_index``, ``current``,
    ``retry_after_seconds``, …) ride as extra keys — ``extra="allow"``.
    """

    model_config = ConfigDict(extra="allow")

    code: str
    message: str
    retryable: bool
    next_step: str
