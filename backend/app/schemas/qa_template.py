"""Schemas for the Quality-Assessment template clone endpoint."""

from uuid import UUID

from pydantic import BaseModel


class CloneQaTemplateRequest(BaseModel):
    global_template_id: UUID


class CloneQaTemplateResponse(BaseModel):
    project_template_id: UUID
    version_id: UUID
    entity_type_count: int
    field_count: int
    created: bool
