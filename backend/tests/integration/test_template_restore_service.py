"""Integration tests for the snapshot -> live restore writer (B-9c1, T1).

Real DB on purpose: the subject of this writer is the set of database
rules a "reasonable" implementation walks straight into —
``extraction_fields.entity_type_id`` ON DELETE **CASCADE** (deleting a
draft-added section destroys any baseline field the draft had moved into
it), the immediate ``uq_extraction_fields_entity_type_name`` index (a
delete-plus-rename-into-the-freed-name draft collides during the create
pass), the immediate ``ck_extraction_entity_types_role_parent`` check and
the deferred model_section-under-model_container trigger.

Every case runs through :func:`_assert_restored`, which makes the five
assertions plan T1 requires of each one:

1. ``diff_snapshots(baseline, rebuilt).total == 0`` — never ``==`` on the
   raw JSON, because era drift makes that false while the tree is right;
2. the full ``(id, sort_order)`` map matches the baseline for BOTH node
   kinds (the diff excludes ``sort_order`` and never compares entity-type
   order at all);
3. row counts and id sets equal the baseline's;
4. rows the restore should not have touched are byte-identical to a
   pre-restore capture;
5. ``SET CONSTRAINTS ALL IMMEDIATE`` before any of it, so a case that must
   prove a valid role/parent tree actually proves it.

**On assertion 4**: ``created_at``/``updated_at`` both default to
``now()``, which in PostgreSQL is the *transaction* timestamp — inside
one savepoint-isolated test transaction every row carries the same value
and the mandated comparison can never fail. The capture therefore also
records ``ctid``, which changes on every physical row write (MVCC writes
a new tuple version) and is the assertion that actually bites.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID, uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.extraction_snapshot import build_template_version_snapshot
from app.services.template_diff import diff_snapshots
from app.services.template_restore_service import (
    ContainerSwapUnsupportedError,
    RestoreOutcome,
    restore_snapshot,
)
from app.services.template_version_service import TemplateVersionService
from tests.integration.conftest import (
    SEED,
    clean_project_clones,
    clone_charms,
    get_config_draft_marker,
)
from tests.integration.helpers.template_fixtures import entry_key_holders, set_entry_key

# --------------------------------------------------------------------------
# Baseline setup
# --------------------------------------------------------------------------


async def _fresh_charms(
    db: AsyncSession, *, instruction: str | None = None
) -> tuple[UUID, UUID, dict[str, Any]]:
    """A real WIDE baseline: clone CHARMS into the secondary project and
    publish the live tree.

    Never the bare seeded template version — its snapshot is
    ``{"entity_types": []}``, which is a different (and separately
    interesting) case, not a restorable baseline.

    ``instruction`` is written onto the clone *before* the publish, so the
    baseline carries it. Pass it rather than relying on whatever the global
    CHARMS row happens to hold: ``backfill_llm_template_instructions`` runs
    in ``python -m app.seed``, not in the autouse SEED fixture, so a
    long-lived local database has an instruction where CI does not.
    """
    project_id = SEED.secondary_project
    await clean_project_clones(db, project_id)
    clone = await clone_charms(db, project_id, SEED.primary_profile)
    template_id = clone.project_template_id
    if instruction is not None:
        await _set_instruction(db, template_id, instruction)
    await TemplateVersionService(db).republish(
        project_id=project_id,
        project_template_id=template_id,
        user_id=SEED.primary_profile,
    )
    baseline = (
        await db.execute(
            text(
                "SELECT schema FROM public.extraction_template_versions "
                "WHERE project_template_id = :tid AND is_active IS TRUE"
            ),
            {"tid": str(template_id)},
        )
    ).scalar_one()
    assert baseline["entity_types"], "CHARMS clone must publish a non-empty baseline"
    return project_id, template_id, baseline


# --------------------------------------------------------------------------
# Baseline introspection
# --------------------------------------------------------------------------


def _baseline_entity(baseline: dict[str, Any], name: str) -> dict[str, Any]:
    for entity in baseline["entity_types"]:
        if entity["name"] == name:
            return entity
    raise AssertionError(f"No entity type named {name} in the baseline")


def _baseline_entity_orders(baseline: dict[str, Any]) -> dict[UUID, int]:
    return {UUID(et["id"]): et["sort_order"] for et in baseline["entity_types"]}


def _baseline_field_orders(baseline: dict[str, Any]) -> dict[UUID, int]:
    return {
        UUID(f["id"]): f["sort_order"]
        for et in baseline["entity_types"]
        for f in et.get("fields") or []
    }


# --------------------------------------------------------------------------
# Live introspection
# --------------------------------------------------------------------------


async def _live_entity_orders(db: AsyncSession, template_id: UUID) -> dict[UUID, int]:
    rows = await db.execute(
        text(
            "SELECT id, sort_order FROM public.extraction_entity_types "
            "WHERE project_template_id = :tid"
        ),
        {"tid": str(template_id)},
    )
    return {row.id: row.sort_order for row in rows}


async def _live_field_orders(db: AsyncSession, template_id: UUID) -> dict[UUID, int]:
    rows = await db.execute(
        text(
            "SELECT f.id, f.sort_order FROM public.extraction_fields f "
            "JOIN public.extraction_entity_types et ON et.id = f.entity_type_id "
            "WHERE et.project_template_id = :tid"
        ),
        {"tid": str(template_id)},
    )
    return {row.id: row.sort_order for row in rows}


async def _entity_id(db: AsyncSession, template_id: UUID, name: str) -> UUID:
    return (
        await db.execute(
            text(
                "SELECT id FROM public.extraction_entity_types "
                "WHERE project_template_id = :tid AND name = :name"
            ),
            {"tid": str(template_id), "name": name},
        )
    ).scalar_one()


async def _field_id(db: AsyncSession, template_id: UUID, entity_name: str, field_name: str) -> UUID:
    return (
        await db.execute(
            text(
                "SELECT f.id FROM public.extraction_fields f "
                "JOIN public.extraction_entity_types et ON et.id = f.entity_type_id "
                "WHERE et.project_template_id = :tid AND et.name = :en AND f.name = :fn"
            ),
            {"tid": str(template_id), "en": entity_name, "fn": field_name},
        )
    ).scalar_one()


async def _drifted_field_ids(
    db: AsyncSession, template_id: UUID, baseline: dict[str, Any]
) -> frozenset[UUID]:
    """Fields whose live ``(parent, sort_order)`` no longer matches the
    baseline — the exact update set of a move/reorder-only draft."""
    rows = await db.execute(
        text(
            "SELECT f.id, f.entity_type_id, f.sort_order FROM public.extraction_fields f "
            "JOIN public.extraction_entity_types et ON et.id = f.entity_type_id "
            "WHERE et.project_template_id = :tid"
        ),
        {"tid": str(template_id)},
    )
    base = {
        UUID(f["id"]): (UUID(et["id"]), f["sort_order"])
        for et in baseline["entity_types"]
        for f in et.get("fields") or []
    }
    return frozenset(
        row.id for row in rows if base.get(row.id) != (row.entity_type_id, row.sort_order)
    )


async def _field_parent(db: AsyncSession, field_id: UUID) -> UUID:
    return (
        await db.execute(
            text("SELECT entity_type_id FROM public.extraction_fields WHERE id = :fid"),
            {"fid": str(field_id)},
        )
    ).scalar_one()


_Stamp = tuple[Any, Any, str]


async def _capture(db: AsyncSession, template_id: UUID) -> dict[str, dict[UUID, _Stamp]]:
    """Per-row write fingerprint: the plan's ``created_at``/``updated_at``
    plus ``ctid`` (see the module docstring — the timestamps alone cannot
    detect a write inside one transaction)."""
    entities = await db.execute(
        text(
            "SELECT id, created_at, updated_at, ctid::text AS ctid "
            "FROM public.extraction_entity_types WHERE project_template_id = :tid"
        ),
        {"tid": str(template_id)},
    )
    fields = await db.execute(
        text(
            "SELECT f.id, f.created_at, f.updated_at, f.ctid::text AS ctid "
            "FROM public.extraction_fields f "
            "JOIN public.extraction_entity_types et ON et.id = f.entity_type_id "
            "WHERE et.project_template_id = :tid"
        ),
        {"tid": str(template_id)},
    )
    return {
        "entity_types": {r.id: (r.created_at, r.updated_at, r.ctid) for r in entities},
        "fields": {r.id: (r.created_at, r.updated_at, r.ctid) for r in fields},
    }


# --------------------------------------------------------------------------
# The shared five-assertion helper
# --------------------------------------------------------------------------


async def _assert_restored(
    db: AsyncSession,
    *,
    template_id: UUID,
    baseline: dict[str, Any],
    capture: dict[str, dict[UUID, _Stamp]],
    touched_entity_ids: frozenset[UUID] = frozenset(),
    touched_field_ids: frozenset[UUID] = frozenset(),
    extra_entity_ids: frozenset[UUID] = frozenset(),
    extra_field_ids: frozenset[UUID] = frozenset(),
    unrestorable_field_ids: frozenset[UUID] = frozenset(),
) -> None:
    """Assertions 1-5 of plan T1. ``extra_*`` are nodes a partial restore
    deliberately KEPT (the ``skip_entity_type_ids`` path); ``touched_*``
    are rows the restore was supposed to rewrite;
    ``unrestorable_field_ids`` are BASELINE fields a kept node's name slot
    put out of reach — they drop out of both sides of every comparison, so
    the rest of the tree is still asserted exactly."""
    # (5) — forces the deferred role/parent trigger and the active-version
    # trigger to run now, exactly as commit would.
    await db.execute(text("SET CONSTRAINTS ALL IMMEDIATE"))

    # (1) — structural equality via the diff, never == on the raw JSON.
    rebuilt = await build_template_version_snapshot(db, template_id)
    diff = diff_snapshots(baseline, rebuilt, fields_with_values=frozenset())
    extras = extra_entity_ids | extra_field_ids | unrestorable_field_ids
    unexplained = [c for c in diff.changes if c.node_id not in extras]
    assert not unexplained, f"restore left {len(unexplained)} change(s): {unexplained}"

    # (2) — the full (id, sort_order) map, both node kinds. The diff cannot
    # see entity-type order at all and ignores field sort_order by design.
    base_entity_orders = _baseline_entity_orders(baseline)
    base_field_orders = {
        k: v for k, v in _baseline_field_orders(baseline).items() if k not in unrestorable_field_ids
    }
    live_entity_orders = await _live_entity_orders(db, template_id)
    live_field_orders = {
        k: v
        for k, v in (await _live_field_orders(db, template_id)).items()
        if k not in unrestorable_field_ids
    }
    assert {
        k: v for k, v in live_entity_orders.items() if k not in extra_entity_ids
    } == base_entity_orders
    assert {
        k: v for k, v in live_field_orders.items() if k not in extra_field_ids
    } == base_field_orders

    # (3) — row counts and id sets.
    assert set(live_entity_orders) == set(base_entity_orders) | extra_entity_ids
    assert set(live_field_orders) == set(base_field_orders) | extra_field_ids
    assert len(live_entity_orders) == len(base_entity_orders) + len(extra_entity_ids)
    assert len(live_field_orders) == len(base_field_orders) + len(extra_field_ids)

    # (4) — no SURVIVING row was rewritten. Rows the restore was supposed to
    # remove drop out here; assertion 3 already owns "did it go away".
    after = await _capture(db, template_id)
    survivors = (
        ("entity_types", touched_entity_ids, set(base_entity_orders) | extra_entity_ids),
        ("fields", touched_field_ids, set(base_field_orders) | extra_field_ids),
    )
    for kind, touched, expected in survivors:
        for node_id, stamp in capture[kind].items():
            if node_id in touched or node_id not in expected:
                continue
            assert after[kind].get(node_id) == stamp, (
                f"{kind[:-1]} {node_id} was rewritten but should not have been"
            )


async def _restore(
    db: AsyncSession,
    *,
    project_id: UUID,
    template_id: UUID,
    baseline: dict[str, Any],
    skip_entity_type_ids: frozenset[UUID] = frozenset(),
) -> RestoreOutcome:
    return await restore_snapshot(
        db,
        project_id=project_id,
        template_id=template_id,
        snapshot=baseline,
        skip_entity_type_ids=skip_entity_type_ids,
    )


# --------------------------------------------------------------------------
# Draft edits — the shapes the config editor writes through PostgREST
# --------------------------------------------------------------------------


async def _set_label(db: AsyncSession, table: str, node_id: UUID, label: str) -> None:
    await db.execute(
        text(f"UPDATE public.{table} SET label = :label WHERE id = :id"),  # noqa: S608
        {"id": str(node_id), "label": label},
    )
    await db.flush()


async def _set_field_name(db: AsyncSession, field_id: UUID, name: str) -> None:
    await db.execute(
        text("UPDATE public.extraction_fields SET name = :name WHERE id = :id"),
        {"id": str(field_id), "name": name},
    )
    await db.flush()


async def _set_sort_order(db: AsyncSession, table: str, node_id: UUID, order: int) -> None:
    await db.execute(
        text(f"UPDATE public.{table} SET sort_order = :o WHERE id = :id"),  # noqa: S608
        {"id": str(node_id), "o": order},
    )
    await db.flush()


async def _add_field(
    db: AsyncSession, entity_type_id: UUID, name: str, *, sort_order: int = 99
) -> UUID:
    field_id = uuid4()
    await db.execute(
        text(
            "INSERT INTO public.extraction_fields "
            "(id, entity_type_id, name, label, field_type, is_required, sort_order, "
            " allow_other, allows_not_applicable, allows_not_evaluated) "
            "VALUES (:id, :et, :name, :label, 'text', false, :o, false, false, false)"
        ),
        {
            "id": str(field_id),
            "et": str(entity_type_id),
            "name": name,
            "label": name,
            "o": sort_order,
        },
    )
    await db.flush()
    return field_id


async def _delete_field(db: AsyncSession, field_id: UUID) -> None:
    await db.execute(
        text("DELETE FROM public.extraction_fields WHERE id = :id"), {"id": str(field_id)}
    )
    await db.flush()


async def _add_section(
    db: AsyncSession,
    template_id: UUID,
    name: str,
    *,
    role: str = "study_section",
    parent_id: UUID | None = None,
    cardinality: str = "one",
    sort_order: int = 99,
    entry_label: str | None = None,
) -> UUID:
    entity_id = uuid4()
    await db.execute(
        text(
            "INSERT INTO public.extraction_entity_types "
            "(id, project_template_id, template_id, name, label, parent_entity_type_id, "
            " cardinality, role, sort_order, is_required, entry_label) "
            "VALUES (:id, :tid, NULL, :name, :label, :parent, CAST(:card AS extraction_cardinality),"
            " CAST(:role AS extraction_entity_role), :o, false, :entry)"
        ),
        {
            "id": str(entity_id),
            "tid": str(template_id),
            "name": name,
            "label": name,
            "parent": str(parent_id) if parent_id else None,
            "card": cardinality,
            "role": role,
            "o": sort_order,
            "entry": entry_label,
        },
    )
    await db.flush()
    return entity_id


async def _delete_section(db: AsyncSession, entity_id: UUID) -> None:
    await db.execute(
        text("DELETE FROM public.extraction_entity_types WHERE id = :id"), {"id": str(entity_id)}
    )
    await db.flush()


async def _move_field(db: AsyncSession, field_id: UUID, entity_type_id: UUID, order: int) -> None:
    await db.execute(
        text(
            "UPDATE public.extraction_fields SET entity_type_id = :et, sort_order = :o "
            "WHERE id = :id"
        ),
        {"id": str(field_id), "et": str(entity_type_id), "o": order},
    )
    await db.flush()


async def _set_instruction(db: AsyncSession, template_id: UUID, value: str | None) -> None:
    await db.execute(
        text(
            "UPDATE public.project_extraction_templates "
            "SET llm_template_instruction = :v WHERE id = :id"
        ),
        {"id": str(template_id), "v": value},
    )
    await db.flush()


# ==========================================================================
# Cases
# ==========================================================================


@pytest.mark.asyncio
async def test_clean_template_restore_is_a_pure_noop(db_session: AsyncSession) -> None:
    """D7: no "no draft open => short-circuit" — the writer runs, finds
    three empty id sets, and writes nothing."""
    project_id, template_id, baseline = await _fresh_charms(db_session)
    capture = await _capture(db_session, template_id)

    outcome = await _restore(
        db_session, project_id=project_id, template_id=template_id, baseline=baseline
    )

    assert outcome == RestoreOutcome()
    await _assert_restored(db_session, template_id=template_id, baseline=baseline, capture=capture)


@pytest.mark.asyncio
async def test_label_change_is_restored(db_session: AsyncSession) -> None:
    project_id, template_id, baseline = await _fresh_charms(db_session)
    section_id = await _entity_id(db_session, template_id, "participants")
    field_id = await _field_id(db_session, template_id, "participants", "recruitment_method")
    await _set_label(db_session, "extraction_entity_types", section_id, "Draft section label")
    await _set_label(db_session, "extraction_fields", field_id, "Draft field label")
    capture = await _capture(db_session, template_id)

    outcome = await _restore(
        db_session, project_id=project_id, template_id=template_id, baseline=baseline
    )

    assert outcome.updated_entity_types == 1
    assert outcome.updated_fields == 1
    await _assert_restored(
        db_session,
        template_id=template_id,
        baseline=baseline,
        capture=capture,
        touched_entity_ids=frozenset({section_id}),
        touched_field_ids=frozenset({field_id}),
    )


@pytest.mark.asyncio
async def test_draft_added_field_is_deleted(db_session: AsyncSession) -> None:
    project_id, template_id, baseline = await _fresh_charms(db_session)
    section_id = await _entity_id(db_session, template_id, "sample_size")
    added = await _add_field(db_session, section_id, "b9c1_added")
    capture = await _capture(db_session, template_id)

    outcome = await _restore(
        db_session, project_id=project_id, template_id=template_id, baseline=baseline
    )

    assert outcome.deleted_fields == 1
    assert added not in await _live_field_orders(db_session, template_id)
    await _assert_restored(db_session, template_id=template_id, baseline=baseline, capture=capture)


@pytest.mark.asyncio
async def test_draft_deleted_field_is_recreated(db_session: AsyncSession) -> None:
    project_id, template_id, baseline = await _fresh_charms(db_session)
    field_id = await _field_id(db_session, template_id, "sample_size", "number_of_participants")
    await _delete_field(db_session, field_id)
    capture = await _capture(db_session, template_id)

    outcome = await _restore(
        db_session, project_id=project_id, template_id=template_id, baseline=baseline
    )

    assert outcome.created_fields == 1
    await _assert_restored(
        db_session,
        template_id=template_id,
        baseline=baseline,
        capture=capture,
        touched_field_ids=frozenset({field_id}),
    )


@pytest.mark.asyncio
async def test_draft_added_section_is_deleted(db_session: AsyncSession) -> None:
    project_id, template_id, baseline = await _fresh_charms(db_session)
    added = await _add_section(db_session, template_id, "b9c1_new_section")
    await _add_field(db_session, added, "b9c1_new_field")
    capture = await _capture(db_session, template_id)

    outcome = await _restore(
        db_session, project_id=project_id, template_id=template_id, baseline=baseline
    )

    assert (outcome.deleted_entity_types, outcome.deleted_fields) == (1, 1)
    await _assert_restored(db_session, template_id=template_id, baseline=baseline, capture=capture)


@pytest.mark.asyncio
async def test_draft_deleted_section_is_recreated_with_its_fields(
    db_session: AsyncSession,
) -> None:
    project_id, template_id, baseline = await _fresh_charms(db_session)
    section_id = await _entity_id(db_session, template_id, "missing_data")
    field_ids = frozenset(
        UUID(f["id"]) for f in _baseline_entity(baseline, "missing_data")["fields"]
    )
    await _delete_section(db_session, section_id)
    capture = await _capture(db_session, template_id)

    outcome = await _restore(
        db_session, project_id=project_id, template_id=template_id, baseline=baseline
    )

    assert outcome.created_entity_types == 1
    assert outcome.created_fields == len(field_ids)
    await _assert_restored(
        db_session,
        template_id=template_id,
        baseline=baseline,
        capture=capture,
        touched_entity_ids=frozenset({section_id}),
        touched_field_ids=field_ids,
    )


@pytest.mark.asyncio
async def test_field_moved_into_a_draft_added_section_survives(
    db_session: AsyncSession,
) -> None:
    """The CASCADE trap: ``extraction_fields.entity_type_id`` is ON DELETE
    CASCADE, so deleting the draft-added section before re-parenting the
    baseline field destroys the field the restore is meant to keep."""
    project_id, template_id, baseline = await _fresh_charms(db_session)
    home_id = await _entity_id(db_session, template_id, "participants")
    field_id = await _field_id(db_session, template_id, "participants", "recruitment_method")
    added = await _add_section(db_session, template_id, "b9c1_parking_lot")
    await _move_field(db_session, field_id, added, 0)
    capture = await _capture(db_session, template_id)

    outcome = await _restore(
        db_session, project_id=project_id, template_id=template_id, baseline=baseline
    )

    assert outcome.deleted_entity_types == 1
    assert outcome.created_fields == 0, "the moved field must be re-parented, never recreated"
    assert await _field_parent(db_session, field_id) == home_id
    await _assert_restored(
        db_session,
        template_id=template_id,
        baseline=baseline,
        capture=capture,
        touched_field_ids=frozenset({field_id}),
    )


@pytest.mark.asyncio
async def test_field_moved_out_of_a_draft_deleted_section(db_session: AsyncSession) -> None:
    project_id, template_id, baseline = await _fresh_charms(db_session)
    doomed_id = await _entity_id(db_session, template_id, "missing_data")
    survivor = await _field_id(db_session, template_id, "missing_data", "handling_of_missing")
    refuge_id = await _entity_id(db_session, template_id, "sample_size")
    cascaded = frozenset(
        UUID(f["id"])
        for f in _baseline_entity(baseline, "missing_data")["fields"]
        if UUID(f["id"]) != survivor
    )
    await _move_field(db_session, survivor, refuge_id, 50)
    await _delete_section(db_session, doomed_id)
    capture = await _capture(db_session, template_id)

    outcome = await _restore(
        db_session, project_id=project_id, template_id=template_id, baseline=baseline
    )

    assert outcome.created_entity_types == 1
    assert outcome.created_fields == len(cascaded)
    assert await _field_parent(db_session, survivor) == doomed_id
    await _assert_restored(
        db_session,
        template_id=template_id,
        baseline=baseline,
        capture=capture,
        touched_entity_ids=frozenset({doomed_id}),
        touched_field_ids=cascaded | {survivor},
    )


@pytest.mark.asyncio
async def test_field_reorder_is_restored(db_session: AsyncSession) -> None:
    project_id, template_id, baseline = await _fresh_charms(db_session)
    fields = _baseline_entity(baseline, "participants")["fields"]
    first, second = UUID(fields[0]["id"]), UUID(fields[1]["id"])
    await _set_sort_order(db_session, "extraction_fields", first, fields[1]["sort_order"])
    await _set_sort_order(db_session, "extraction_fields", second, fields[0]["sort_order"])
    capture = await _capture(db_session, template_id)

    outcome = await _restore(
        db_session, project_id=project_id, template_id=template_id, baseline=baseline
    )

    assert outcome.updated_fields == 2
    await _assert_restored(
        db_session,
        template_id=template_id,
        baseline=baseline,
        capture=capture,
        touched_field_ids=frozenset({first, second}),
    )


@pytest.mark.asyncio
async def test_section_reorder_is_restored(db_session: AsyncSession) -> None:
    """The diff never compares entity-type order — only assertion 2 catches
    this, which is why it is mandatory."""
    project_id, template_id, baseline = await _fresh_charms(db_session)
    a_id = await _entity_id(db_session, template_id, "participants")
    b_id = await _entity_id(db_session, template_id, "sample_size")
    a_order = _baseline_entity(baseline, "participants")["sort_order"]
    b_order = _baseline_entity(baseline, "sample_size")["sort_order"]
    await _set_sort_order(db_session, "extraction_entity_types", a_id, b_order)
    await _set_sort_order(db_session, "extraction_entity_types", b_id, a_order)
    capture = await _capture(db_session, template_id)

    outcome = await _restore(
        db_session, project_id=project_id, template_id=template_id, baseline=baseline
    )

    assert outcome.updated_entity_types == 2
    await _assert_restored(
        db_session,
        template_id=template_id,
        baseline=baseline,
        capture=capture,
        touched_entity_ids=frozenset({a_id, b_id}),
    )


@pytest.mark.asyncio
async def test_move_that_renumbers_two_sections(db_session: AsyncSession) -> None:
    """``planFieldMove`` renumbers every sibling in both sections, so a
    restore that only fixes the moved field's parent leaves the two
    sections silently reordered."""
    project_id, template_id, baseline = await _fresh_charms(db_session)
    source = _baseline_entity(baseline, "participants")
    target = _baseline_entity(baseline, "sample_size")
    target_id = UUID(target["id"])
    moved = UUID(source["fields"][0]["id"])

    await _move_field(db_session, moved, target_id, 0)
    for index, field in enumerate(source["fields"][1:]):
        await _set_sort_order(db_session, "extraction_fields", UUID(field["id"]), index)
    for index, field in enumerate(target["fields"], start=1):
        await _set_sort_order(db_session, "extraction_fields", UUID(field["id"]), index)
    touched = await _drifted_field_ids(db_session, template_id, baseline)
    assert len(touched) > 10, "the renumber must really have moved both sections"
    capture = await _capture(db_session, template_id)

    outcome = await _restore(
        db_session, project_id=project_id, template_id=template_id, baseline=baseline
    )

    assert outcome.updated_fields == len(touched)
    await _assert_restored(
        db_session,
        template_id=template_id,
        baseline=baseline,
        capture=capture,
        touched_field_ids=frozenset(touched),
    )


@pytest.mark.asyncio
async def test_entry_label_is_restored(db_session: AsyncSession) -> None:
    project_id, template_id, baseline = await _fresh_charms(db_session)
    container_id = UUID(_baseline_entity(baseline, "prediction_models")["id"])
    await db_session.execute(
        text("UPDATE public.extraction_entity_types SET entry_label = 'cohort' WHERE id = :id"),
        {"id": str(container_id)},
    )
    await db_session.flush()
    capture = await _capture(db_session, template_id)

    outcome = await _restore(
        db_session, project_id=project_id, template_id=template_id, baseline=baseline
    )

    assert outcome.updated_entity_types == 1
    await _assert_restored(
        db_session,
        template_id=template_id,
        baseline=baseline,
        capture=capture,
        touched_entity_ids=frozenset({container_id}),
    )


@pytest.mark.asyncio
async def test_instruction_set_by_the_draft_is_cleared(db_session: AsyncSession) -> None:
    """The CHARMS clone carries a seeded instruction, so this pair covers
    both directions: publish with it absent, then with it present."""
    project_id, template_id, _ = await _fresh_charms(db_session)
    await _set_instruction(db_session, template_id, None)
    await TemplateVersionService(db_session).republish(
        project_id=project_id, project_template_id=template_id, user_id=SEED.primary_profile
    )
    baseline = await build_template_version_snapshot(db_session, template_id)
    assert "llm_template_instruction" not in baseline

    await _set_instruction(db_session, template_id, "Draft-only instruction")
    capture = await _capture(db_session, template_id)

    outcome = await _restore(
        db_session, project_id=project_id, template_id=template_id, baseline=baseline
    )

    assert outcome.instruction_reset is True
    await _assert_restored(db_session, template_id=template_id, baseline=baseline, capture=capture)


@pytest.mark.asyncio
async def test_instruction_cleared_by_the_draft_is_restored(db_session: AsyncSession) -> None:
    project_id, template_id, baseline = await _fresh_charms(
        db_session, instruction="Judge strictly from the reported conduct."
    )
    assert baseline.get("llm_template_instruction"), "the published baseline carries it"
    await _set_instruction(db_session, template_id, "   ")
    capture = await _capture(db_session, template_id)

    outcome = await _restore(
        db_session, project_id=project_id, template_id=template_id, baseline=baseline
    )

    assert outcome.instruction_reset is True
    await _assert_restored(db_session, template_id=template_id, baseline=baseline, capture=capture)


@pytest.mark.asyncio
async def test_delete_plus_rename_into_the_freed_name(db_session: AsyncSession) -> None:
    """``uq_extraction_fields_entity_type_name`` is immediate: recreating
    the deleted field before parking the renamed sibling collides."""
    project_id, template_id, baseline = await _fresh_charms(db_session)
    section = _baseline_entity(baseline, "participants")
    doomed = section["fields"][0]
    sibling = section["fields"][1]
    await _delete_field(db_session, UUID(doomed["id"]))
    await _set_field_name(db_session, UUID(sibling["id"]), doomed["name"])
    capture = await _capture(db_session, template_id)

    outcome = await _restore(
        db_session, project_id=project_id, template_id=template_id, baseline=baseline
    )

    assert (outcome.created_fields, outcome.updated_fields) == (1, 1)
    await _assert_restored(
        db_session,
        template_id=template_id,
        baseline=baseline,
        capture=capture,
        touched_field_ids=frozenset({UUID(doomed["id"]), UUID(sibling["id"])}),
    )


@pytest.mark.asyncio
async def test_two_fields_swapping_names(db_session: AsyncSession) -> None:
    project_id, template_id, baseline = await _fresh_charms(db_session)
    section = _baseline_entity(baseline, "participants")
    left, right = section["fields"][0], section["fields"][1]
    await _set_field_name(db_session, UUID(left["id"]), "b9c1_tmp")
    await _set_field_name(db_session, UUID(right["id"]), left["name"])
    await _set_field_name(db_session, UUID(left["id"]), right["name"])
    capture = await _capture(db_session, template_id)

    outcome = await _restore(
        db_session, project_id=project_id, template_id=template_id, baseline=baseline
    )

    assert outcome.updated_fields == 2
    await _assert_restored(
        db_session,
        template_id=template_id,
        baseline=baseline,
        capture=capture,
        touched_field_ids=frozenset({UUID(left["id"]), UUID(right["id"])}),
    )


@pytest.mark.asyncio
async def test_deleted_model_section_and_its_container_are_recreated(
    db_session: AsyncSession,
) -> None:
    """Topological create + the deferred model_section-under-container
    trigger, which only fires because assertion 5 forces it."""
    project_id, template_id, baseline = await _fresh_charms(db_session)
    container_id = await _entity_id(db_session, template_id, "prediction_models")
    subtree = frozenset(
        UUID(et["id"])
        for et in baseline["entity_types"]
        if et["id"] == str(container_id) or et["parent_entity_type_id"] == str(container_id)
    )
    subtree_fields = frozenset(
        UUID(f["id"])
        for et in baseline["entity_types"]
        if UUID(et["id"]) in subtree
        for f in et.get("fields") or []
    )
    assert len(subtree) > 1, "CHARMS must have model sections under its container"
    await _delete_section(db_session, container_id)
    capture = await _capture(db_session, template_id)

    outcome = await _restore(
        db_session, project_id=project_id, template_id=template_id, baseline=baseline
    )

    assert outcome.created_entity_types == len(subtree)
    assert outcome.created_fields == len(subtree_fields)
    await _assert_restored(
        db_session,
        template_id=template_id,
        baseline=baseline,
        capture=capture,
        touched_entity_ids=subtree,
        touched_field_ids=subtree_fields,
    )


@pytest.mark.asyncio
async def test_container_swap_is_refused(db_session: AsyncSession) -> None:
    """D3: one container per project is a partial unique index, so a draft
    that replaced the container cannot be reconciled by the phase order.
    Refuse before writing anything."""
    project_id, template_id, baseline = await _fresh_charms(db_session)
    container_id = await _entity_id(db_session, template_id, "prediction_models")
    await _delete_section(db_session, container_id)
    await _add_section(
        db_session,
        template_id,
        "b9c1_other_container",
        role="model_container",
        cardinality="many",
        entry_label="model",
    )
    capture = await _capture(db_session, template_id)

    with pytest.raises(ContainerSwapUnsupportedError):
        await _restore(
            db_session, project_id=project_id, template_id=template_id, baseline=baseline
        )

    assert await _capture(db_session, template_id) == capture, "refusal must write nothing"


@pytest.mark.asyncio
async def test_era_drift_baseline_does_not_null_columns(db_session: AsyncSession) -> None:
    """A pre-0051 / pre-#462 baseline simply lacks ``entry_label`` and the
    ``allows_not_*`` keys. Absent must mean the canonical default (which
    is role-aware for ``entry_label``), never NULL and never a crash.

    A template that old never carried a noun outside the container: 0051
    stamped 'model' on containers only, 0068 stamps global catalogue rows
    only, and a clone's own baseline is written WITH the key. The fresh
    CHARMS clone below inherits the seeded ``final_predictors`` noun, so
    its live rows are first brought back to that era."""
    project_id, template_id, wide = await _fresh_charms(db_session)
    await db_session.execute(
        text(
            "UPDATE public.extraction_entity_types SET entry_label = NULL "
            "WHERE project_template_id = :tid AND role <> 'model_container'"
        ),
        {"tid": str(template_id)},
    )
    baseline: dict[str, Any] = {
        **wide,
        "entity_types": [
            {
                **{k: v for k, v in et.items() if k != "entry_label"},
                "fields": [
                    {
                        k: v
                        for k, v in f.items()
                        if k not in {"allows_not_applicable", "allows_not_evaluated"}
                    }
                    for f in et.get("fields") or []
                ],
            }
            for et in wide["entity_types"]
        ],
    }
    # Only the fields whose live flags are non-default can legitimately be
    # rewritten: absent key == canonical default == False.
    touched_fields = frozenset(
        UUID(f["id"])
        for et in wide["entity_types"]
        for f in et.get("fields") or []
        if f["allows_not_applicable"] or f["allows_not_evaluated"]
    )
    assert touched_fields, "CHARMS must seed some ADR-0016 dispositions"
    capture = await _capture(db_session, template_id)

    outcome = await _restore(
        db_session, project_id=project_id, template_id=template_id, baseline=baseline
    )

    assert outcome.updated_entity_types == 0, "entry_label must not be nulled on any section"
    assert outcome.updated_fields == len(touched_fields)
    nulls = (
        await db_session.execute(
            text(
                "SELECT count(*) FROM public.extraction_fields f "
                "JOIN public.extraction_entity_types et ON et.id = f.entity_type_id "
                "WHERE et.project_template_id = :tid AND (f.allows_not_applicable IS NULL "
                "OR f.allows_not_evaluated IS NULL)"
            ),
            {"tid": str(template_id)},
        )
    ).scalar_one()
    assert nulls == 0
    entry_label = (
        await db_session.execute(
            text("SELECT entry_label FROM public.extraction_entity_types WHERE id = :id"),
            {"id": str(await _entity_id(db_session, template_id, "prediction_models"))},
        )
    ).scalar_one()
    assert entry_label == "model"
    await _assert_restored(
        db_session,
        template_id=template_id,
        baseline=baseline,
        capture=capture,
        touched_field_ids=touched_fields,
    )


@pytest.mark.asyncio
async def test_restore_is_idempotent(db_session: AsyncSession) -> None:
    project_id, template_id, baseline = await _fresh_charms(db_session)
    section_id = await _entity_id(db_session, template_id, "sample_size")
    added_field = await _add_field(db_session, section_id, "b9c1_added")
    added_section = await _add_section(db_session, template_id, "b9c1_new_section")
    deleted = await _field_id(db_session, template_id, "participants", "recruitment_method")
    await _delete_field(db_session, deleted)
    await _set_label(db_session, "extraction_entity_types", section_id, "Draft label")

    first = await _restore(
        db_session, project_id=project_id, template_id=template_id, baseline=baseline
    )
    assert first != RestoreOutcome()
    assert added_field not in await _live_field_orders(db_session, template_id)
    assert added_section not in await _live_entity_orders(db_session, template_id)

    capture = await _capture(db_session, template_id)
    second = await _restore(
        db_session, project_id=project_id, template_id=template_id, baseline=baseline
    )

    assert second == RestoreOutcome(), "the second restore must be a pure no-op"
    await _assert_restored(db_session, template_id=template_id, baseline=baseline, capture=capture)


@pytest.mark.asyncio
async def test_skip_entity_type_ids_keeps_the_node(db_session: AsyncSession) -> None:
    """D4's partial discard: T2 computes the blocked set, the writer only
    honours it — the excluded section AND its own fields survive, and
    everything else is still restored."""
    project_id, template_id, baseline = await _fresh_charms(db_session)
    kept = await _add_section(db_session, template_id, "b9c1_blocked_section")
    kept_field = await _add_field(db_session, kept, "b9c1_blocked_field")
    section_id = await _entity_id(db_session, template_id, "sample_size")
    await _set_label(db_session, "extraction_entity_types", section_id, "Draft label")
    capture = await _capture(db_session, template_id)

    outcome = await _restore(
        db_session,
        project_id=project_id,
        template_id=template_id,
        baseline=baseline,
        skip_entity_type_ids=frozenset({kept}),
    )

    assert (outcome.deleted_entity_types, outcome.deleted_fields) == (0, 0)
    assert outcome.updated_entity_types == 1
    await _assert_restored(
        db_session,
        template_id=template_id,
        baseline=baseline,
        capture=capture,
        touched_entity_ids=frozenset({section_id}),
        extra_entity_ids=frozenset({kept}),
        extra_field_ids=frozenset({kept_field}),
    )


@pytest.mark.asyncio
async def test_kept_field_name_makes_a_baseline_field_unrestorable(
    db_session: AsyncSession,
) -> None:
    """A kept field owns its ``(entity_type_id, name)`` slot forever, and
    ``uq_extraction_fields_entity_type_name`` is immediate — so the baseline
    field that wants the slot back cannot be re-created. Skipping and
    reporting it is the writer's job, not a 23505 the caller cannot type.

    The shape is ordinary: deleting a field and re-adding it under the same
    name is the standard way to change a field's type."""
    project_id, template_id, baseline = await _fresh_charms(db_session)
    owner = await _entity_id(db_session, template_id, "sample_size")
    victim = await _field_id(db_session, template_id, "sample_size", "epv_epp")
    await _delete_field(db_session, victim)
    replacement = await _add_field(db_session, owner, "epv_epp")
    capture = await _capture(db_session, template_id)

    outcome = await _restore(
        db_session,
        project_id=project_id,
        template_id=template_id,
        baseline=baseline,
        skip_entity_type_ids=frozenset({owner}),
    )

    assert outcome.name_conflicted_field_ids == frozenset({victim})
    assert (outcome.created_fields, outcome.deleted_fields) == (0, 0)
    assert set(await _live_field_orders(db_session, template_id)) == (
        set(_baseline_field_orders(baseline)) - {victim}
    ) | {replacement}
    await _assert_restored(
        db_session,
        template_id=template_id,
        baseline=baseline,
        capture=capture,
        extra_field_ids=frozenset({replacement}),
        unrestorable_field_ids=frozenset({victim}),
    )


