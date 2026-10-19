"""MCP result models for agent-started AI extraction runs (ADR 0021)."""

from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel

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
        "engine.label",
        "articles[].title",
        "confirmation",
    ]
