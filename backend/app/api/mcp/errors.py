"""The §7 MCP error contract: codes, retryability, next steps, exception mapping.

These codes never reach the REST envelope (``app/core/error_handler.py``);
they are the MCP tool-call error shape only. ``to_tool_error`` maps ONLY
pass-through ``McpToolError``, the not-found classes (the five tool
guards' own plus the app-wide ``NotFoundError``), and everything
else -> ``INTERNAL_ERROR``: every audited code (``INVALID_ARGUMENT``,
``DRAFT_LOCK_HELD``, ``NO_PUBLISHED_VERSION``, ``DUPLICATE_NAME``,
``RETRY``, …) is mapped once, in the write tool next to its audit row
(Tasks 9/10b) — a copy here would be unreachable or would return an
audited code with no row. A stray ``pydantic.ValidationError`` is a server
bug and is logged as ``INTERNAL_ERROR``, never reported as the caller's
``INVALID_ARGUMENT`` with no audit row.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from enum import StrEnum
from typing import Any

from mcp.types import CallToolResult, TextContent

from app.core.error_handler import NotFoundError
from app.schemas.mcp_errors import McpToolErrorPayload
from app.services.article_read_service import ArticleNotFoundError
from app.services.article_text_block_read_service import ArticleFileNotFoundError
from app.services.project_template_active_service import ProjectTemplateNotFoundError
from app.services.template_field_service import EntityTypeNotFoundError, FieldNotFoundError
from app.utils.compact_json import compact_json
from app.utils.text_caps import cap_text


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


AUDITED_CODES: frozenset[McpErrorCode] = frozenset(
    {
        McpErrorCode.INVALID_ARGUMENT,
        McpErrorCode.DRAFT_LOCK_HELD,
        McpErrorCode.NARROW_BASELINE,
        McpErrorCode.NO_PUBLISHED_VERSION,
        McpErrorCode.OP_NOT_ALLOWED_VIA_AGENT,
        McpErrorCode.TOO_MANY_OPS,
        McpErrorCode.FIELD_NOT_EDITABLE,
        McpErrorCode.STALE_VALUE,
        McpErrorCode.DUPLICATE_NAME,
        McpErrorCode.RETRY,
    }
)
"""Codes whose refusal writes one ``agent_actions`` row (spec §6.1/§7). The rest are
access refusals, rate limits or unknown session state: a log span only."""


class McpToolError(Exception):
    """A tool-facing error: code + message + per-code extras (spec §7)."""

    def __init__(self, code: McpErrorCode, message: str, **extras: Any) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        if isinstance(extras.get("field"), str):
            extras["field"] = _safe_field(extras["field"])
        self.extras = extras


def _safe_field(field: str) -> str:
    """`field` names a caller-supplied key path: echo it with NUL spelled
    out (the payload must not carry the character it may be refusing) and
    capped, so an unbounded key cannot bloat the error."""
    return cap_text(field.replace("\x00", "\\u0000"))[0]


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
            NotFoundError,  # app-wide, e.g. a project deleted mid-call
        ),
    ):
        return McpToolError(McpErrorCode.NOT_FOUND, NOT_FOUND_MESSAGE)
    return McpToolError(McpErrorCode.INTERNAL_ERROR, "Internal error.")


def _nul_path(value: Any, path: tuple[str | int, ...] = ()) -> tuple[str | int, ...] | None:
    """Where the first U+0000 sits in a tool argument tree, or ``None``.

    Postgres ``text``/``jsonb`` cannot store it, so a NUL that reached SQL
    would surface as an INTERNAL_ERROR instead of the caller's mistake."""
    if isinstance(value, str):
        return path if "\x00" in value else None
    if isinstance(value, Mapping):
        for key, item in value.items():
            found = _nul_path(key, (*path, key))
            if found is None:
                found = _nul_path(item, (*path, key))
            if found is not None:
                return found
    elif isinstance(value, list | tuple):
        for index, item in enumerate(value):
            found = _nul_path(item, (*path, index))
            if found is not None:
                return found
    return None


def reject_nul(arguments: Mapping[str, Any], **extras: Any) -> None:
    """INVALID_ARGUMENT naming the dotted path of the first NUL-bearing string
    (``extras`` ride along, e.g. a write op's ``op_index``). The dispatcher
    calls it for read tools; a write tool calls it inside its audited try."""
    found = _nul_path(arguments)
    if found is not None:
        raise McpToolError(
            McpErrorCode.INVALID_ARGUMENT,
            "Strings must not contain the NUL character (U+0000).",
            field=".".join(str(part) for part in found),
            **extras,
        )


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