@pytest.mark.asyncio
async def test_container_swap_is_refused_when_the_new_container_is_skipped(
    db_session: AsyncSession,
) -> None:
    """The D3 guard reads the PRE-skip view. A draft-added container the
    caller kept is still the incumbent on
    ``uq_extraction_entity_types_one_container_per_project``, so dropping it
    from the delete set must not silence the refusal."""
    project_id, template_id, baseline = await _fresh_charms(db_session)
    await _delete_section(
        db_session, await _entity_id(db_session, template_id, "prediction_models")
    )
    kept_container = await _add_section(
        db_session,
        template_id,
        "b9c1_kept_container",
        role="model_container",
        cardinality="many",
        entry_label="model",
    )
    capture = await _capture(db_session, template_id)

    with pytest.raises(ContainerSwapUnsupportedError):
        await _restore(
            db_session,
            project_id=project_id,
            template_id=template_id,
            baseline=baseline,
            skip_entity_type_ids=frozenset({kept_container}),
        )

    assert await _capture(db_session, template_id) == capture, "refusal must write nothing"


@pytest.mark.asyncio
async def test_writer_never_touches_the_draft_marker(db_session: AsyncSession) -> None:
    """D7: the marker belongs to the Discard service (T2). The 0048
    triggers re-stamp it on every row the writer touches, and that is
    exactly the state T2 has to clear."""
    project_id, template_id, baseline = await _fresh_charms(db_session)
    assert await get_config_draft_marker(db_session, template_id) is None
    section_id = await _entity_id(db_session, template_id, "sample_size")
    await _set_label(db_session, "extraction_entity_types", section_id, "Draft label")
    assert await get_config_draft_marker(db_session, template_id) is not None

    await _restore(db_session, project_id=project_id, template_id=template_id, baseline=baseline)

    assert await get_config_draft_marker(db_session, template_id) is not None


