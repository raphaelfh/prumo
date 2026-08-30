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
# key set for its one-time backfill. If you add a key here for a column that
# already existed at 0026's revision, update that migration's SQL too
# (migrations must stay self-contained; they cannot import app code that may
# change after they are committed). Keys for columns added AFTER 0026's slot
# (e.g. ``entry_label``, 0051) are exempt by construction — on a fresh-DB
# upgrade 0026 runs before the column exists, so mirroring them would fail
# with UndefinedColumn; readers treat the absent key as its null default
# (same precedent as ``llm_template_instruction`` in the module docstring).
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
                        'entry_label', et.entry_label,
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
                                    'allows_not_evaluated', f.allows_not_evaluated,
                                    'allows_no_information', f.allows_no_information
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


# WARNING: this is the ONLY template-level live column the snapshot carries,
# and ``TemplateCloneService._refuse_if_instruction_draft_pending`` depends on
# that being true — its zero-state guard compares exactly this key, because
# everything else in the snapshot is rebuilt from the global template. Adding
# a second template-level key here without extending that guard silently
# re-opens the hole where a project MEMBER publishes a manager's draft.
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

    Narrow = empty, ANY element lacking ``role``, or ANY field lacking a
    wide-builder key. Three eras motivate the three probes:

    - pre-0017: no ``role`` at all;
    - 0017-patched pre-0016 rows and 0016→0026-era clone snapshots:
      ``role`` present (0017 injected it in place) but the FIELD objects
      predate the wide builder — migration 0026's backfill keys on the
      role probe and skips exactly these, so ``model_validate`` would
      serve them with ``llm_description``/``allow_other`` silently
      defaulted where the pre-B-2 code read live rows;
    - heterogeneous mixes of the above.

    Per-element, per-field: one narrow member chains the whole tree to
    the live fallback. Empty is narrow so the fallback repopulates it —
    which is also what keeps an empty pinned snapshot from turning AI
    extraction into a green no-op run.
    """
    if not entity_types:
        return True
    for et in entity_types:
        if "role" not in et:
            return True
        for field in et.get("fields") or []:
            if "llm_description" not in field or "allow_other" not in field:
                return True
    return False


def baseline_is_restorable(schema_: dict[str, Any] | None) -> bool:
    """Can this published snapshot be written back over the live rows (B-9c1)?

    The gate is ``entity_types and snapshot_is_narrow(entity_types)`` and the
    leading truthiness test is load-bearing in the opposite direction from
    every other caller: :func:`snapshot_is_narrow` calls an EMPTY list narrow
    *by design*, so the run view falls back to live rows — but an empty
    published baseline is perfectly restorable, the restore being a plain
    delete-all. Only a pre-0026 baseline with actual content is unrestorable:
    writing it back would wipe ``llm_description``/``allow_other``
    project-wide (that era gets Discard in B-9x).

    Shared so the endpoint's refusal and the Configuration tab's
    ``discard_available`` flag can never disagree about the same template.
    """
    entity_types = (schema_ or {}).get("entity_types") or []
    return not (entity_types and snapshot_is_narrow(entity_types))


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
