"""Result models for the researcher MCP `get_extractions` tool (task 8b). Each
is the exact `outputSchema` of the tool: no field beyond what the model
needs."""

from __future__ import annotations

from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, SerializerFunctionWrapHandler, model_serializer


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


class McpValue(BaseModel):
    """One stored value, typed: `value` is always present (`null` when empty or
    absent); `label` is the option label (or the absent reason's label) when it
    differs from the code; `unit` comes from the envelope or the field."""

    model_config = ConfigDict(extra="forbid")

    value: str | int | float | bool | list[str] | None
    label: str | list[str] | None = None
    unit: str | None = None
    absent_reason: Literal["no_information", "not_applicable", "not_evaluated"] | None = None
    other_text: str | None = None
    truncated: Literal[True] | None = None

    @model_serializer(mode="wrap")
    def _omit_absent(self, handler: SerializerFunctionWrapHandler) -> dict[str, Any]:
        data = handler(self)
        return {k: v for k, v in data.items() if k == "value" or v is not None}


class McpDetailedRow(BaseModel):
    instance_id: UUID
    field_id: UUID
    value: McpValue
    decider: Literal["human", "ai", "consensus"]
    reviewer: Literal["self", "peer"] | None
    evidence: list[McpEvidence]
    run_stage: str


class McpExtractionArticle(BaseModel):
    article_id: UUID
    title: str
    title_truncated: bool
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
    questions_truncated: bool
    next_step: str | None
    articles: list[McpExtractionArticle]
    next_cursor: str | None
    untrusted_content: Literal[True] = True
    untrusted_fields: list[str] = [
        "questions[].section_label",
        "questions[].label",
        "articles[].title",
        "articles[].values{}.value",
        "articles[].rows[].value.value",
        "articles[].rows[].value.value[]",
        "articles[].rows[].value.label",
        "articles[].rows[].value.label[]",
        "articles[].rows[].value.unit",
        "articles[].rows[].value.other_text",
        "articles[].rows[].evidence[].quote",
    ]
