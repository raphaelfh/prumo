"""MCP result models for agent-started AI extraction runs (ADR 0021)."""

from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel

from app.schemas.extraction_batch import BatchState, ExtractionBatchCounts

BlockerCode = Literal[
    "AGENT_RUNS_OFF",
    "MANAGERS_ONLY",
    "TEMPLATE_NOT_PUBLISHED",
    "AI_NOT_CONFIGURED",
    "AI_RUN_ACTIVE",
    "AI_RUN_LIMIT",
    "SERVICE_UNAVAILABLE",
    "NOTHING_TO_RUN",
]
BlockerReason = Literal[
    "MISSING_API_KEY",
    "DEPLOYMENT_KEY_NOT_ALLOWED",
    "LLM_ENGINE_RETIRED",
    "LLM_ENDPOINT_UNAVAILABLE",
    "MAX_ARTICLES_PER_RUN",
    "DAILY_CAP",
]
SkipReason = Literal[
    "RUN_FINALIZED",
    "RUN_NOT_EDITABLE",
    "AI_ALREADY_RUNNING",
    "ALREADY_HAS_AI_SUGGESTIONS",
    "NO_PDF",
]
WarningCode = Literal[
    "PICOTS_OFF_OR_EMPTY",
    "TEMPLATE_INSTRUCTION_PLACEHOLDERS",
    "ARTICLES_UNPARSED",
    "VERIFIED_MODE_TWO_PASSES",
]
Payer = Literal["your_key", "project_key"]


class McpPlanProject(BaseModel):
    id: UUID
    name: str


class McpPlanTemplate(BaseModel):
    id: UUID
    name: str
    kind: str
    version: int | None


class McpPlanEngine(BaseModel):
    """``model`` is untrusted text (a custom host's id is user-entered),
    capped at 200 chars."""

    provider: str
    model: str
    label: str | None
    mode: Literal["fast", "verified"]
    cost_tier: Literal["$", "$$", "$$$"] | None


class McpPlanCounts(BaseModel):
    requested: int
    will_run: int
    skipped: int
    remaining_beyond_cap: int


class McpPlanArticle(BaseModel):
    article_id: UUID
    title: str
    will_run: bool
    reason_code: SkipReason | None


class McpPlanEstimate(BaseModel):
    basis: Literal["text_size_lower_bound"] = "text_size_lower_bound"
    input_tokens_low: int
    llm_calls_low: int
    passes: int


class McpPlanLimits(BaseModel):
    max_articles_per_run: int
    daily_remaining: int


class McpPlanBlocker(BaseModel):
    code: BlockerCode
    reason_code: BlockerReason | None
    message: str
    fix: str
    batch_id: UUID | None


class McpPlanWarning(BaseModel):
    code: WarningCode
    message: str


class McpPlanConfirm(BaseModel):
    article_count: int
    model: str
    payer: Payer


class McpAiRunPlan(BaseModel):
    """What an AI extraction run would do; nothing ran and nothing changed."""

    project: McpPlanProject
    template: McpPlanTemplate
    engine: McpPlanEngine | None
    payer: Payer | None
    counts: McpPlanCounts
    skipped_by_reason: dict[SkipReason, int]
    articles: list[McpPlanArticle]
    estimate: McpPlanEstimate
    limits: McpPlanLimits
    blockers: list[McpPlanBlocker]
    warnings: list[McpPlanWarning]
    can_start: bool
    plan_token: str | None
    expires_at: datetime | None
    confirm: McpPlanConfirm | None
    confirmation: str | None
    untrusted_content: Literal[True] = True
    untrusted_fields: list[str] = [
        "project.name",
        "template.name",
        "engine.model",
        "engine.label",
        "articles[].title",
        "confirm.model",
        "confirmation",
    ]


class McpStartedEngine(BaseModel):
    """``model`` is untrusted text, capped at 200 chars."""

    provider: str
    model: str
    mode: str


class McpAiRunStarted(BaseModel):
    """The batch an approved plan started (or, ``replayed``, had already started)."""

    batch_id: UUID
    replayed: bool
    state: BatchState
    counts: ExtractionBatchCounts
    engine: McpStartedEngine
    payer: Payer
    untrusted_content: Literal[True] = True
    untrusted_fields: list[str] = ["engine.model"]
    note: Literal[
        "AI only adds suggestions; reviewers must check them in prumo. Check progress with "
        "get_ai_runs when the user asks; do not poll in a loop."
    ] = (
        "AI only adds suggestions; reviewers must check them in prumo. Check progress with "
        "get_ai_runs when the user asks; do not poll in a loop."
    )


AttentionOutcome = Literal["needs_attention", "done_with_issues", "skipped", "not_run"]


class McpAiRunSummary(BaseModel):
    """One of the caller's runs; titles and names are capped."""

    batch_id: UUID
    template_name: str
    state: BatchState
    stalled: bool
    started_by_agent: bool
    agent_token_name: str | None
    created_at: datetime
    finished_at: datetime | None
    counts: ExtractionBatchCounts
    stop_code: str | None
    stop_message: str | None


class McpAiRunAttentionItem(BaseModel):
    article_id: UUID
    title: str
    outcome: AttentionOutcome
    reason_code: str | None
    message: str | None
    failed_sections: int | None
    total_sections: int | None


class McpAiRunDetail(McpAiRunSummary):
    suggestions_created: int
    tokens_used: int | None
    attention_items: list[McpAiRunAttentionItem]
    next_cursor: str | None
    review_hint: Literal[
        "Review the AI suggestions in prumo: open the project's extraction view for each article."
    ] = "Review the AI suggestions in prumo: open the project's extraction view for each article."


class McpAiRuns(BaseModel):
    """``mode="list"``: the caller's runs in the project (``runs``), active first;
    ``mode="detail"``: one run (``run``) with the articles that need attention."""

    mode: Literal["list", "detail"]
    project_id: UUID
    project_name: str
    runs: list[McpAiRunSummary]
    run: McpAiRunDetail | None
    untrusted_content: Literal[True] = True
    untrusted_fields: list[str] = [
        "project_name",
        "runs[].template_name",
        "runs[].agent_token_name",
        "runs[].stop_message",
        "run.template_name",
        "run.agent_token_name",
        "run.stop_message",
        "run.attention_items[].title",
        "run.attention_items[].message",
    ]


class McpAiRunCancelled(BaseModel):
    """``already_finished``: the run had already finished, been cancelled or
    stopped; nothing was written."""

    batch_id: UUID
    already_finished: bool
    state: BatchState
    cancelled_queued: int
    in_flight_finishing: int
