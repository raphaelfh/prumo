"""Schemas for the Quality-Assessment template clone + assessment endpoints."""

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


class OpenQaAssessmentRequest(BaseModel):
    project_id: UUID
    article_id: UUID
    global_template_id: UUID


class OpenQaAssessmentResponse(BaseModel):
    run_id: UUID
    project_template_id: UUID
    instances_by_entity_type: dict[str, str]
