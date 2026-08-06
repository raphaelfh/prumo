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

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

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


_INSTRUCTION_SQL = text(
    """
    SELECT llm_template_instruction
    FROM public.project_extraction_templates
    WHERE id = :tid
    """
)

_GENERAL_INSTRUCTIONS_SQL = text(
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
        await db.execute(_GENERAL_INSTRUCTIONS_SQL, {"vid": str(version_id)})
    ).scalar_one_or_none()
    return value or None


async def build_template_version_snapshot(
    db: AsyncSession, project_template_id: UUID
) -> dict[str, Any]:
    """Build the frozen ``{entity_types: [...]}`` snapshot for a project template."""
    row = await db.execute(SNAPSHOT_SQL, {"tid": str(project_template_id)})
    snapshot: dict[str, Any] = row.scalar_one()
    instruction = (
        await db.execute(_INSTRUCTION_SQL, {"tid": str(project_template_id)})
    ).scalar_one_or_none()
    if instruction:
        snapshot["llm_template_instruction"] = instruction
    return snapshot
