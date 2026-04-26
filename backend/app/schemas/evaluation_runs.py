"""Schemas for unified evaluation run APIs."""

from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class CreateEvaluationRunRequest(BaseModel):
    """Request payload for run creation."""

    project_id: UUID
    schema_version_id: UUID
    target_ids: list[UUID] = Field(min_length=1)
    name: str | None = None

    model_config = ConfigDict(populate_by_name=True)


class EvaluationRunResponse(BaseModel):
    """Response payload for run reads/creates."""

    id: UUID
    project_id: UUID
    schema_version_id: UUID
    status: str
    current_stage: str

    model_config = ConfigDict(from_attributes=True)


class AsyncAcceptedData(BaseModel):
    """Async-accepted response data."""

    accepted: bool = True
