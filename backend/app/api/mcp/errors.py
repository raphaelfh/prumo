"""The §7 MCP error contract: codes, retryability, next steps, exception mapping.

These codes never reach the REST envelope (``app/core/error_handler.py``);
they are the MCP tool-call error shape only. ``to_tool_error`` maps ONLY
pass-through ``McpToolError``, the five not-found classes, and everything
else -> ``INTERNAL_ERROR``: every audited code (``INVALID_ARGUMENT``,
``DRAFT_LOCK_HELD``, ``NO_PUBLISHED_VERSION``, ``DUPLICATE_NAME``,
``RETRY``, …) is mapped once, in the write tool next to its audit row
(Tasks 9/10b) — a copy here would be unreachable or would return an
audited code with no row. A stray ``pydantic.ValidationError`` is a server
bug and is logged as ``INTERNAL_ERROR``, never reported as the caller's
``INVALID_ARGUMENT`` with no audit row.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from typing import Any

from mcp.types import CallToolResult, TextContent

from app.api.mcp.result_json import compact_json
from app.schemas.mcp_errors import McpToolErrorPayload
from app.services.article_read_service import ArticleNotFoundError
from app.services.article_text_block_read_service import ArticleFileNotFoundError
from app.services.project_template_active_service import ProjectTemplateNotFoundError
from app.services.template_field_service import EntityTypeNotFoundError, FieldNotFoundError


class McpErrorCode(StrEnum):
    NOT_FOUND = "NOT_FOUND"
    MANAGER_REQUIRED = "MANAGER_REQUIRED"
    SCOPE_INSUFFICIENT = "SCOPE_INSUFFICIENT"
    INVALID_ARGUMENT = "INVALID_ARGUMENT"
    DRAFT_LOCK_HELD = "DRAFT_LOCK_HELD"
    NARROW_BASELINE = "NARROW_BASELINE"
    NO_PUBLISHED_VERSION = "NO_PUBLISHED_VERSION"
    OP_NOT_ALLOWED_VIA_AGENT = "OP_NOT_ALLOWED_VIA_AGENT"
    TOO_MANY_OPS = "TOO_MANY_OPS"
    FIELD_NOT_EDITABLE = "FIELD_NOT_EDITABLE"
    STALE_VALUE = "STALE_VALUE"
    DUPLICATE_NAME = "DUPLICATE_NAME"
    RETRY = "RETRY"
    RATE_LIMITED = "RATE_LIMITED"
    INTERNAL_ERROR = "INTERNAL_ERROR"


NOT_FOUND_MESSAGE = "Not found, or not in a project this token's user belongs to."


@dataclass(frozen=True, slots=True)
class _CodeSpec:
    retryable: bool
    next_step: str


_SPECS: dict[McpErrorCode, _CodeSpec] = {  # one entry per code; next_step text from spec §7
    McpErrorCode.NOT_FOUND: _CodeSpec(False, "call list_projects / list_articles"),
    McpErrorCode.MANAGER_REQUIRED: _CodeSpec(False, "ask a project manager"),
    McpErrorCode.SCOPE_INSUFFICIENT: _CodeSpec(False, "use a read_write token"),
    McpErrorCode.INVALID_ARGUMENT: _CodeSpec(False, "fix that argument and resend"),
    McpErrorCode.DRAFT_LOCK_HELD: _CodeSpec(
        False, "tell the user who holds the draft; do not retry"
    ),
    McpErrorCode.NARROW_BASELINE: _CodeSpec(False, "publish once in prumo, then retry"),
    McpErrorCode.NO_PUBLISHED_VERSION: _CodeSpec(
        False, "a manager must publish the template once in prumo"
    ),
    McpErrorCode.OP_NOT_ALLOWED_VIA_AGENT: _CodeSpec(False, "do this in the prumo UI"),
    McpErrorCode.TOO_MANY_OPS: _CodeSpec(False, "split into calls of ≤ 25 ops"),
    McpErrorCode.FIELD_NOT_EDITABLE: _CodeSpec(
        False, "edit only the editable fields listed in this error"
    ),
    McpErrorCode.STALE_VALUE: _CodeSpec(
        False, "re-read the current values (included) and confirm with the user"
    ),
    McpErrorCode.DUPLICATE_NAME: _CodeSpec(
        True, "call get_template, then resend; the server re-derives the name"
    ),
    McpErrorCode.RETRY: _CodeSpec(True, "call get_template to check state before resending"),
    McpErrorCode.RATE_LIMITED: _CodeSpec(True, "wait retry_after_seconds, then retry"),
    McpErrorCode.INTERNAL_ERROR: _CodeSpec(
        False, "the error was logged; tell the user and do not retry blindly"
    ),
}


class McpToolError(Exception):
    """A tool-facing error: code + message + per-code extras (spec §7)."""

    def __init__(self, code: McpErrorCode, message: str, **extras: Any) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.extras = extras


def to_tool_error(exc: BaseException) -> McpToolError:
    if isinstance(exc, McpToolError):
        return exc
    if isinstance(
        exc,
        (
            ArticleNotFoundError,
            ArticleFileNotFoundError,
            ProjectTemplateNotFoundError,
            EntityTypeNotFoundError,
            FieldNotFoundError,
        ),
    ):
        return McpToolError(McpErrorCode.NOT_FOUND, NOT_FOUND_MESSAGE)
    return McpToolError(McpErrorCode.INTERNAL_ERROR, "Internal error.")


def error_result(err: McpToolError) -> CallToolResult:
    spec = _SPECS[err.code]
    payload = McpToolErrorPayload(
        code=err.code.value,
        message=err.message,
        retryable=spec.retryable,
        next_step=spec.next_step,
        **err.extras,
    ).model_dump(mode="json")
    return CallToolResult(
        content=[TextContent(type="text", text=compact_json(payload))],
        structured_content=payload,
        is_error=True,
    )
