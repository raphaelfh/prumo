"""list_projects / get_project: the first two researcher MCP tools (task 6a).

Both are read-only and never build their own errors beyond the NOT_FOUND
raised when the row vanishes between the choke point's membership check and
this read; every other check already ran in `_dispatch`.
"""

from __future__ import annotations

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.api.mcp.asgi_auth import current_principal
from app.api.mcp.errors import NOT_FOUND_MESSAGE, McpErrorCode, McpToolError
from app.api.mcp.server import agent_tool
from app.schemas.mcp_projects import McpProjectList, McpProjectOverview
from app.services import project_read_service
from app.services.profile_names import profile_names


@agent_tool(
    requires="read",
    project_arg=None,
    title="List projects",
    description=(
        "List the systematic-review projects this token's user belongs to, with the "
        "caller's role in each, plus the token's scope and expiry. Call get_project next."
    ),
)
async def list_projects(db: AsyncSession) -> McpProjectList:
    principal = current_principal()
    rows = await project_read_service.list_projects_for_user(db, user_id=principal.user_sub)
    names = await profile_names(db, {principal.user_sub})
    return McpProjectList(
        projects=rows,
        caller_name=names.get(principal.user_sub),
        token_scope=principal.scope,
        token_expires_at=principal.token_expires_at,
        note=None if rows else "This token's user belongs to no project.",
    )


@agent_tool(
    requires="read",
    project_arg="project_id",
    title="Get project",
    description=(
        "Return a project's descriptive fields, article counts and templates "
        "(id, kind, active, narrow). Call list_articles or get_template next."
    ),
)
async def get_project(db: AsyncSession, project_id: UUID) -> McpProjectOverview:
    principal = current_principal()
    overview = await project_read_service.get_project_overview(
        db, project_id=project_id, user_id=principal.user_sub
    )
    if overview is None:  # removed between the choke point and this read
        raise McpToolError(McpErrorCode.NOT_FOUND, NOT_FOUND_MESSAGE)
    return overview
