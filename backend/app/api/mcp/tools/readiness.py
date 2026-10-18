"""get_setup_readiness: what stands between a project and a useful AI run.

The tool resolves the caller's manager role and passes it to the service:
draft items (open drafts, draft-tree lint) are manager-only, as the draft
views of get_template are.
"""

from __future__ import annotations

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps.security import is_project_manager
from app.api.mcp.asgi_auth import current_principal
from app.api.mcp.server import agent_tool
from app.schemas.mcp_readiness import McpSetupReadiness
from app.services.project_setup_readiness import build_setup_readiness


@agent_tool(
    requires="read",
    project_arg="project_id",
    title="Get setup readiness",
    destructive=False,
    description=(
        "Call this first when configuring a project for AI extraction. Returns what "
        "blocks or weakens an AI run: review-question gaps, missing or unpublished "
        "templates and questionnaire problems. Each item has `status` (block or warn), "
        "an optional `subject` (the template it concerns), a `message` and a `next_step` "
        "naming the tool or prumo page that fixes it; `tree` tells whether a "
        "questionnaire problem is in the published version or the draft. `summary.ok` "
        "is true when nothing blocks. Draft items are shown to managers only "
        "(`draft_detail_hidden` is true otherwise). There is no publish tool: a manager "
        "publishes a draft in prumo."
    ),
)
async def get_setup_readiness(db: AsyncSession, project_id: UUID) -> McpSetupReadiness:
    is_manager = await is_project_manager(db, project_id, current_principal().user_sub)
    return await build_setup_readiness(db, project_id=project_id, is_manager=is_manager)
