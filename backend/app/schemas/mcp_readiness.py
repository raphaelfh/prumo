"""Result model of the researcher MCP `get_setup_readiness` tool: its exact
`outputSchema`."""

from __future__ import annotations

from typing import Literal
from uuid import UUID

from pydantic import BaseModel

ReadinessCode = Literal[
    "REVIEW_QUESTION_EMPTY",
    "REVIEW_QUESTION_DISABLED",
    "REVIEW_TYPE_MISSING",
    "NO_ACTIVE_EXTRACTION_TEMPLATE",
    "TEMPLATE_NOT_PUBLISHED",
    "TEMPLATE_NARROW_BASELINE",
    "DRAFT_PENDING_PUBLISH",
    # the questionnaire lint codes (`app.schemas.template_lint.LintCode`)
    "SELECT_WITHOUT_OPTIONS",
    "REPEATING_SECTION_WITHOUT_ENTITY_KEY",
    "REPEATING_SECTION_WITHOUT_ENTRY_LABEL",
    "EMPTY_SECTION",
    "QUESTION_WITHOUT_AI_GUIDANCE",
    "UNRESOLVED_CUSTOMIZE_SLOT",
]
ReadinessStatus = Literal["block", "warn"]


class McpReadinessSubject(BaseModel):
    kind: Literal["project", "template"]
    id: UUID
    name: str


class McpReadinessItem(BaseModel):
    code: ReadinessCode
    status: ReadinessStatus
    subject: McpReadinessSubject | None = None
    tree: Literal["published", "draft"] | None = None
    message: str
    next_step: str


class McpReadinessSummary(BaseModel):
    block: int
    warn: int
    ok: bool


class McpSetupReadiness(BaseModel):
    project_id: UUID
    project_name: str
    protocol_revision: int
    summary: McpReadinessSummary
    items: list[McpReadinessItem]
    draft_detail_hidden: bool
    untrusted_content: Literal[True] = True
    untrusted_fields: list[str] = ["project_name", "items[].subject.name", "items[].message"]
