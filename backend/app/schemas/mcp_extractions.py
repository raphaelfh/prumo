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
    """`review_question_drift`: null until an AI call pinned the review question;
    true when the project's protocol changed since (new runs use the current one)."""

    run_id: UUID
    stage: str
    review_question_drift: bool | None


class McpEvidence(BaseModel):
    """`locator` is `p{page}·b{block}` from the parsed anchor, or null when the
    quote could not be grounded; `stale`: the article was re-parsed after
    anchoring, so the location may have moved."""

    quote: str
    quote_truncated: bool
    locator: str | None
    grounded: bool
    stale: bool


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


class McpConciseCell(BaseModel):
    """One question for one article: a typed value per instance, in instance
    order; `values_truncated` when the cell stopped before the last one."""

    values: list[McpValue]
    values_truncated: bool
    ai_only: bool
    disagreement: bool | None


class McpProvenance(BaseModel):
    """Identity of the generation behind an AI row: the model id (untrusted
    text -- a custom host's id is user-entered; capped at 200 chars), the
    mode that ran, the pinned template version, the output schema and
    article text it saw (hashes are the first 12 hex characters), the
    article's content version and the prompt version."""

    model: str
    mode: Literal["fast", "verified"]
    template_version: int
    schema_sha256: str
    text_sha256: str | None
    content_version: int | None
    prompt_version: str


class McpDetailedRow(BaseModel):
    """`provenance`: set on an AI-decided row whose generation recorded its
    identity; null for human and consensus rows and older AI rows."""

    instance_id: UUID
    field_id: UUID
    value: McpValue
    decider: Literal["human", "ai", "consensus"]
    reviewer: Literal["self", "peer"] | None
    evidence: list[McpEvidence]
    run_stage: str
    provenance: McpProvenance | None


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
    template_name: str
    response_format: str
    questions: list[McpExtractionQuestion] | None
    questions_truncated: bool
    next_step: str | None
    articles: list[McpExtractionArticle]
    next_cursor: str | None
    untrusted_content: Literal[True] = True
    untrusted_fields: list[str] = [
        "template_name",
        "questions[].section_label",
        "questions[].label",
        "articles[].title",
        "articles[].values{}.values[].value",
        "articles[].values{}.values[].value[]",
        "articles[].values{}.values[].label",
        "articles[].values{}.values[].label[]",
        "articles[].values{}.values[].unit",
        "articles[].values{}.values[].other_text",
        "articles[].rows[].value.value",
        "articles[].rows[].value.value[]",
        "articles[].rows[].value.label",
        "articles[].rows[].value.label[]",
        "articles[].rows[].value.unit",
        "articles[].rows[].value.other_text",
        "articles[].rows[].evidence[].quote",
        "articles[].rows[].provenance.model",
    ]
