"""Snapshot section reader for the publication-ready xlsx export (spec §5.1).

Reads the frozen per-Run / per-version template snapshot and returns
ordered ``SnapshotSection`` descriptors carrying role + cardinality +
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

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction import (
    ExtractionCardinality,
    ExtractionFieldType,
)
from app.models.extraction_versioning import ExtractionTemplateVersion
from app.schemas.extraction_run import RunViewEntityType, RunViewField
from app.services.extraction_snapshot import entity_types_for_version


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


@dataclass(frozen=True)
class SnapshotSection:
    entity_type_id: UUID
    name: str
    label: str
    role: Any  # ExtractionEntityRole — typed loosely to avoid an import cycle on load
    cardinality: ExtractionCardinality
    parent_entity_type_id: UUID | None
    sort_order: int
    fields: tuple[SnapshotField, ...]
    description: str | None = None


async def load_export_sections(
    db: AsyncSession,
    *,
    version_id: UUID,
) -> tuple[SnapshotSection, ...]:
    """Read the frozen entity_types tree for a version snapshot, ordered by
    ``sort_order``, via the shared provider (its per-field narrowness probe
    replaced this module's stale first-element/role-only copy, which
    accepted 0016->0026-era snapshots and silently defaulted
    ``llm_description``/``allow_other`` in exports). Returns ``()`` only
    when the version row itself is missing (unreachable for FK-sourced
    ids — defensive)."""
    version = await db.get(ExtractionTemplateVersion, version_id)
    if version is None:
        return ()
    views = await entity_types_for_version(
        db, version_id=version_id, template_id=version.project_template_id
    )
    return tuple(_section_from_view(view) for view in views)


def _section_from_view(view: RunViewEntityType) -> SnapshotSection:
    from app.models.extraction import ExtractionEntityRole

    return SnapshotSection(
        entity_type_id=view.id,
        name=view.name,
        label=view.label,
        role=ExtractionEntityRole(view.role),
        cardinality=ExtractionCardinality(view.cardinality),
        parent_entity_type_id=view.parent_entity_type_id,
        sort_order=view.sort_order,
        fields=tuple(_field_from_view(f) for f in sorted(view.fields, key=lambda x: x.sort_order)),
        description=view.description,
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
    )


def _normalize_allowed_values(raw: Any) -> tuple[AllowedValue, ...]:
    """Normalise the ``allowed_values`` jsonb into ordered value+label pairs.

    Stored either as ``[{"value": ..., "label": ...}, ...]`` or ``["x", ...]``;
    value == label in prumo (spec §11), but both are preserved when present.
    """
    if not isinstance(raw, list):
        return ()
    out: list[AllowedValue] = []
    for item in raw:
        if isinstance(item, dict):
            value = item.get("value")
            label = item.get("label") or value
            if isinstance(value, str):
                out.append(AllowedValue(value=value, label=str(label)))
        elif isinstance(item, str):
            out.append(AllowedValue(value=item, label=item))
    return tuple(out)
