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
``INVALID_ARGUMENT`` with no audit row. A caller's own pydantic failure is
rendered by ``validation_failure`` -- the one place that turns one into
``INVALID_ARGUMENT`` (the SDK's argument check, and the write tools' op/field
parsing).
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from enum import StrEnum
from typing import Any

from mcp.types import CallToolResult, TextContent
from pydantic import ValidationError

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
    REVIEWER_REQUIRED = "REVIEWER_REQUIRED"
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
    IN_USE = "IN_USE"
    STRUCTURE_CONFLICT = "STRUCTURE_CONFLICT"
    RETRY = "RETRY"
    RATE_LIMITED = "RATE_LIMITED"
    INTERNAL_ERROR = "INTERNAL_ERROR"
    AI_RUNS_NOT_ALLOWED = "AI_RUNS_NOT_ALLOWED"
    PLAN_STALE = "PLAN_STALE"
    AI_NOT_CONFIGURED = "AI_NOT_CONFIGURED"
    AI_RUN_ACTIVE = "AI_RUN_ACTIVE"
    AI_RUN_LIMIT = "AI_RUN_LIMIT"
    SERVICE_UNAVAILABLE = "SERVICE_UNAVAILABLE"


NOT_FOUND_MESSAGE = "Not found, or not in a project this token's user belongs to."


@dataclass(frozen=True, slots=True)
class _CodeSpec:
    retryable: bool
    next_step: str


_SPECS: dict[McpErrorCode, _CodeSpec] = {  # one entry per code; next_step text from spec §7
    McpErrorCode.NOT_FOUND: _CodeSpec(False, "call list_projects / list_articles"),
    McpErrorCode.MANAGER_REQUIRED: _CodeSpec(False, "ask a project manager"),
    McpErrorCode.REVIEWER_REQUIRED: _CodeSpec(False, "ask a project manager for the reviewer role"),
    McpErrorCode.SCOPE_INSUFFICIENT: _CodeSpec(
        False,
        "this token lacks required_scope; a token with that access is created by the researcher "
        "in prumo Settings → Integrations",
    ),
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
    McpErrorCode.IN_USE: _CodeSpec(
        False,
        "the question or section holds recorded data; tell the user, it can only change in "
        "prumo after that data is handled",
    ),
    McpErrorCode.STRUCTURE_CONFLICT: _CodeSpec(
        False, "read get_template(view='draft'), fix the structure named by rule, and resend"
    ),
    McpErrorCode.RETRY: _CodeSpec(True, "call get_template to check state before resending"),
    McpErrorCode.RATE_LIMITED: _CodeSpec(True, "wait retry_after_seconds, then retry"),
    McpErrorCode.INTERNAL_ERROR: _CodeSpec(
        False, "the error was logged; tell the user and do not retry blindly"
    ),
    McpErrorCode.AI_RUNS_NOT_ALLOWED: _CodeSpec(
        False, "a project manager can allow agent runs in prumo Settings → AI engine"
    ),
    McpErrorCode.PLAN_STALE: _CodeSpec(
        False, "call plan_ai_run again, show the new confirmation and get a fresh yes"
    ),
    McpErrorCode.AI_NOT_CONFIGURED: _CodeSpec(False, "configure the AI engine or a key in prumo"),
    McpErrorCode.AI_RUN_ACTIVE: _CodeSpec(False, "check it with get_ai_runs"),
    McpErrorCode.AI_RUN_LIMIT: _CodeSpec(False, "run fewer articles, or wait for the window"),
    McpErrorCode.SERVICE_UNAVAILABLE: _CodeSpec(True, "try again in a few minutes"),
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
        McpErrorCode.IN_USE,
        McpErrorCode.STRUCTURE_CONFLICT,
        McpErrorCode.RETRY,
        McpErrorCode.AI_RUNS_NOT_ALLOWED,
        McpErrorCode.PLAN_STALE,
        McpErrorCode.AI_NOT_CONFIGURED,
        McpErrorCode.AI_RUN_ACTIVE,
        McpErrorCode.AI_RUN_LIMIT,
    }
)
"""Codes whose refusal writes one ``agent_actions`` row (spec §6.1/§7). The rest are
access refusals, rate limits or unknown session state: a log span only."""


class McpToolError(Exception):
    """A tool-facing error: code + message + per-code extras (spec §7)."""

    def __init__(
        self, code: McpErrorCode, message: str, *, next_step: str | None = None, **extras: Any
    ) -> None:
        """``next_step`` replaces the code's default when one code covers
        cases that call for different follow-ups."""
        super().__init__(message)
        self.code = code
        self.message = message
        self.next_step = next_step
        if isinstance(extras.get("field"), str):
            extras["field"] = _safe_field(extras["field"])
        self.extras = extras


def with_names(
    error: McpToolError, *, project_name: str, template_name: str | None = None
) -> McpToolError:
    """``error`` naming the project (and template) it refused on, so the agent
    can tell the user without another call. Only for refusals raised AFTER the
    choke point proved membership; ``NOT_FOUND`` comes back untouched, so a
    foreign resource stays byte-identical to a missing one. The names are
    user-entered text: capped and declared in ``untrusted_fields``."""
    if error.code is McpErrorCode.NOT_FOUND:
        return error
    names = {"project_name": project_name}
    if template_name is not None:
        names["template_name"] = template_name
    error.extras.update({key: cap_text(value)[0] for key, value in names.items()})
    error.extras["untrusted_content"] = True
    error.extras["untrusted_fields"] = [*error.extras.get("untrusted_fields", []), *names]
    return error


def _safe_field(field: str) -> str:
    """`field` names a caller-supplied key path: echo it with NUL spelled
    out (the payload must not carry the character it may be refusing) and
    capped, so an unbounded key cannot bloat the error."""
    return cap_text(field.replace("\x00", "\\u0000"))[0]


_PYDANTIC_PREFIXES = ("Value error, ", "Assertion failed, ")


def validation_failure(exc: ValidationError, *, prefix: str = "", **extras: Any) -> McpToolError:
    """THE MCP rendering of a pydantic failure: first error, dotted field, no library text.

    ``field`` is ``prefix`` joined to the first error's loc; a root-level error
    (empty loc, no prefix) carries no ``field``."""
    first = exc.errors(include_url=False)[0]
    field = ".".join(str(part) for part in (prefix, *first["loc"]) if part != "")
    message = first["msg"]
    for p in _PYDANTIC_PREFIXES:
        message = message.removeprefix(p)
    if field:
        extras["field"] = field  # McpToolError escapes and caps it (_safe_field)
    return McpToolError(McpErrorCode.INVALID_ARGUMENT, message, **extras)


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
        next_step=err.next_step or spec.next_step,
        **err.extras,
    ).model_dump(mode="json")
    return CallToolResult(
        content=[TextContent(type="text", text=compact_json(payload))],
        structured_content=payload,
        is_error=True,
    )
