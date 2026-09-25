"""MCP ``edit_template_draft`` op models (spec §5.2). Validation mirrors
``TemplateFieldCreateRequest``/``TemplateFieldUpdateRequest``; every validator is
FIELD-level so ``errors()[0]["loc"]`` names the argument (a model validator
reports an empty loc)."""

from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, ValidationInfo, field_validator

from app.schemas.template_structure import AllowedValues, FieldType


class AddQuestionOp(BaseModel):
    """Append a new question to a section of the active draft (spec §5.2)."""

    model_config = ConfigDict(extra="forbid")
    op: Literal["add_question"]
    section_id: UUID
    label: str = Field(min_length=1, max_length=100)
    type: FieldType
    # validate_default: the check must also run when options is omitted.
    options: AllowedValues | None = Field(default=None, validate_default=True)
    instructions: str | None = Field(default=None, max_length=1000)

    @field_validator("options")
    @classmethod
    def _options_match_type(cls, value: list[str] | None, info: ValidationInfo) -> list[str] | None:
        field_type = info.data.get("type")
        if field_type is None:  # type itself failed; report that error only
            return value
        needs = field_type in ("select", "multiselect")
        if needs and value is None:
            raise ValueError("options are required for select and multiselect questions")
        if not needs and value is not None:
            raise ValueError("options are only allowed for select and multiselect questions")
        return value


class UpdateQuestionOp(BaseModel):
    """Reword an existing question; never changes ``name``, ``type`` or options."""

    model_config = ConfigDict(extra="forbid")
    op: Literal["update_question"]
    field_id: UUID
    label: str | None = Field(default=None, min_length=1, max_length=100)
    description: str | None = Field(default=None, max_length=500)
    instructions: str | None = Field(default=None, max_length=1000)

    @field_validator("label")
    @classmethod
    def _label_not_null(cls, value: str | None) -> str | None:
        # Runs only when the key is sent: omitted keeps the label, null is refused
        # (extraction_fields.label is NOT NULL).
        if value is None:
            raise ValueError("label may be omitted but not null")
        return value


DraftOp = AddQuestionOp | UpdateQuestionOp
