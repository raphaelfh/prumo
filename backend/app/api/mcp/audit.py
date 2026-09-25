"""The one audit flow for MCP write tools (spec §6.1): applied rows ride the write's
transaction; a refusal rolls back every write of the call, then persists its row."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, NoReturn
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.api.mcp.asgi_auth import current_principal
from app.api.mcp.errors import AUDITED_CODES, McpToolError
from app.services import agent_action_service


@dataclass(frozen=True, slots=True)
class AuditScope:
    tool: str
    project_id: UUID
    template_id: UUID | None
    input: dict[str, Any]


async def record_applied_write(
    db: AsyncSession, scope: AuditScope, *, before: dict[str, Any], after: dict[str, Any]
) -> None:
    principal = current_principal()
    await agent_action_service.record_applied(
        db,
        token_id=principal.token_id,
        user_id=principal.user_sub,
        project_id=scope.project_id,
        template_id=scope.template_id,
        tool=scope.tool,
        tool_input=scope.input,
        before=before,
        after=after,
    )


async def refuse(db: AsyncSession, scope: AuditScope, error: McpToolError) -> NoReturn:
    await db.rollback()
    if error.code in AUDITED_CODES:
        principal = current_principal()
        await agent_action_service.record_refused(
            db,
            token_id=principal.token_id,
            user_id=principal.user_sub,
            project_id=scope.project_id,
            template_id=scope.template_id,
            tool=scope.tool,
            tool_input=scope.input,
            error_code=error.code.value,
        )
        await db.commit()
    raise error
