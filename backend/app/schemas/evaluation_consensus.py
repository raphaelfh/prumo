"""Schemas for consensus publication and evidence upload APIs."""

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator


class CreateConsensusDecisionRequest(BaseModel):
    """Publish consensus decision request."""

    project_id: UUID
    run_id: UUID | None = None
    target_id: UUID
    item_id: UUID
    schema_version_id: UUID
    mode: str = Field(..., pattern="^(select_existing|manual_override)$")
    selected_reviewer_decision_id: UUID | None = None
    override_value: dict | None = None
    override_justification: str | None = None
    expected_updated_at: str | None = None

    @model_validator(mode="after")
    def validate_mode_requirements(self) -> "CreateConsensusDecisionRequest":
        if self.mode == "select_existing" and self.selected_reviewer_decision_id is None:
            raise ValueError("selected_reviewer_decision_id is required for select_existing mode")
        if self.mode == "manual_override":
            if self.override_value is None:
                raise ValueError("override_value is required for manual_override mode")
            if not self.override_justification:
                raise ValueError("override_justification is required for manual_override mode")
        return self


class PublishedStateResponse(BaseModel):
    """Published-state response payload."""

    id: UUID
    project_id: UUID
    target_id: UUID
    item_id: UUID
    schema_version_id: UUID
    latest_consensus_decision_id: UUID

    model_config = ConfigDict(from_attributes=True)


class CreateEvidenceUploadRequest(BaseModel):
    """Evidence upload URL request payload."""

    project_id: UUID
    entity_type: str = Field(..., pattern="^(proposal|reviewer_decision|consensus_decision|published_state)$")
    entity_id: UUID
    filename: str
    mime_type: str
    size_bytes: int


class EvidenceUploadResponse(BaseModel):
    """Evidence upload URL response payload."""

    upload_url: str
    storage_path: str
    expires_at: datetime
