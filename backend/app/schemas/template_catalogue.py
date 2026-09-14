"""Read models for the template catalogue: the global templates offered for
import and a project's own templates."""

from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.extraction import Framework

TemplateKindLiteral = Literal["extraction", "quality_assessment"]


class GlobalTemplateSummaryRead(BaseModel):
    """A global template as the import pickers list it."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    description: str | None
    framework: Framework
    version: str
    kind: TemplateKindLiteral
    entity_types_count: int


class ProjectTemplateRead(BaseModel):
    """A project's template, active or not.

    ``schema`` carries the template-level declared data (``scope_rules``,
    ``derived_judgments``) the QA worklist computes scoped progress from.
    """

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    project_id: UUID
    global_template_id: UUID | None
    name: str
    description: str | None
    framework: Framework
    version: str
    kind: TemplateKindLiteral
    template_schema: dict[str, Any] = Field(
        validation_alias="schema_", serialization_alias="schema"
    )
    is_active: bool
    created_at: datetime
    created_by: UUID | None
