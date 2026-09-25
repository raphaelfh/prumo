"""update_project_details: the first researcher MCP write tool (task 9, spec §5.2).

Edits the 11 whitelisted descriptive columns of a project through the same
`project_details_service.update_details` the Settings UI uses, behind an
`expected` precondition (canonical JSON equality against the caller's last
read). One `agent_actions` row per applied write or audited domain refusal
(`app.api.mcp.audit`); the tool owns the transaction and commits once.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from pydantic import ValidationError
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.mcp.audit import AuditScope, record_applied_write, refuse
from app.api.mcp.errors import McpErrorCode, McpToolError, reject_nul
from app.api.mcp.server import agent_tool
from app.api.v1.endpoints._integrity import is_deadlock
from app.schemas.mcp_project_details import UpdateProjectDetailsResult
from app.schemas.project_details import ProjectDetailsFields
from app.services import project_details_service

_TOOL = "update_project_details"
_REVIEW_TYPE_NOTE = (
    "review_type feeds the AI review question; it affects only runs started after this edit"
)
_EDITABLE = sorted(ProjectDetailsFields.model_fields)
_DESCRIPTION = (
    "Edit a project's descriptive fields (name, description, review type and the other "
    "whitelisted columns from get_project). `expected` must carry the value of each field "
    "in `fields` exactly as last read via get_project -- the write is refused if any of "
    "them changed meanwhile. Clients that support it (e.g. Claude Code) ask the human "
    "before each call, and every change is audited. Returns the before/after values of "
    "the changed fields; call get_project next to confirm."
)


@agent_tool(
    requires="write",
    project_arg="project_id",
    title="Update project details",
    description=_DESCRIPTION,
    destructive=True,
    idempotent=True,
    meta={"anthropic/requiresUserInteraction": True},
)
async def update_project_details(
    db: AsyncSession, project_id: UUID, fields: dict[str, Any], expected: dict[str, Any]
) -> UpdateProjectDetailsResult:
    scope = AuditScope(
        tool=_TOOL,
        project_id=project_id,
        template_id=None,
        input={"project_id": str(project_id), "fields": fields, "expected": expected},
    )
    try:
        parsed_fields, parsed_expected = _parse(fields, expected)
        change = await project_details_service.update_details(
            db, project_id=project_id, fields=parsed_fields, expected=parsed_expected
        )
        await record_applied_write(db, scope, before=change.before, after=change.after)
        await db.commit()  # inside the try: a deadlock here is an audited RETRY too
    except McpToolError as error:
        await refuse(db, scope, error)
    except project_details_service.StaleProjectValueError as exc:
        await refuse(
            db,
            scope,
            McpToolError(
                McpErrorCode.STALE_VALUE,
                "A field changed since it was read.",
                current=(exc.details or {})["current"],
            ),
        )
    except DBAPIError as exc:
        if not is_deadlock(exc):
            raise  # INTERNAL_ERROR via the dispatcher: logged, no row
        await refuse(
            db,
            scope,
            McpToolError(McpErrorCode.RETRY, "A concurrent write won; nothing was changed."),
        )
    return UpdateProjectDetailsResult(
        project_id=project_id,
        before=change.before,
        after=change.after,
        note=_REVIEW_TYPE_NOTE if "review_type" in fields else None,
    )


def _parse(
    fields: dict[str, Any], expected: dict[str, Any]
) -> tuple[ProjectDetailsFields, ProjectDetailsFields]:
    # Order: NUL, whitelist (FIELD_NOT_EDITABLE), presence, types (INVALID_ARGUMENT).
    reject_nul({"fields": fields, "expected": expected})
    for key in sorted({*fields, *expected}):
        if key not in ProjectDetailsFields.model_fields:
            raise McpToolError(
                McpErrorCode.FIELD_NOT_EDITABLE,
                f"{key} is not editable via the agent.",
                field=key,
                editable_fields=_EDITABLE,
            )
    if not fields:
        raise McpToolError(
            McpErrorCode.INVALID_ARGUMENT,
            "fields must name at least one editable field.",
            field="fields",
        )
    for key in sorted(fields):
        if key not in expected:
            raise McpToolError(
                McpErrorCode.INVALID_ARGUMENT,
                "expected must carry the prior value of every key in fields.",
                field=f"expected.{key}",
            )
    return _validated(fields, prefix=""), _validated(
        {k: expected[k] for k in fields}, prefix="expected."
    )


def _validated(raw: dict[str, Any], *, prefix: str) -> ProjectDetailsFields:
    try:
        return ProjectDetailsFields.model_validate(raw)
    except ValidationError as exc:
        first = exc.errors()[0]
        loc = ".".join(str(part) for part in first["loc"]) or "fields"
        raise McpToolError(
            McpErrorCode.INVALID_ARGUMENT, first["msg"], field=f"{prefix}{loc}"
        ) from exc
