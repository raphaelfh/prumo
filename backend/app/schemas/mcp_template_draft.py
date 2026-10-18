"""MCP ``edit_template_draft`` op models (spec §5.2). Validation mirrors
``TemplateFieldCreateRequest``/``TemplateFieldUpdateRequest``; every validator is
FIELD-level so ``errors()[0]["loc"]`` names the argument (a model validator
reports an empty loc)."""

from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, ValidationInfo, field_validator

from app.schemas.mcp_templates import McpDraftDiff
from app.schemas.template_structure import FieldType, OptionItem


class OptionInput(BaseModel):
    """One option an agent sends: ``value`` is optional and defaults to the
    trimmed ``label``."""

    model_config = ConfigDict(extra="forbid")
    value: str | None = Field(default=None, min_length=1, max_length=100)
    label: str = Field(min_length=1, max_length=100)

    def to_option_item(self) -> OptionItem:
        return OptionItem(value=self.value or self.label.strip(), label=self.label)


class AddQuestionOp(BaseModel):
    """Append a new question to a section of the active draft."""

    model_config = ConfigDict(extra="forbid")
    op: Literal["add_question"]
    section_id: UUID
    label: str = Field(min_length=1, max_length=100)
    type: FieldType
    # validate_default: the check must also run when options is omitted.
    options: list[OptionInput] | None = Field(
        default=None, min_length=1, max_length=100, validate_default=True
    )
    instructions: str | None = Field(default=None, max_length=1000)

    @field_validator("options")
    @classmethod
    def _options_match_type(
        cls, value: list[OptionInput] | None, info: ValidationInfo
    ) -> list[OptionInput] | None:
        field_type = info.data.get("type")
        if field_type is None:  # type itself failed; report that error only
            return value
        needs = field_type in ("select", "multiselect")
        if needs and value is None:
            raise ValueError("options are required for select and multiselect questions")
        if not needs and value is not None:
            raise ValueError("options are only allowed for select and multiselect questions")
        if value is not None:
            codes = [option.to_option_item().value for option in value]
            if len(set(codes)) != len(codes):
                raise ValueError("option values must be unique")
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


class DeleteQuestionOp(BaseModel):
    """Delete a question; refused while it holds recorded data."""

    model_config = ConfigDict(extra="forbid")
    op: Literal["delete_question"]
    field_id: UUID


class MoveQuestionOp(BaseModel):
    """Move a question to a section of the same template at a 0-based position;
    a position past the end appends."""

    model_config = ConfigDict(extra="forbid")
    op: Literal["move_question"]
    field_id: UUID
    section_id: UUID
    position: int = Field(ge=0)


class ReorderQuestionsOp(BaseModel):
    """Set a section's question order: ``field_ids`` names exactly its questions."""

    model_config = ConfigDict(extra="forbid")
    op: Literal["reorder_questions"]
    section_id: UUID
    field_ids: list[UUID] = Field(min_length=1, max_length=500)


DraftOp = AddQuestionOp | UpdateQuestionOp | DeleteQuestionOp | MoveQuestionOp | ReorderQuestionsOp


class AppliedQuestionOp(BaseModel):
    """An applied op that leaves one question in place: added, reworded or moved."""

    op_index: int
    op: Literal["add_question", "update_question", "move_question"]
    field_id: UUID
    section_id: UUID
    section_label: str
    name: str
    label: str


class AppliedDeleteOp(BaseModel):
    op_index: int
    op: Literal["delete_question"]
    field_id: UUID


class AppliedReorderOp(BaseModel):
    op_index: int
    op: Literal["reorder_questions"]
    section_id: UUID
    section_label: str
    count: int
    """How many questions the section now orders; the ids are in the audit row."""


AppliedOp = Annotated[
    AppliedQuestionOp | AppliedDeleteOp | AppliedReorderOp, Field(discriminator="op")
]


class EditTemplateDraftResult(BaseModel):
    """``edit_template_draft``'s reply: always an unpublished, invisible draft."""

    status: Literal["draft_saved_unpublished"]
    visible_to_reviewers_and_ai: Literal[False]
    project_name: str
    template_name: str
    applied: list[AppliedOp]
    diff: McpDraftDiff
    draft_fingerprint: str | None
    editor_url: str
    next_step: str
    untrusted_content: Literal[True] = True
    untrusted_fields: list[str] = [
        "project_name",
        "template_name",
        "applied[].section_label",
        "applied[].name",
        "applied[].label",
        "diff.changes[].label_path[]",
        "diff.changes[].before",
        "diff.changes[].after",
        "diff.changes[].id",
    ]
