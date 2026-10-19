"""Result models for the researcher MCP `get_template` tool (task 8a). Each
is the exact `outputSchema` of its tool: no field beyond what the model
needs. `McpDraftDiff` is also `edit_template_draft`'s `diff`."""

from __future__ import annotations

from typing import Literal
from uuid import UUID

from pydantic import BaseModel

from app.schemas.extraction import InstrumentCode
from app.schemas.template_lint import LintFinding


class McpOption(BaseModel):
    value: str
    label: str


class McpTemplateQuestion(BaseModel):
    field_id: UUID
    name: str
    label: str
    description: str | None
    type: str
    options: list[McpOption] | None
    instructions: str | None
    unit: str | None
    allowed_units: list[str] | None
    flags: list[str]


class McpTemplateSection(BaseModel):
    section_id: UUID
    name: str
    label: str
    description: str | None
    entry_label: str | None
    required: bool
    parent_section_id: UUID | None
    cardinality: str
    continued: bool
    questions: list[McpTemplateQuestion]


class McpDraftChange(BaseModel):
    id: str
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
    fingerprint: str | None


class McpTemplateChangeRow(BaseModel):
    """One row Publish would apply, as the `changes` view pages it."""

    id: str
    tier: str
    variant: str
    label_path: list[str]
    attribute: str | None
    before: str | None
    after: str | None
    affects_recorded_data: bool
    affects_ai: bool


class McpTemplateView(BaseModel):
    template_id: UUID
    template_name: str
    project_name: str
    view: Literal["published", "draft", "changes"]
    kind: str
    instrument: InstrumentCode
    published_version: int | None
    narrow: bool | None
    instruction: str | None
    instruction_is_default: bool
    draft_open: bool | None
    sections: list[McpTemplateSection]
    draft_diff: McpDraftDiff | None
    next_cursor: str | None
    fingerprint: str | None = None
    status: str | None = None
    counts: dict[str, int] | None = None
    changes: list[McpTemplateChangeRow] | None = None
    lint: list[LintFinding] | None = None
    note: str | None = None
    editor_url: str | None
    untrusted_content: Literal[True] = True
    untrusted_fields: list[str] = [
        "template_name",
        "project_name",
        "instruction",
        "sections[].name",
        "sections[].label",
        "sections[].description",
        "sections[].entry_label",
        "sections[].questions[].name",
        "sections[].questions[].label",
        "sections[].questions[].description",
        "sections[].questions[].options[].value",
        "sections[].questions[].options[].label",
        "sections[].questions[].instructions",
        "sections[].questions[].unit",
        "sections[].questions[].allowed_units[]",
        "draft_diff.changes[].label_path[]",
        "draft_diff.changes[].before",
        "draft_diff.changes[].after",
        "draft_diff.changes[].id",
        "changes[].id",
        "changes[].label_path[]",
        "changes[].before",
        "changes[].after",
        "lint[].section_label",
        "lint[].question_labels[]",
    ]
