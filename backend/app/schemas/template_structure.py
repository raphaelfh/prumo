"""Request/response schemas for template-structure FIELD writes (B-7).

Server-side mirror of the frontend Zod ``ExtractionFieldSchema``
(frontend/types/extraction.ts) — every constraint here must stay in
lockstep with the Zod rules; the drift-guard vitest (B-7 task 5) reads
the committed openapi.json and asserts the create-field constraints
against Zod.

Layering: this module imports NOTHING from ``app.models`` — the
``field_type`` Literal is re-declared here so endpoints never touch the
model layer (scripts/fitness/check_layered_arch.py).

Deliberate scope cuts:
- ``other_label`` has NO default. The frontend Zod default
  ``'Outro (especificar)'`` was dead code (a ``.default()`` wrapped in
  ``.optional()`` never fires) and pt-BR in an English-only codebase —
  removed on both sides in this slice (panel 16).
- ``TemplateFieldReorderRequest`` is a pure payload-shape gate:
  duplicate-id rejection and template-membership verification are the
  SERVICE's job (panel 4) — multi-section batches are legal (a
  cross-section move renumbers two sections in one batch).
- Section request schemas live with the section service (panel 15),
  not here.
"""

from datetime import datetime
from typing import Annotated, Any, Literal
from uuid import UUID

from pydantic import (
    AfterValidator,
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    model_validator,
)

# Re-declared from ExtractionFieldType (app.models.extraction) — see the
# layering note in the module docstring.
FieldType = Literal["text", "number", "date", "select", "multiselect", "boolean"]

FieldName = Annotated[
    str,
    StringConstraints(pattern=r"^[a-z][a-z0-9_]*$", min_length=2, max_length=50),
]


def _reject_duplicate_items(items: list[str]) -> list[str]:
    if len(set(items)) != len(items):
        raise ValueError("items must be unique")
    return items


AllowedValues = Annotated[
    list[str],
    Field(min_length=1, max_length=100),
    AfterValidator(_reject_duplicate_items),
]
AllowedUnits = Annotated[
    list[Annotated[str, StringConstraints(max_length=50)]],
    Field(min_length=1, max_length=20),
    AfterValidator(_reject_duplicate_items),
]


class TemplateFieldCreateRequest(BaseModel):
    """Create a field in a section of the path template.

    ``entity_type_id`` names the owning section (mirrors the frontend
    ``ExtractionFieldInsert``); the service re-verifies it belongs to the
    path template (BOLA chain entity_type -> template -> project).
    ``sort_order`` is client-supplied (panel 10): it is a per-section
    rendering convention computed at dequeue time by the optimistic-row
    ghost chain — the server validates >= 0 and otherwise trusts it.
    """

    model_config = ConfigDict(extra="forbid")

    entity_type_id: UUID
    name: FieldName
    label: str = Field(min_length=1, max_length=100)
    description: str | None = Field(default=None, max_length=500)
    field_type: FieldType
    is_required: bool = False
    unit: str | None = Field(default=None, max_length=50)
    allowed_units: AllowedUnits | None = None
    llm_description: str | None = Field(default=None, max_length=1000)
    allowed_values: AllowedValues | None = None
    allow_other: bool = False
    other_label: str | None = Field(default=None, max_length=100)
    other_placeholder: str | None = Field(default=None, max_length=200)
    allows_not_applicable: bool = False
    allows_not_evaluated: bool = False
    validation_schema: dict[str, Any] | None = Field(default_factory=dict)
    sort_order: int = Field(default=0, ge=0)


# Fields whose DB columns are NOT NULL: an update may omit them, never
# null them (mirrors Zod ``.partial()``, which keeps non-nullable keys
# non-nullable).
_NON_NULLABLE_UPDATE_FIELDS = frozenset(
    {
        "name",
        "label",
        "field_type",
        "is_required",
        "allow_other",
        "allows_not_applicable",
        "allows_not_evaluated",
        "sort_order",
    }
)


class TemplateFieldUpdateRequest(BaseModel):
    """Partial update — every field optional; the service applies only the
    explicitly-set keys (``model_dump(exclude_unset=True)``).

    ``entity_type_id`` is deliberately absent (``extra="forbid"`` rejects
    it): relocating a field across sections is a MOVE with its own model
    and server-side destination checks — an update must never smuggle one.
    """

    model_config = ConfigDict(extra="forbid")

    name: FieldName | None = None
    label: str | None = Field(default=None, min_length=1, max_length=100)
    description: str | None = Field(default=None, max_length=500)
    field_type: FieldType | None = None
    is_required: bool | None = None
    unit: str | None = Field(default=None, max_length=50)
    allowed_units: AllowedUnits | None = None
    llm_description: str | None = Field(default=None, max_length=1000)
    allowed_values: AllowedValues | None = None
    allow_other: bool | None = None
    other_label: str | None = Field(default=None, max_length=100)
    other_placeholder: str | None = Field(default=None, max_length=200)
    allows_not_applicable: bool | None = None
    allows_not_evaluated: bool | None = None
    validation_schema: dict[str, Any] | None = None
    sort_order: int | None = Field(default=None, ge=0)

    @model_validator(mode="after")
    def _reject_explicit_null_on_non_nullable(self) -> "TemplateFieldUpdateRequest":
        for field in self.model_fields_set & _NON_NULLABLE_UPDATE_FIELDS:
            if getattr(self, field) is None:
                raise ValueError(f"{field} may be omitted but not null")
        return self


class TemplateFieldMoveRequest(BaseModel):
    """Move a field to another section: destination + landing position.

    Both required — a move always names where it lands. The service
    refuses a destination outside the path template (the cross-template
    hole this slice closes) and treats same-section as a plain reorder
    concern, not a move.
    """

    model_config = ConfigDict(extra="forbid")

    entity_type_id: UUID
    sort_order: int = Field(ge=0)


class TemplateFieldSortOrderUpdate(BaseModel):
    """One row of a reorder batch."""

    model_config = ConfigDict(extra="forbid")

    id: UUID
    sort_order: int = Field(ge=0)


class TemplateFieldReorderRequest(BaseModel):
    """Atomic batch renumber — callers renumber the whole affected
    section(s). Multi-section batches are legal (see module docstring);
    id ownership and duplicate rejection are enforced by the service."""

    model_config = ConfigDict(extra="forbid")

    updates: list[TemplateFieldSortOrderUpdate] = Field(min_length=1)


class TemplateFieldRead(BaseModel):
    """The full field row the config editor renders (mirrors the frontend
    ``ExtractionField`` interface). Built from the ORM row via
    ``model_validate`` — the create/update/move response payload."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    entity_type_id: UUID
    name: str
    label: str
    description: str | None = None
    field_type: FieldType
    is_required: bool
    unit: str | None = None
    allowed_units: list[str] | None = None
    llm_description: str | None = None
    allowed_values: list[str] | None = None
    allow_other: bool = False
    other_label: str | None = None
    other_placeholder: str | None = None
    allows_not_applicable: bool = False
    allows_not_evaluated: bool = False
    validation_schema: dict[str, Any] | None = None
    sort_order: int
    created_at: datetime


class TemplateFieldDeleteResponse(BaseModel):
    """Payload of the field DELETE endpoint."""

    id: UUID
    deleted: bool


class TemplateFieldReorderResponse(BaseModel):
    """Payload of the reorder endpoint: how many rows the atomic batch
    renumbered (equals the request batch size on success)."""

    updated_count: int