# --------------------------------------------------------------------------
# Entry key — a second per-section slot, parked with ``false``
# --------------------------------------------------------------------------


async def _keyed_section(
    db: AsyncSession, template_id: UUID, baseline: dict[str, Any]
) -> tuple[UUID, UUID, UUID]:
    """``(section, key holder, a keyless sibling)`` of one repeating section
    that declares an entry key — read from the rows, so the tests do not
    depend on which seeded coordinate carries it."""
    section, holder = next(iter((await entry_key_holders(db, template_id)).items()))
    fields = next(et for et in baseline["entity_types"] if UUID(et["id"]) == section)["fields"]
    sibling = next(UUID(f["id"]) for f in fields if UUID(f["id"]) != holder)
    return section, holder, sibling


@pytest.mark.asyncio
async def test_draft_deleted_entry_key_field_is_recreated_with_its_key(
    db_session: AsyncSession,
) -> None:
    """The writer half of ``test_discard_after_deleting_the_entry_key_field_
    restores_the_identity`` (discard suite): the re-created field carries
    the baseline's key, not the column default."""
    project_id, template_id, baseline = await _fresh_charms(db_session)
    section, key_field, _ = await _keyed_section(db_session, template_id, baseline)
    await _delete_field(db_session, key_field)
    capture = await _capture(db_session, template_id)

    outcome = await _restore(
        db_session, project_id=project_id, template_id=template_id, baseline=baseline
    )

    assert outcome.created_fields == 1
    assert (await entry_key_holders(db_session, template_id))[section] == key_field
    await _assert_restored(
        db_session,
        template_id=template_id,
        baseline=baseline,
        capture=capture,
        touched_field_ids=frozenset({key_field}),
    )


