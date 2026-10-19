"""list_template_catalogue: the global templates a manager could import.

Import stays human-only: the result points at the template editor in prumo.
"""

from __future__ import annotations

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.api.mcp.server import agent_tool
from app.schemas.mcp_catalogue import McpCatalogueRow, McpTemplateCatalogue
from app.schemas.template_catalogue import TemplateKindLiteral
from app.services.project_read_service import project_name
from app.services.template_catalogue_service import list_catalogue_for_project
from app.utils.app_urls import editor_url
from app.utils.text_caps import cap_text

_EMPTY_NOTE = "No global templates of this kind."


@agent_tool(
    requires="read",
    project_arg="project_id",
    title="List template catalogue",
    destructive=False,
    description=(
        "List the global templates of one kind (extraction or quality_assessment) that a "
        "manager can import into the project, with each one's instrument code and whether "
        "the project already has a template imported from it. There is no clone or import "
        "tool: a manager imports a template in prumo."
    ),
)
async def list_template_catalogue(
    db: AsyncSession, project_id: UUID, kind: TemplateKindLiteral
) -> McpTemplateCatalogue:
    rows = await list_catalogue_for_project(db, project_id=project_id, kind=kind)
    return McpTemplateCatalogue(
        project_id=project_id,
        project_name=cap_text(await project_name(db, project_id))[0],
        kind=kind,
        rows=[
            McpCatalogueRow(
                global_template_id=row.id,
                name=row.name,
                description=row.description,
                instrument=row.instrument,
                entity_types_count=row.entity_types_count,
                already_in_project=imported,
            )
            for row, imported in rows
        ],
        note=None if rows else _EMPTY_NOTE,
        next_step=(
            f"A manager imports a template in prumo at {editor_url(project_id, kind)}. "
            "Importing publishes version 1 and, for extraction, replaces the active template."
        ),
    )
