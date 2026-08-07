"""Schemas for the HITL session and project-template management endpoints."""

from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field, model_validator

# Re-export TemplateKind so endpoints can convert request.kind into the
# canonical enum value without importing directly from app.models.* —
# enforced by scripts/fitness/check_layered_arch.py.
from app.models.extraction_versioning import TemplateKind  # noqa: E402,F401
from app.schemas.extraction_run import RunViewEntityType, RunViewResponse


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
    # Embedded run-open view (both kinds). Lets the client render from a single
    # round-trip instead of session -> GET /runs/{id} -> values. Carries the
    # server-blinded reviewer decisions both surfaces feed into the shared
    # compare view (ADR 0012). Optional only for resilience if the view fails
    # to build.
    run_view: RunViewResponse | None = None


class CloneTemplateRequest(BaseModel):
    global_template_id: UUID
    kind: Literal["extraction", "quality_assessment"]


class CloneTemplateResponse(BaseModel):
    project_template_id: UUID
    version_id: UUID
    entity_type_count: int
    field_count: int
    created: bool


class RepublishTemplateVersionResponse(BaseModel):
    version_id: UUID
    version: int
    changed: bool
    repinned_run_count: int


class UpdateTemplateActiveRequest(BaseModel):
    is_active: bool


class UpdateTemplateActiveResponse(BaseModel):
    project_template_id: UUID
    is_active: bool


class TemplateInstructionRead(BaseModel):
    project_template_id: UUID
    llm_template_instruction: str | None
    default_instruction: str | None
    """The origin global template's instruction (None for custom templates)."""


class UpdateTemplateInstructionRequest(BaseModel):
    llm_template_instruction: str | None = Field(default=None, max_length=4000)


class UpdateTemplateInstructionResponse(BaseModel):
    project_template_id: UUID
    llm_template_instruction: str | None
    version_id: UUID
    version: int
    changed: bool
    repinned_run_count: int


class TemplateActiveVersionRead(BaseModel):
    """The template's ACTIVE version tree — what the worklist/dashboard
    progress and exports render from (B-3a). Never an empty stand-in for a
    missing active version: that case is a typed 404."""

    version_id: UUID
    version: int
    entity_types: list[RunViewEntityType]
