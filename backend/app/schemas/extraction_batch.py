"""AI batch runs over many articles (spec 2026-09-15 §7). snake_case on the wire."""

from dataclasses import dataclass
from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, field_validator

MAX_ARTICLES_PER_BATCH = 100

#: An attempt failing with one of these stops the whole batch (G12).
ENGINE_STOP_CODES = frozenset({"MISSING_API_KEY", "ENGINE_RETIRED", "LLM_ENDPOINT_UNAVAILABLE"})
ATTEMPT_LIVE = frozenset({"pending", "running"})

BatchState = Literal["active", "finished", "stopped", "cancelled"]
ItemOutcome = Literal[
    "queued", "running", "done", "done_with_issues", "needs_attention", "skipped", "not_run"
]


@dataclass(frozen=True)
class ItemRow:
    """One batch item joined with its (optional) attempt — the repository's read shape."""

    article_id: UUID
    title: str
    status: str
    reason_code: str | None
    updated_at: datetime
    attempt_id: UUID | None
    attempt_status: str | None
    attempt_result: dict[str, Any] | None
    attempt_error_code: str | None
    attempt_error: str | None
    attempt_updated_at: datetime | None


class CreateExtractionBatchRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    project_id: UUID
    template_id: UUID
    article_ids: list[UUID]
    skip_articles_with_ai_suggestions: bool = True

    @field_validator("article_ids")
    @classmethod
    def _dedupe_and_bound(cls, value: list[UUID]) -> list[UUID]:
        unique = list(dict.fromkeys(value))
        if not 1 <= len(unique) <= MAX_ARTICLES_PER_BATCH:
            raise ValueError(f"article_ids must hold 1 to {MAX_ARTICLES_PER_BATCH} distinct ids")
        return unique


class ExtractionBatchCounts(BaseModel):
    total: int
    queued: int
    running: int
    done: int
    done_with_issues: int
    needs_attention: int
    skipped: int
    not_run: int


class ExtractionBatchSummary(BaseModel):
    id: UUID
    project_id: UUID
    project_name: str
    template_id: UUID
    template_name: str
    kind: str
    created_at: datetime
    finished_at: datetime | None
    state: BatchState
    stalled: bool
    stop_code: str | None
    stop_message: str | None
    counts: ExtractionBatchCounts


class ExtractionBatchItemView(BaseModel):
    article_id: UUID
    title: str
    outcome: ItemOutcome
    reason_code: str | None
    message: str | None
    failed_sections: int | None
    total_sections: int | None


class ExtractionBatchDetail(ExtractionBatchSummary):
    items: list[ExtractionBatchItemView]
