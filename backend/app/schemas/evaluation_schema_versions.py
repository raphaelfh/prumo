"""Schemas for evaluation schema version endpoints."""

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class CreateEvaluationSchemaVersionRequest(BaseModel):
    """Create draft schema version request."""

    schema_id: UUID


class EvaluationSchemaVersionResponse(BaseModel):
    """Schema version response envelope data."""

    id: UUID
    schema_id: UUID
    version_number: int
    status: str
    published_at: datetime | None = None
    published_by: UUID | None = None

    model_config = ConfigDict(from_attributes=True)