@pytest.mark.asyncio
async def test_entry_key_moved_between_baseline_fields_is_restored(
    db_session: AsyncSession,
) -> None:
    """``uq_extraction_fields_one_entity_key`` is partial and immediate, so
    settling the update set in snapshot order — the baseline holder before
    the sibling the draft moved the key to — collides unless the key is
    parked first, the way names are. Neither field changes its name slot,
    so neither is name-parked: the key is the only slot in play."""
    project_id, template_id, baseline = await _fresh_charms(db_session)
    section, old_key, new_key = await _keyed_section(db_session, template_id, baseline)
    await set_entry_key(db_session, old_key, False)
    await set_entry_key(db_session, new_key, True)
    capture = await _capture(db_session, template_id)

    outcome = await _restore(
        db_session, project_id=project_id, template_id=template_id, baseline=baseline
    )

    assert outcome.updated_fields == 2
    assert (await entry_key_holders(db_session, template_id))[section] == old_key
    await _assert_restored(
        db_session,
        template_id=template_id,
        baseline=baseline,
        capture=capture,
        touched_field_ids=frozenset({old_key, new_key}),
    )


@pytest.mark.asyncio
async def test_stray_entry_key_on_a_kept_field_is_released(db_session: AsyncSession) -> None:
    """A kept draft-added field holding the section's key is not a name
    slot: nothing stops the baseline holder from taking the key back, so the
    restore releases it instead of skipping the baseline field or crashing
    on the index. The kept field itself survives, keyless."""
    project_id, template_id, baseline = await _fresh_charms(db_session)
    section, baseline_key, _ = await _keyed_section(db_session, template_id, baseline)
    kept = await _add_field(db_session, section, "b9c1_kept_key")
    await set_entry_key(db_session, baseline_key, False)
    await set_entry_key(db_session, kept, True)
    capture = await _capture(db_session, template_id)

    outcome = await _restore(
        db_session,
        project_id=project_id,
        template_id=template_id,
        baseline=baseline,
        skip_entity_type_ids=frozenset({section}),
    )

    assert outcome.deleted_fields == 0
    assert (await entry_key_holders(db_session, template_id))[section] == baseline_key
    await _assert_restored(
        db_session,
        template_id=template_id,
        baseline=baseline,
        capture=capture,
        touched_field_ids=frozenset({baseline_key, kept}),
        extra_field_ids=frozenset({kept}),
    )


