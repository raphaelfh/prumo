"""Single source of truth for the template-version snapshot shape.

``RunLifecycleService._snapshot_initial_version`` and
``TemplateCloneService._snapshot`` both freeze the entity_types + fields tree
into ``extraction_template_versions.schema_``. They used to embed two copies of
the ``jsonb_build_object`` SQL that drifted — ``role`` was added to the clone
builder but not the lifecycle one (forcing migration 0017 to retro-patch).
This module owns the single, widened query so the two builders cannot diverge
again, and so migration 0026 can backfill old snapshots to the same shape.

The key set mirrors the data columns of ``ExtractionEntityType`` and
``ExtractionField`` that the run-open form renders from (FK/audit columns are
intentionally excluded — the form does not read them).

The top-level ``llm_template_instruction`` key is **conditional**: appended in
Python only when the template's live column is non-NULL/non-empty (absent ≡
NULL — a legacy template's next republish stays byte-identical, no phantom
v+1). It is deliberately NOT backfilled into old snapshots and needs no
migration-0026-style copy: 0026 only rewrites snapshots lacking ``role``,
which all pre-date this key.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.extraction import ExtractionEntityType
from app.models.extraction_versioning import ExtractionTemplateVersion
from app.schemas.extraction_run import RunViewEntityType

# WARNING: migration 0026_widen_template_snapshot embeds a copy of this
# key set for its one-time backfill. If you add a key here, update that
# migration's SQL too (migrations must stay self-contained; they cannot import
# app code that may change after they are committed).
SNAPSHOT_SQL = text(
    """
    SELECT jsonb_build_object(
        'entity_types', COALESCE(
            (
                SELECT jsonb_agg(
                    jsonb_build_object(
                        'id', et.id,
                        'name', et.name,
                        'label', et.label,
                        'description', et.description,
                        'parent_entity_type_id', et.parent_entity_type_id,
                        'cardinality', et.cardinality,
                        'role', et.role,
                        'sort_order', et.sort_order,
                        'is_required', et.is_required,
                        'fields', COALESCE(
                            (
                                SELECT jsonb_agg(jsonb_build_object(
                                    'id', f.id,
                                    'name', f.name,
                                    'label', f.label,
                                    'description', f.description,
                                    'field_type', f.field_type,
                                    'is_required', f.is_required,
                                    'validation_schema', f.validation_schema,
                                    'allowed_values', f.allowed_values,
                                    'unit', f.unit,
                                    'allowed_units', f.allowed_units,
                                    'sort_order', f.sort_order,
                                    'llm_description', f.llm_description,
                                    'allow_other', f.allow_other,
                                    'other_label', f.other_label,
                                    'other_placeholder', f.other_placeholder,
                                    'allows_not_applicable', f.allows_not_applicable,
                                    'allows_not_evaluated', f.allows_not_evaluated
                                ) ORDER BY f.sort_order)
                                FROM public.extraction_fields f
                                WHERE f.entity_type_id = et.id
                            ),
                            '[]'::jsonb
                        )
                    ) ORDER BY et.sort_order
                )
                FROM public.extraction_entity_types et
                WHERE et.project_template_id = :tid
            ),
            '[]'::jsonb
        )
    )
    """
)


_LIVE_INSTRUCTION_SQL = text(
    """
    SELECT llm_template_instruction
    FROM public.project_extraction_templates
    WHERE id = :tid
    """
)

_PINNED_INSTRUCTION_SQL = text(
    """
    SELECT schema ->> 'llm_template_instruction'
    FROM public.extraction_template_versions
    WHERE id = :vid
    """
)


async def general_instructions_for_version(db: AsyncSession, version_id: UUID) -> str | None:
    """Template-level general instruction pinned in a version snapshot.

    Prompts must read the pinned snapshot, never the live column — a run
    keeps the instruction it was opened under until a republish re-pins
    it (spec §4). Returns None when the version has no key (legacy) or
    the value is empty.
    """
    value = (
        await db.execute(_PINNED_INSTRUCTION_SQL, {"vid": str(version_id)})
    ).scalar_one_or_none()
    return value or None


async def build_template_version_snapshot(
    db: AsyncSession, project_template_id: UUID
) -> dict[str, Any]:
    """Build the frozen ``{entity_types: [...]}`` snapshot for a project template."""
    row = await db.execute(SNAPSHOT_SQL, {"tid": str(project_template_id)})
    snapshot: dict[str, Any] = row.scalar_one()
    instruction = (
        await db.execute(_LIVE_INSTRUCTION_SQL, {"tid": str(project_template_id)})
    ).scalar_one_or_none()
    if instruction:
        snapshot["llm_template_instruction"] = instruction
    return snapshot


def snapshot_is_narrow(entity_types: list[dict[str, Any]]) -> bool:
    """Detect snapshots the run view / prompts cannot trust structurally.

    Narrow = empty, or ANY element lacking ``role``. Per-element (not just
    ``entity_types[0]``): a heterogeneous snapshot — 0017-patched first
    element, unpatched later one — would pass a first-element check and
    then blow up ``model_validate`` on element N (``role`` has no
    default). Empty is treated as narrow so the live fallback repopulates
    it; a legitimately empty template just round-trips to an empty live
    read, which is the correct (if marginally wasteful) recovery — and it
    is what keeps an empty pinned snapshot from turning AI extraction
    into a green no-op run.
    """
    return not entity_types or any("role" not in et for et in entity_types)


async def entity_types_for_version(
    db: AsyncSession, *, version_id: UUID, template_id: UUID
) -> list[RunViewEntityType]:
    """The frozen entity-types tree a run is pinned to (spec §1.1).

    THE shared provider for every snapshot-structure consumer — the run
    view and both AI prompt services — so the fallback chain lives in one
    place: pinned snapshot → live rows when the snapshot is narrow, empty,
    heterogeneous, or the version row is missing. Both paths produce the
    same shape via ``model_validate`` (``RunViewEntityType`` /
    ``RunViewField`` carry ``from_attributes=True``), and ids round-trip
    as ``UUID`` — consumers match them against DB-sourced ids, where a
    ``str`` would silently never hit.
    """
    version = await db.get(ExtractionTemplateVersion, version_id)
    snapshot_types: list[dict[str, Any]] = (
        (version.schema_ or {}).get("entity_types", []) if version else []
    )
    if not snapshot_is_narrow(snapshot_types):
        return [RunViewEntityType.model_validate(et) for et in snapshot_types]

    # Live fallback — one statement, fields eager-loaded (selectinload).
    # The relationship is not guaranteed field-ordered, so sort the
    # validated fields by sort_order to match the snapshot path.
    et_rows = (
        (
            await db.execute(
                select(ExtractionEntityType)
                .where(ExtractionEntityType.project_template_id == template_id)
                .options(selectinload(ExtractionEntityType.fields))
                .order_by(ExtractionEntityType.sort_order)
            )
        )
        .scalars()
        .all()
    )
    result: list[RunViewEntityType] = []
    for et in et_rows:
        view_et = RunViewEntityType.model_validate(et)
        view_et.fields.sort(key=lambda f: f.sort_order)
        result.append(view_et)
    return result
