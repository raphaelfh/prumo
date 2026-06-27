"""Pydantic schemas for AI-suggestion read endpoints."""

from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class EvidenceResponse(BaseModel):
    """Evidence snippet attached to a proposal record."""

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    proposal_record_id: UUID | None
    text_content: str | None
    page_number: int | None
    block_ids: list[int] = Field(
        default_factory=list,
        alias="blockIds",
        description="block_index values for deterministic reader highlight",
    )
    rank: int = 0
    attribution_label: str | None = Field(default=None, alias="attributionLabel")


class AISuggestionItem(BaseModel):
    """A single AI suggestion (latest proposal per coord) with caller-scoped status."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    run_id: UUID
    instance_id: UUID
    field_id: UUID
    # Raw JSONB envelope — the frontend unwraps the inner value in Task 6.
    proposed_value: dict[str, Any]
    confidence_score: float | None
    rationale: str | None
    created_at: datetime
    evidence: list[EvidenceResponse]
    # Caller-scoped: 'accepted' | 'rejected' | 'pending'
    status: str


class AISuggestionsResponse(BaseModel):
    """Response for the suggestions endpoint."""

    suggestions: list[AISuggestionItem]
    count: int


class AISuggestionHistoryItem(BaseModel):
    """One entry in the proposal history for a single (instance, field) coord.

    Same shape as AISuggestionItem minus `status` — history is proposal trail only.
    """

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    run_id: UUID
    instance_id: UUID
    field_id: UUID
    proposed_value: dict[str, Any]
    confidence_score: float | None
    rationale: str | None
    created_at: datetime
    evidence: list[EvidenceResponse]
