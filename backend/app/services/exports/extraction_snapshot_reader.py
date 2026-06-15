"""Snapshot section reader for the publication-ready xlsx export (spec §5.1).

Reads the frozen per-Run / per-version template snapshot
(``extraction_template_versions.schema_["entity_types"]``) and returns
ordered ``SnapshotSection`` descriptors carrying role + cardinality +
parent + full field metadata. This is the column-layout *anchor* and the
per-Run obsolete-field diff source. It mirrors
``extraction_run_read_service._entity_types_for_run``: validate the frozen
snapshot via ``RunViewEntityType``/``RunViewField``; fall back to the live
tables only for a pre-0026 *narrow* snapshot.

Layer-legal: ``services`` reading via the injected ``AsyncSession``; no
HTTP/storage/network types cross the boundary.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.extraction import (
    ExtractionCardinality,
    ExtractionEntityType,
    ExtractionFieldType,
)
from app.models.extraction_versioning import ExtractionTemplateVersion
from app.schemas.extraction_run import RunViewEntityType, RunViewField


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


def _snapshot_is_narrow(entity_types: list[dict[str, Any]]) -> bool:
    """A pre-0026 snapshot lacks 'role' on its first entity_type (mirrors the
    run-read service). Empty trees are treated as narrow so the live fallback
    repopulates them."""
    return not entity_types or "role" not in entity_types[0]


async def load_export_sections(
    db: AsyncSession,
    *,
    version_id: UUID,
) -> tuple[SnapshotSection, ...]:
    """Read the frozen entity_types tree for a version snapshot, ordered by
    ``sort_order``. Returns ``()`` only when the version row itself is missing;
    an empty or pre-0026 *narrow* tree falls through to the live tables, exactly
    like the canonical ``_entity_types_for_run`` it mirrors."""
    version = await db.get(ExtractionTemplateVersion, version_id)
    if version is None:
        return ()
    snapshot_types: list[dict[str, Any]] = (version.schema_ or {}).get("entity_types", [])
    if _snapshot_is_narrow(snapshot_types):
        return await _load_live_sections(db, version.project_template_id)
    return tuple(_section_from_view(RunViewEntityType.model_validate(et)) for et in snapshot_types)


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


async def _load_live_sections(
    db: AsyncSession,
    project_template_id: UUID,
) -> tuple[SnapshotSection, ...]:
    """Live-table fallback for pre-0026 narrow snapshots (belt-and-suspenders).

    One statement, fields eager-loaded; validated through the same
    ``RunViewEntityType`` path so both branches produce the same shape.
    """
    et_rows = (
        (
            await db.execute(
                select(ExtractionEntityType)
                .where(ExtractionEntityType.project_template_id == project_template_id)
                .options(selectinload(ExtractionEntityType.fields))
                .order_by(ExtractionEntityType.sort_order)
            )
        )
        .scalars()
        .all()
    )
    return tuple(_section_from_view(RunViewEntityType.model_validate(et)) for et in et_rows)
