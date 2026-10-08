"""Seed the singleton ``extraction_instances`` an article needs under a template.

One instance per top-level cardinality-one entity type, and one child
instance per (parent instance, cardinality-one child entity type) — the
invariant the HITL form binds its decisions to. Two callers share it, and
that sharing is why it lives here rather than on either:

* session open (``HITLSessionService.open_or_resume``) seeds before the Run
  is resolved;
* publish (``template_versioning``) re-seeds every run it re-pins, so a
  newly added section has an instance before the finalize gate counts it.

Idempotent under the (article, template) advisory lock it takes.
"""

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction import (
    ExtractionCardinality,
    ExtractionEntityType,
    ExtractionInstance,
)
from app.services.advisory_locks import take_advisory_xact_lock


async def ensure_instances(
    db: AsyncSession,
    *,
    project_id: UUID,
    article_id: UUID,
    project_template_id: UUID,
    entity_types: list[ExtractionEntityType],
    user_id: UUID,
) -> dict[UUID, UUID]:
    """Seed the missing singleton instances; return ``{entity_type_id: instance_id}``."""
    # Issue #64: serialise concurrent open_or_resume calls for the same
    # (article, template) pair so the SELECT-then-INSERT below cannot
    # race and produce duplicate singleton instances. The lock is
    # transaction-scoped, so it is released on commit / rollback and
    # does not require explicit cleanup. The same lock also protects
    # the active-run lookup in ``HITLSessionService._reuse_or_create_run`` (issue #70).
    await take_advisory_xact_lock(db, article_id, project_template_id)

    existing_stmt = select(ExtractionInstance).where(
        ExtractionInstance.article_id == article_id,
        ExtractionInstance.template_id == project_template_id,
    )
    existing_rows = list((await db.execute(existing_stmt)).scalars().all())
    by_entity: dict[UUID, UUID] = {row.entity_type_id: row.id for row in existing_rows}

    pending_instances: list[tuple[UUID, ExtractionInstance]] = []
    for et in entity_types:
        # Many-cardinality entity types add instances dynamically through the
        # extraction UI; the session only seeds the singletons (top-level,
        # one-cardinality entity types).
        if et.id in by_entity:
            continue
        if et.parent_entity_type_id is not None:
            continue
        # Issue #71: the parent-id guard only filters child entity types.
        # Top-level entity types with cardinality=MANY must NOT receive
        # a phantom singleton instance — the UI creates them on demand.
        if et.cardinality != ExtractionCardinality.ONE.value:
            continue
        inst = ExtractionInstance(
            project_id=project_id,
            article_id=article_id,
            template_id=project_template_id,
            entity_type_id=et.id,
            parent_instance_id=None,
            label=et.label,
            sort_order=et.sort_order,
            metadata_={"created_via": "hitl_session"},
            created_by=user_id,
        )
        pending_instances.append((et.id, inst))

    if pending_instances:
        db.add_all([inst for _, inst in pending_instances])
        await db.flush()
        for entity_type_id, instance in pending_instances:
            by_entity[entity_type_id] = instance.id
            existing_rows.append(instance)

    # Backfill of late-added singleton children (issue #71 follow-up) runs
    # over the full ``existing_rows`` snapshot — both the pre-existing rows
    # and the ones we just flushed — so cardinality=one children of every
    # parent instance are materialised on session open.
    await _backfill_child_singletons(
        db,
        project_id=project_id,
        article_id=article_id,
        project_template_id=project_template_id,
        entity_types=entity_types,
        user_id=user_id,
        existing_rows=existing_rows,
    )

    return by_entity


async def _backfill_child_singletons(
    db: AsyncSession,
    *,
    project_id: UUID,
    article_id: UUID,
    project_template_id: UUID,
    entity_types: list[ExtractionEntityType],
    user_id: UUID,
    existing_rows: list[ExtractionInstance],
) -> None:
    """Materialise missing cardinality='one' child instances for
    existing parent instances.

    Maintains the invariant: for every parent instance, every
    cardinality='one' child entity type has exactly one matching
    instance under it. The original ``ensure_instances`` only seeded
    top-level singletons; it never touched children. That left a gap:

    * A manager adds a new sub-section under ``prediction_models`` in
      the Configuration tab (e.g. inserts a new ``extraction_entity_types``
      row with ``parent_entity_type_id`` pointing at an existing
      many-parent) AFTER models for the article were already created.
    * Existing model instances would not have an instance of the new
      sub-section, so the form rendered the fields but had no instance
      to bind ``ReviewerDecision``/``PublishedState`` to — orphan UI.

    Running this on every session open also covers the symmetric case
    for cardinality='one' parents whose children were added later, and
    is idempotent: it only inserts when the (parent_instance, child
    entity_type) pair has no row yet. Same advisory lock as the
    top-level seeding above guards against duplicates under
    concurrent opens.
    """
    many_one_pairs: dict[UUID, list[ExtractionEntityType]] = {}
    for et in entity_types:
        if et.parent_entity_type_id is None:
            continue
        if et.cardinality != ExtractionCardinality.ONE.value:
            continue
        many_one_pairs.setdefault(et.parent_entity_type_id, []).append(et)

    if not many_one_pairs:
        return

    existing_children: set[tuple[UUID, UUID]] = {
        (row.parent_instance_id, row.entity_type_id)
        for row in existing_rows
        if row.parent_instance_id is not None
    }

    # Snapshot parent instances by entity_type so we can iterate the
    # singleton invariant per (parent_instance, child_entity_type).
    parent_instances_by_et: dict[UUID, list[ExtractionInstance]] = {}
    for row in existing_rows:
        if row.entity_type_id in many_one_pairs:
            parent_instances_by_et.setdefault(row.entity_type_id, []).append(row)

    inserted = False
    for parent_et_id, child_ets in many_one_pairs.items():
        for parent_inst in parent_instances_by_et.get(parent_et_id, []):
            for child_et in child_ets:
                if (parent_inst.id, child_et.id) in existing_children:
                    continue
                db.add(
                    ExtractionInstance(
                        project_id=project_id,
                        article_id=article_id,
                        template_id=project_template_id,
                        entity_type_id=child_et.id,
                        parent_instance_id=parent_inst.id,
                        label=f"{parent_inst.label} - {child_et.label} 1",
                        sort_order=child_et.sort_order,
                        metadata_={"created_via": "hitl_session_backfill"},
                        created_by=user_id,
                    )
                )
                existing_children.add((parent_inst.id, child_et.id))
                inserted = True

    if inserted:
        await db.flush()
