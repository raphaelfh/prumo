# backend/app/schemas/template_portable.py
"""The ``prumo-template@1`` portable template format.

One JSON object, no UUIDs: nesting carries the hierarchy, array order carries
``sort_order``, and defaults are omitted on export (serialize with
``model_dump(by_alias=True, exclude_defaults=True)``). ``role`` is never
written — it is DERIVED from nesting plus the ``group`` flag, so a file cannot
express a role/parent combination the DB CHECK constraints reject.

Validation reuses the aliases from ``template_structure`` verbatim, with ONE
deliberate relaxation: ``llm_description`` allows 4000 chars (the editor caps
at 1000, but the seeded CHARMS+Multimodal ships ~1.4k-char descriptions and the
DB has no CHECK — spec §4.3). Section/template ``description`` are capped here
(500 / 2000) because they reach prompts.

Aliases (``type``/``required``) are a deliberate deviation from the
``common.py`` "no aliases" guidance: the file is hand/LLM-authored and these
are the JSON-Schema spellings (spec §4.3). ``populate_by_name`` stays OFF so a
file cannot spell them as ``field_type``/``is_required``; ORM rows are read
with ``model_validate(row, from_attributes=True, by_name=True)`` instead.

Layering: imports nothing from ``app.models`` (check_layered_arch).
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.schemas.extraction import Framework
from app.schemas.template_structure import (
    AllowedUnits,
    AllowedValues,
    FieldName,
    FieldType,
    SectionEntryLabel,
    SectionLabel,
    SectionName,
)

PORTABLE_FORMAT_VERSION: Literal[1] = 1


# Spec §5.5: a pathological file becomes a fast 422, never a long transaction.
# The per-level caps multiply (100 × 200 × 2 levels), so a total bounds them.
MAX_SECTIONS_PER_LEVEL = 100
MAX_FIELDS_PER_SECTION = 200
MAX_TOTAL_FIELDS = 2000


class PortableField(BaseModel):
    """One ``extraction_fields`` row. ``type``/``required`` are the file keys
    (JSON Schema convention); the attributes keep the column names."""

    model_config = ConfigDict(extra="forbid")

    name: FieldName
    label: str = Field(min_length=1, max_length=100)
    field_type: FieldType = Field(alias="type")
    description: str | None = Field(default=None, max_length=500)
    is_required: bool = Field(default=False, alias="required")
    llm_description: str | None = Field(default=None, max_length=4000)
    allowed_values: AllowedValues | None = None
    unit: str | None = Field(default=None, max_length=50)
    allowed_units: AllowedUnits | None = None
    allow_other: bool = False
    other_label: str | None = Field(default=None, max_length=100)
    other_placeholder: str | None = Field(default=None, max_length=200)
    allows_not_applicable: bool = False
    allows_not_evaluated: bool = False
    # 0062. TRUE by default, unlike the two above: a bundle exported before the
    # column existed carries no key, and the marker WAS available then — so it
    # must re-import as available rather than silently off.
    allows_no_information: bool = True
    # 0059. Export and import are both generic — ``model_validate(...,
    # from_attributes=True)`` on the way out and ``**f.model_dump()`` in
    # ``_field_row`` on the way in — so this line is the whole feature.
    # Omitting it would not merely skip the flag: ``extra="forbid"`` makes
    # a bundle exported WITH the key fail to re-import, and one exported
    # without it degrades the template to "no key declared", which the AI
    # path refuses rather than duplicating.
    is_entity_key: bool = False


class PortableSection(BaseModel):
    """One ``extraction_entity_types`` row plus its fields and (for a group)
    its child sections. ``group`` ⇒ ``model_container``; nested ⇒
    ``model_section``; otherwise ``study_section``. ``entry_label`` is legal
    on any repeating section (a group, or ``repeats``); the import keeps the
    bundle's value verbatim, NULL included, and readers fall back to
    :data:`app.models.extraction.DEFAULT_ENTRY_LABEL` for a NULL."""

    model_config = ConfigDict(extra="forbid")

    name: SectionName
    label: SectionLabel
    description: str | None = Field(default=None, max_length=500)
    is_required: bool = Field(default=False, alias="required")
    repeats: bool = False
    group: bool = False
    entry_label: SectionEntryLabel | None = None
    fields: list[PortableField] = Field(default_factory=list, max_length=MAX_FIELDS_PER_SECTION)
    sections: list[PortableSection] = Field(default_factory=list, max_length=MAX_SECTIONS_PER_LEVEL)

    @model_validator(mode="after")
    def _section_rules(self) -> PortableSection:
        if self.sections and not self.group:
            raise ValueError("sections are only allowed inside a group")
        if self.entry_label is not None and not (self.group or self.repeats):
            raise ValueError("entry_label is only allowed on a repeating section")
        # A child carrying its own ``sections`` already failed the rule above
        # on itself (it is never a group), so depth > 1 needs no extra branch.
        for child in self.sections:
            if child.group:
                raise ValueError("a group must be a root section")
        names = [f.name for f in self.fields]
        if len(set(names)) != len(names):
            raise ValueError("duplicate field name within a section")
        return self


class PortableTemplate(BaseModel):
    """The document. ``prumo_template`` and ``kind`` have NO default so they
    are always emitted even under ``exclude_defaults``."""

    model_config = ConfigDict(extra="forbid")

    prumo_template: Literal[1]
    kind: Literal["extraction"]
    name: str = Field(min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=2000)
    framework: Framework = "CUSTOM"
    version: str = Field(default="1.0.0", max_length=50)
    llm_template_instruction: str | None = Field(default=None, max_length=4000)
    sections: list[PortableSection] = Field(min_length=1, max_length=MAX_SECTIONS_PER_LEVEL)

    @model_validator(mode="after")
    def _document_rules(self) -> PortableTemplate:
        if sum(1 for s in self.sections if s.group) > 1:
            raise ValueError("at most one group per template")
        total = sum(len(s.fields) + sum(len(c.fields) for c in s.sections) for s in self.sections)
        if total > MAX_TOTAL_FIELDS:
            raise ValueError(f"at most {MAX_TOTAL_FIELDS} fields per template (found {total})")
        return self
