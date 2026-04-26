"""Shared Pydantic schemas for unified evaluation endpoints."""

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class EvaluationRequestBase(BaseModel):
    """Base fields shared by project-scoped evaluation requests."""

    project_id: UUID = Field(..., description="Project identifier")


class EvaluationTraceMeta(BaseModel):
    """Reusable metadata for evaluation responses."""

    trace_id: str | None = Field(default=None, description="Request trace identifier")


class EvaluationEntityBase(BaseModel):
    """Base fields common to persisted evaluation entities."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    created_at: datetime
    updated_at: datetime


class EvaluationPagination(BaseModel):
    """Pagination parameters for list/read endpoints."""

    skip: int = Field(default=0, ge=0)
    limit: int = Field(default=50, ge=1, le=200)
