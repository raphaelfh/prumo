"""Result models for the researcher MCP `get_extractions` tool (task 8b). Each
is the exact `outputSchema` of the tool: no field beyond what the model
needs."""

from __future__ import annotations

from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel


class McpExtractionQuestion(BaseModel):
    field_id: UUID
    section_label: str
    label: str
    type: str


class McpRunRef(BaseModel):
    run_id: UUID
    stage: str


class McpConciseCell(BaseModel):
    value: str | None
    ai_only: bool
    disagreement: bool | None


class McpEvidence(BaseModel):
    quote: str
    locator: str | None


class McpDetailedRow(BaseModel):
    instance_id: UUID
    field_id: UUID
    value: Any
    decider: Literal["human", "ai", "consensus"]
    reviewer: Literal["self", "peer"] | None
    evidence: list[McpEvidence]
    run_stage: str


class McpExtractionArticle(BaseModel):
    article_id: UUID
    title: str
    run: McpRunRef | None
    reason: Literal["no_run", "blind_review"] | None
    peer_values_hidden: bool
    continued: bool
    values: dict[str, McpConciseCell] | None
    rows: list[McpDetailedRow] | None


class McpExtractionsPage(BaseModel):
    template_id: UUID
    response_format: str
    questions: list[McpExtractionQuestion] | None
    articles: list[McpExtractionArticle]
    next_cursor: str | None
    untrusted_content: bool = True
