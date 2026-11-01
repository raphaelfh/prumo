"""Snapshot section reader for the publication-ready xlsx export (spec §5.1).

Reads the frozen per-Run / per-version template snapshot and returns
ordered ``SnapshotSection`` descriptors carrying parent + cardinality +
parent + full field metadata. This is the column-layout *anchor* and the
per-Run obsolete-field diff source.

The tree itself comes from the SHARED provider
(``extraction_snapshot.entity_types_for_version``, B-2/B-3a) — one
narrowness probe and one snapshot -> live fallback chain for every
consumer. This module only projects ``RunViewEntityType`` into the
export-specific frozen dataclasses (enum coercion +
``allowed_values`` normalization).

Layer-legal: ``services`` reading via the injected ``AsyncSession``; no
HTTP/storage/network types cross the boundary.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any
from uuid import UUID

from app.llm.claim_value import normalize_options
from app.models.extraction import (
    ExtractionCardinality,
    ExtractionFieldType,
)
from app.schemas.extraction_run import RunViewEntityType, RunViewField
from app.services.value_semantics import AbsentReason


@dataclass(frozen=True)
class AllowedValue:
    value: str
    label: str


@dataclass(frozen=True)
class SnapshotField:
    field_id: UUID
    name: str
    label: str
    type: ExtractionFieldType
    description: str | None
    llm_description: str | None
    unit: str | None
    allowed_values: tuple[AllowedValue, ...]
    is_required: bool
    allow_other: bool
    sort_order: int
    allowed_units: tuple[str, ...] = ()
    is_entity_key: bool = False
    # Coded absent markers the field allows, in ``AbsentReason`` order.
    allowed_absent_codes: tuple[str, ...] = ()


@dataclass(frozen=True)
class SnapshotSection:
    entity_type_id: UUID
    name: str
    label: str
    cardinality: ExtractionCardinality
    parent_entity_type_id: UUID | None
    sort_order: int
    fields: tuple[SnapshotField, ...]
    description: str | None = None
    # Entry noun of a repeating section (B-8, entry-group train); None on
    # legacy rows and pre-0051 snapshots (readers default, consumers fall
    # back to DEFAULT_ENTRY_LABEL).
    entry_label: str | None = None


def section_from_view(view: RunViewEntityType) -> SnapshotSection:
    return SnapshotSection(
        entity_type_id=view.id,
        name=view.name,
        label=view.label,
        cardinality=ExtractionCardinality(view.cardinality),
        parent_entity_type_id=view.parent_entity_type_id,
        sort_order=view.sort_order,
        fields=tuple(_field_from_view(f) for f in sorted(view.fields, key=lambda x: x.sort_order)),
        description=view.description,
        entry_label=view.entry_label,
    )


def _field_from_view(view: RunViewField) -> SnapshotField:
    return SnapshotField(
        field_id=view.id,
        name=view.name,
        label=view.label,
        type=ExtractionFieldType(view.field_type),
        description=view.description,
        llm_description=view.llm_description,
        unit=view.unit,
        allowed_values=_normalize_allowed_values(view.allowed_values),
        is_required=view.is_required,
        allow_other=view.allow_other,
        sort_order=view.sort_order,
        allowed_units=_unit_strings(view.allowed_units),
        is_entity_key=view.is_entity_key,
        allowed_absent_codes=_absent_codes(view),
    )


def _unit_strings(allowed_units: object) -> tuple[str, ...]:
    """The string units of a list; any other stored shape reads as none."""
    if not isinstance(allowed_units, list):
        return ()
    return tuple(u for u in allowed_units if isinstance(u, str))


_ABSENT_FLAGS: dict[AbsentReason, str] = {
    AbsentReason.NO_INFORMATION: "allows_no_information",
    AbsentReason.NOT_APPLICABLE: "allows_not_applicable",
    AbsentReason.NOT_EVALUATED: "allows_not_evaluated",
}


def _absent_codes(view: RunViewField) -> tuple[str, ...]:
    """The absent codes a field opts into, in ``AbsentReason`` order."""
    return tuple(r.value for r in AbsentReason if getattr(view, _ABSENT_FLAGS[r]))


def _normalize_allowed_values(raw: Any) -> tuple[AllowedValue, ...]:
    """Normalise the ``allowed_values`` jsonb into ordered value+label pairs,
    read through ``normalize_options``."""
    return tuple(AllowedValue(value=o["value"], label=o["label"]) for o in normalize_options(raw))
