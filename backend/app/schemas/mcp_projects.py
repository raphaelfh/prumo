"""Result models for the researcher MCP project read tools (`list_projects`,
`get_project`, task 6a). Each is the exact `outputSchema` of its tool: no
field beyond what the model needs."""

from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel

from app.schemas.project_details import ProjectDetailsValues

ProjectRoleValue = Literal[
    "manager", "reviewer", "viewer", "consensus"
]  # pinned to the PG enum by a test


class McpProjectListItem(BaseModel):
    project_id: UUID
    name: str
    role: ProjectRoleValue
    is_active: bool


class McpProjectList(BaseModel):
    projects: list[McpProjectListItem]
    caller_name: str | None
    token_scope: Literal["read", "read_write"]
    token_expires_at: datetime
    note: str | None = None


class McpProjectCounts(BaseModel):
    articles: int
    articles_with_text: int


class McpTemplateSummary(BaseModel):
    template_id: UUID
    name: str
    kind: str
    is_active: bool
    published_version: int | None
    narrow: bool | None


class McpProjectOverview(BaseModel):
    project_id: UUID
    role: ProjectRoleValue
    is_active: bool
    details: ProjectDetailsValues  # typed outputSchema; never truncated (update_project_details needs exact `expected`)
    counts: McpProjectCounts
    templates: list[McpTemplateSummary]
