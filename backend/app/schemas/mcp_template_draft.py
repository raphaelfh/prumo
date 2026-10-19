"""MCP ``edit_template_draft`` op models (spec §5.2). Validation mirrors
``TemplateFieldCreateRequest``/``TemplateFieldUpdateRequest``; every validator is
FIELD-level so ``errors()[0]["loc"]`` names the argument (a model validator
reports an empty loc)."""

from typing import Annotated, Literal
from uuid import UUID

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    ValidationInfo,
    field_validator,
    model_validator,
)

from app.schemas.mcp_templates import McpDraftDiff
from app.schemas.template_structure import (
    FieldType,
    OptionItem,
    SectionEntryLabel,
    SectionLabel,
)


class OptionInput(BaseModel):
    """One option an agent sends: ``value`` is optional and defaults to the
    trimmed ``label``."""

    model_config = ConfigDict(extra="forbid")
    value: str | None = Field(default=None, min_length=1, max_length=100)
    label: str = Field(min_length=1, max_length=100)

    def to_option_item(self) -> OptionItem:
        return OptionItem(value=self.value or self.label.strip(), label=self.label)


Unit = Annotated[str, StringConstraints(min_length=1, max_length=50)]
# Mirrors TemplateFieldCreateRequest.allowed_units (at most 20, unique).
AllowedUnits = Annotated[list[Unit], Field(min_length=1, max_length=20)]


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
    required: bool = False
    unit: str | None = Field(default=None, max_length=50)
    allowed_units: AllowedUnits | None = None
    allows_not_applicable: bool = False
    allows_not_evaluated: bool = False
    # TRUE by default, as on the REST create: the marker was universal.
    allows_no_information: bool = True
    allow_other: bool = False

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
    """Edit an existing question's wording, flags and units; only the sent keys
    change. Never changes ``name``, ``type`` or options (``set_options``)."""

    model_config = ConfigDict(extra="forbid")
    op: Literal["update_question"]
    field_id: UUID
    label: str | None = Field(default=None, min_length=1, max_length=100)
    description: str | None = Field(default=None, max_length=500)
    instructions: str | None = Field(default=None, max_length=1000)
    required: bool | None = None
    unit: str | None = Field(default=None, max_length=50)
    allowed_units: AllowedUnits | None = None
    allows_not_applicable: bool | None = None
    allows_not_evaluated: bool | None = None
    allows_no_information: bool | None = None
    is_entity_key: bool | None = None
    allow_other: bool | None = None

    @field_validator(
        "label",
        "required",
        "allows_not_applicable",
        "allows_not_evaluated",
        "allows_no_information",
        "is_entity_key",
        "allow_other",
    )
    @classmethod
    def _not_null(cls, value: object, info: ValidationInfo) -> object:
        # Runs only when the key is sent: omitted keeps the column, null is refused
        # (each of these extraction_fields columns is NOT NULL).
        if value is None:
            raise ValueError(f"{info.field_name} may be omitted but not null")
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


class SetOptionsOp(BaseModel):
    """Replace a select or multiselect question's options. A sent ``value`` is
    kept; an option without one keeps the stored code of the option with the
    same trimmed label, else its code is the trimmed label."""

    model_config = ConfigDict(extra="forbid")
    op: Literal["set_options"]
    field_id: UUID
    options: list[OptionInput] = Field(min_length=1, max_length=100)


class AddSectionOp(BaseModel):
    """Add a section at the end of the template, or under a repeating parent.
    A repeating (``many``) section needs an ``entry_label``; a ``one`` section
    takes none."""

    model_config = ConfigDict(extra="forbid")
    op: Literal["add_section"]
    label: SectionLabel
    cardinality: Literal["one", "many"]
    parent_section_id: UUID | None = None
    entry_label: SectionEntryLabel | None = None
    description: str | None = Field(default=None, max_length=500)
    required: bool = False


class UpdateSectionOp(BaseModel):
    """Edit a section's label, AI description, entry label or cardinality;
    only the sent keys change, and at least one must be sent."""

    model_config = ConfigDict(extra="forbid")
    op: Literal["update_section"]
    section_id: UUID
    label: SectionLabel | None = None
    description: str | None = Field(default=None, max_length=500)
    entry_label: SectionEntryLabel | None = None
    cardinality: Literal["one", "many"] | None = None

    @field_validator("label", "description", "entry_label", "cardinality")
    @classmethod
    def _not_null(cls, value: object, info: ValidationInfo) -> object:
        # Runs only when the key is sent; a blank description clears it.
        if value is None:
            raise ValueError(f"{info.field_name} may be omitted but not null")
        return value

    @model_validator(mode="after")
    def _one_change(self) -> "UpdateSectionOp":
        if not self.model_fields_set - {"op", "section_id"}:
            raise ValueError("name at least one field to change")
        return self


class DeleteSectionOp(BaseModel):
    """Delete a section and its questions; refused while it holds recorded data
    or owns child sections."""

    model_config = ConfigDict(extra="forbid")
    op: Literal["delete_section"]
    section_id: UUID


class SetInstructionOp(BaseModel):
    """Set the template's general AI instruction; null or blank clears it."""

    model_config = ConfigDict(extra="forbid")
    op: Literal["set_instruction"]
    instruction: str | None = Field(max_length=4000)


DraftOp = (
    AddQuestionOp
    | UpdateQuestionOp
    | DeleteQuestionOp
    | MoveQuestionOp
    | ReorderQuestionsOp
    | SetOptionsOp
    | AddSectionOp
    | UpdateSectionOp
    | DeleteSectionOp
    | SetInstructionOp
)


class AppliedQuestionOp(BaseModel):
    """An applied op that leaves one question in place: added, edited, moved or
    given new options."""

    op_index: int
    op: Literal["add_question", "update_question", "move_question", "set_options"]
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


class AppliedSectionOp(BaseModel):
    """An applied section op; a delete carries the removed id only."""

    op_index: int
    op: Literal["add_section", "update_section", "delete_section"]
    section_id: UUID
    label: str | None
    cardinality: Literal["one", "many"] | None


class AppliedInstructionOp(BaseModel):
    """An applied ``set_instruction``: whether the stored text changed (the
    text itself is not echoed)."""

    op_index: int
    op: Literal["set_instruction"]
    changed: bool


AppliedOp = Annotated[
    AppliedQuestionOp
    | AppliedDeleteOp
    | AppliedReorderOp
    | AppliedSectionOp
    | AppliedInstructionOp,
    Field(discriminator="op"),
]


class McpLintCounts(BaseModel):
    """How many lint findings the draft has after the ops, by status; the
    findings themselves are in ``get_template`` view 'draft'."""

    block: int
    warn: int


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
    lint: McpLintCounts
    destructive_changes: int
    """Changes Publish will ask a human to acknowledge (the destructive bucket)."""
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
