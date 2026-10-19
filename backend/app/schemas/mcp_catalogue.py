"""Result model of the researcher MCP `list_template_catalogue` tool: its
exact `outputSchema`."""

from __future__ import annotations

from typing import Literal
from uuid import UUID

from pydantic import BaseModel

from app.schemas.extraction import InstrumentCode
from app.schemas.template_catalogue import TemplateKindLiteral


class McpCatalogueRow(BaseModel):
    global_template_id: UUID
    name: str
    description: str | None
    instrument: InstrumentCode
    entity_types_count: int
    already_in_project: bool


class McpTemplateCatalogue(BaseModel):
    project_id: UUID
    project_name: str
    kind: TemplateKindLiteral
    rows: list[McpCatalogueRow]
    note: str | None
    next_step: str
    untrusted_content: Literal[True] = True
    untrusted_fields: list[str] = ["project_name", "rows[].name", "rows[].description"]