@pytest.mark.asyncio
async def test_kept_key_stays_when_the_baseline_holder_is_unrestorable(
    db_session: AsyncSession,
) -> None:
    """The two slot mechanisms must not compound into a keyless section.

    The draft deleted the key holder, re-added a field under its name (the
    standard "change a field's type" workaround) and keyed the replacement.
    The replacement is kept, so the baseline holder is name-conflicted and
    phases 5/6 will never write its key back — releasing the replacement's
    key would leave the section with none, and AI re-runs refused."""
    project_id, template_id, baseline = await _fresh_charms(db_session)
    section, victim, _ = await _keyed_section(db_session, template_id, baseline)
    victim_name = (
        await db_session.execute(
            text("SELECT name FROM public.extraction_fields WHERE id = :id"),
            {"id": str(victim)},
        )
    ).scalar_one()
    await _delete_field(db_session, victim)
    replacement = await _add_field(db_session, section, victim_name)
    await set_entry_key(db_session, replacement, True)
    capture = await _capture(db_session, template_id)

    outcome = await _restore(
        db_session,
        project_id=project_id,
        template_id=template_id,
        baseline=baseline,
        skip_entity_type_ids=frozenset({section}),
    )

    assert outcome.name_conflicted_field_ids == frozenset({victim})
    assert (await entry_key_holders(db_session, template_id))[section] == replacement
    await _assert_restored(
        db_session,
        template_id=template_id,
        baseline=baseline,
        capture=capture,
        extra_field_ids=frozenset({replacement}),
        unrestorable_field_ids=frozenset({victim}),
    )
