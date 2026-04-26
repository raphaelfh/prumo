"""Schemas for review queue and reviewer decision endpoints."""

from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator


class ReviewQueueItem(BaseModel):
    """Single queue row returned to reviewers."""

    run_id: UUID
    target_id: UUID
    item_id: UUID
    latest_proposal_id: UUID | None = None
    reviewer_state: str = "pending"

    model_config = ConfigDict(from_attributes=True)


class ReviewQueueResponse(BaseModel):
    """Queue list response wrapper."""

    items: list[ReviewQueueItem]


class CreateReviewerDecisionRequest(BaseModel):
    """Append-only reviewer decision request."""

    project_id: UUID
    run_id: UUID
    target_id: UUID
    item_id: UUID
    schema_version_id: UUID
    proposal_id: UUID | None = None
    decision: str = Field(..., pattern="^(accept|reject|edit)$")
    edited_value: dict | None = None
    rationale: str | None = None

    @model_validator(mode="after")
    def validate_edit_payload(self) -> "CreateReviewerDecisionRequest":
        if self.decision == "edit" and self.edited_value is None:
            raise ValueError("edited_value is required when decision is 'edit'")
        return self


class ReviewerDecisionResponse(BaseModel):
    """Reviewer decision response payload."""

    id: UUID
    reviewer_id: UUID
    decision: str

    model_config = ConfigDict(from_attributes=True)
