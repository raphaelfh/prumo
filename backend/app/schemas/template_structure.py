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
- Section request/response schemas (B-7 task 3) are APPENDED at the end
  of this module — the section-name rules mirror the AddSectionDialog
  Zod (looser than ``FieldName``: uppercase and a leading underscore are
  legal), and ``SectionCreateRequest`` mirrors the DB's
  ``ck_extraction_entity_types_role_parent`` CHECK so an invalid
  role/parent combination never reaches the service.
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
    # 0062: TRUE by default — the marker was universal before the column, so
    # an omitting client must keep it, not silently retire it.
    allows_no_information: bool = True
    is_entity_key: bool = False
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
        "allows_no_information",
        "sort_order",
        "is_entity_key",
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
    allows_no_information: bool | None = None
    # 0059: which field identifies an instance of a repeating section. At
    # most one per section — the service refuses a second one before the
    # partial unique index has to.
    is_entity_key: bool | None = None
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
    is_entity_key: bool = False
    allows_not_applicable: bool = False
    allows_not_evaluated: bool = False
    allows_no_information: bool = True
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


# =================== SECTION SCHEMAS (B-7 task 3) ===================

# Re-declared from ExtractionCardinality / ExtractionEntityRole
# (app.models.extraction) — see the layering note in the module docstring.
SectionCardinality = Literal["one", "many"]
SectionRole = Literal["study_section", "model_container", "model_section"]

# Mirrors the AddSectionDialog Zod rules (frontend/components/extraction/
# dialogs/AddSectionDialog.tsx): section names are looser than field
# names — uppercase letters and a leading underscore are legal.
SectionName = Annotated[
    str,
    StringConstraints(pattern=r"^[a-zA-Z_][a-zA-Z0-9_]*$", min_length=2, max_length=50),
]

# Trimmed server-side so a whitespace-only label can never rename a
# section into invisibility (the rename path's "non-empty trimmed" rule).
SectionLabel = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=100),
]

# The entry noun on updates: when provided it must survive a trim (a
# blanked input is a frontend no-op, never an API write). The create side
# enforces the same non-blank rule in ``_enforce_entry_label_rules``.
SectionEntryLabel = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=100),
]

# The section description on updates — the section's AI instruction (sent
# with every extraction of the section and, for a repeating one, as the
# entry-identification instruction; the run form never shows it). Unlike a
# label, a blank is a legitimate edit: the service clears the column. Max
# length mirrors the create request and the dialog's Zod rule.
SectionDescription = Annotated[
    str,
    StringConstraints(strip_whitespace=True, max_length=500),
]


class SectionCreateRequest(BaseModel):
    """Create a section (entity type) in the path template.

    ``role`` is REQUIRED with no default — the column deliberately has no
    server_default (migration 0016 step 4) so an insert that omits the
    structural role fails loudly instead of silently becoming a
    study_section. ``sort_order`` is deliberately ABSENT: the server
    computes max+1 template-wide inside the INSERT itself, killing the
    frontend's read-then-write race. The ``ck_role_parent`` validator
    below mirrors the DB CHECK of the same name; parent OWNERSHIP
    (parent belongs to THIS template) is the service's BOLA job.
    ``entry_label`` is a repeating section's entry noun (B-8, D3 — unlocked
    from the container in the entry-group train): REQUIRED, non-blank, on
    every ``cardinality='many'`` section, container included, and refused
    on a section that does not repeat. The rule lives at this API boundary:
    rows created before it may still carry NULL, the portable importer keeps
    a bundle's NULL verbatim, and the column stays nullable until the
    entry-group trees spec makes it NOT NULL; every reader falls back to
    :data:`app.models.extraction.DEFAULT_ENTRY_LABEL` meanwhile.
    """

    model_config = ConfigDict(extra="forbid")

    name: SectionName
    label: SectionLabel
    description: str | None = Field(default=None, max_length=500)
    cardinality: SectionCardinality
    role: SectionRole
    parent_entity_type_id: UUID | None = None
    entry_label: SectionEntryLabel | None = None
    is_required: bool = False

    @model_validator(mode="after")
    def _enforce_role_parent(self) -> "SectionCreateRequest":
        """Mirror ck_extraction_entity_types_role_parent: roots carry no
        parent; a model_section always names one."""
        if self.role == "model_section":
            if self.parent_entity_type_id is None:
                raise ValueError("model_section requires parent_entity_type_id")
        elif self.parent_entity_type_id is not None:
            raise ValueError(f"{self.role} must not set parent_entity_type_id")
        return self

    @model_validator(mode="after")
    def _enforce_entry_label_rules(self) -> "SectionCreateRequest":
        """A repeating section is created WITH its entry noun — the
        identification prompt and the run form read it — so a missing one is
        refused on every role (``SectionEntryLabel`` already refuses a blank);
        a section that does not repeat cannot carry one. The container always
        repeats ('many' is enforced, never chosen)."""
        if self.role == "model_container" and self.cardinality != "many":
            raise ValueError("model_container cardinality must be 'many'")
        if self.cardinality == "many" and self.entry_label is None:
            raise ValueError("entry_label is required on a repeating section")
        if self.cardinality != "many" and self.entry_label is not None:
            raise ValueError("entry_label is only valid for a repeating section")
        return self


class SectionUpdateRequest(BaseModel):
    """Partial section update: ``label`` and ``description`` (any role),
    ``entry_label`` (repeating sections only) and ``cardinality``
    (per-model sections only) — the role rules live in the service, which
    owns the row (B-8, D5). At least one field must be provided, and
    explicit nulls are rejected (omit instead) so a smuggled ``{"label":
    null}`` can never blank a column; a description is cleared by sending
    it blank. Replaces the label-only SectionRenameRequest; the pre-B-8
    label-only body stays valid."""

    model_config = ConfigDict(extra="forbid")

    label: SectionLabel | None = None
    entry_label: SectionEntryLabel | None = None
    cardinality: SectionCardinality | None = None
    description: SectionDescription | None = None

    @model_validator(mode="after")
    def _require_one_field_no_nulls(self) -> "SectionUpdateRequest":
        if not self.model_fields_set:
            raise ValueError(
                "at least one of label, entry_label, cardinality, description is required"
            )
        for field in self.model_fields_set:
            if getattr(self, field) is None:
                raise ValueError(f"{field} may be omitted but not null")
        return self


class SectionRead(BaseModel):
    """The full section row the config editor renders. Built from the
    ORM row via ``model_validate`` — the create/rename response payload.

    ``project_template_id`` is non-optional: the section service writes
    only project-lineage rows (global-lineage sections are seed-owned)."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    project_template_id: UUID
    name: str
    label: str
    description: str | None = None
    cardinality: SectionCardinality
    role: SectionRole
    parent_entity_type_id: UUID | None = None
    # Entry noun (B-8): every repeating section is created with one; legacy rows may be NULL.
    entry_label: str | None = None
    sort_order: int
    is_required: bool
    created_at: datetime


class SectionDeleteResponse(BaseModel):
    """Payload of the section DELETE endpoint."""

    id: UUID
    deleted: bool
