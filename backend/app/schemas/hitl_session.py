"""Schemas for the unified HITL session endpoint."""

from typing import Literal
from uuid import UUID

from pydantic import BaseModel, model_validator


class OpenHITLSessionRequest(BaseModel):
    kind: Literal["extraction", "quality_assessment"]
    project_id: UUID
    article_id: UUID
    project_template_id: UUID | None = None
    global_template_id: UUID | None = None

    @model_validator(mode="after")
    def _require_one_template_pointer(self) -> "OpenHITLSessionRequest":
        if self.project_template_id is None and self.global_template_id is None:
            raise ValueError("Either project_template_id or global_template_id must be provided")
        return self


class OpenHITLSessionResponse(BaseModel):
    run_id: UUID
    kind: Literal["extraction", "quality_assessment"]
    project_template_id: UUID
    instances_by_entity_type: dict[str, str]
