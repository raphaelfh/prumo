"""Result models for the researcher MCP `get_template` tool (task 8a). Each
is the exact `outputSchema` of its tool: no field beyond what the model
needs."""

from __future__ import annotations

from typing import Literal
from uuid import UUID

from pydantic import BaseModel


class McpTemplateQuestion(BaseModel):
    field_id: UUID
    name: str
    label: str
    description: str | None
    type: str
    options: list[str] | None
    instructions: str | None
    required: bool


class McpTemplateSection(BaseModel):
    section_id: UUID
    name: str
    label: str
    parent_section_id: UUID | None
    cardinality: str
    continued: bool
    questions: list[McpTemplateQuestion]


class McpDraftChange(BaseModel):
    tier: str
    variant: str
    label_path: list[str]
    attribute: str | None
    before: str | None
    after: str | None


class McpDraftDiff(BaseModel):
    status: str
    counts: dict[str, int]
    changes: list[McpDraftChange]
    changes_truncated: bool


class McpTemplateView(BaseModel):
    template_id: UUID
    name: str
    kind: str
    published_version: int | None
    narrow: bool | None
    draft_open: bool | None
    sections: list[McpTemplateSection]
    draft_diff: McpDraftDiff | None
    next_cursor: str | None
    untrusted_content: Literal[True] = True
    untrusted_fields: list[str] = [
        "name",
        "sections[].name",
        "sections[].label",
        "sections[].questions[].name",
        "sections[].questions[].label",
        "sections[].questions[].description",
        "sections[].questions[].options[]",
        "sections[].questions[].instructions",
        "draft_diff.changes[].label_path[]",
        "draft_diff.changes[].before",
        "draft_diff.changes[].after",
    ]
