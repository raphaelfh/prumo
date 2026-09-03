"""Discard-draft: partial restore, refusals, ack and telemetry (B-9c1, T2).

The service wraps T1's pure reconcile with everything the reconcile
deliberately refuses to know: which nodes the database will not let it
delete (D4 — those are KEPT, not a refusal), which restores would corrupt
data (D5 — those abort), which ones silently orphan recorded work (D6 —
those need an explicit ack), the draft marker (D7) and the audit trail
(D10).

Real DB throughout, because every one of those answers is a RESTRICT FK,
a CASCADE, or a trigger-materialized instance. The suite clones CHARMS
into the cross-project seed and republishes it, so the baseline is the
wide builder's own output — the seeded ``{"entity_types": []}`` v1 is a
different (and separately tested) case.
"""

from __future__ import annotations

import json as _json
from collections.abc import AsyncGenerator
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

import pytest
import pytest_asyncio
import structlog
from httpx import AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from structlog.testing import LogCapture

from app.core.security import TokenPayload, get_current_user
from app.main import app
from app.repositories.extraction_field_reference_repository import (
    ExtractionFieldReferenceRepository,
)
from app.services.entity_key import resolve_key_field
from app.services.extraction_snapshot import build_template_version_snapshot
from app.services.project_template_active_service import ProjectTemplateNotFoundError
from app.services.template_diff import diff_snapshots
from app.services.template_discard_service import (
    DiscardBlockedByCardinalityError,
    DiscardRacedError,
    NarrowBaselineError,
    OrphanAcknowledgementRequiredError,
    discard_draft,
)
from app.services.template_restore_service import ContainerSwapUnsupportedError
from app.services.template_version_read_service import NoActiveTemplateVersionError
from app.services.template_version_service import TemplateVersionService
from tests.integration.conftest import (
    SEED,
    clean_project_clones,
    clone_charms,
    get_config_draft_marker,
    make_proposal,
    open_session,
    set_config_draft_marker,
)

# B-9b2a: the multi-tier fixture machinery this suite built first now lives
# in a shared module, so the config-diff suite exercises the SAME tree. Kept
# under their module-private names here to leave the ~40 call sites untouched.
from tests.integration.helpers import template_fixtures
from tests.integration.helpers.template_fixtures import (
    ARTICLE_ID as _ARTICLE_ID,
)
from tests.integration.helpers.template_fixtures import (
    active_schema as _active_schema,
)
from tests.integration.helpers.template_fixtures import (
    add_field as _add_field,
)
from tests.integration.helpers.template_fixtures import (
    add_instance as _add_instance,
)
from tests.integration.helpers.template_fixtures import (
    add_section as _add_section,
)
from tests.integration.helpers.template_fixtures import (
    delete_field as _delete_field,
)
from tests.integration.helpers.template_fixtures import (
    entity_id as _entity_id,
)
from tests.integration.helpers.template_fixtures import (
    field_id as _field_id,
)
from tests.integration.helpers.template_fixtures import (
    force_narrow_baseline,
)
from tests.integration.helpers.template_fixtures import (
    fresh_charms as _fresh_charms,
)
from tests.integration.helpers.template_fixtures import (
    option_orphan_setup as _option_orphan_setup,
)
from tests.integration.helpers.template_fixtures import (
    set_label as _set_label,
)

#: Every template-config endpoint is manager-gated, so this fixture is shared
#: with ``test_template_config_diff``. Bound by assignment rather than imported
#: by name: an import binding collides with the identically named parameter in
#: every test that requests it (ruff F811).
auth_as_manager = template_fixtures.auth_as_manager


async def _force_active_schema(db: AsyncSession, template_id: UUID, schema: dict[str, Any]) -> None:
    """Overwrite the active version's schema with an ARBITRARY payload.

    Kept alongside ``force_narrow_baseline`` because one caller needs the
    EMPTY baseline, which is restorable — the opposite of narrow. Every
    narrow-shape caller uses the shared helper instead: that shape is a gate
    input, and a copy that drifted would quietly stop being narrow while its
    suite kept passing.
    """
    await db.execute(
        text(
            "UPDATE public.extraction_template_versions SET schema = CAST(:s AS jsonb) "
            "WHERE project_template_id = :tid AND is_active IS TRUE"
        ),
        {"tid": str(template_id), "s": _json.dumps(schema)},
    )
    await db.flush()


# --------------------------------------------------------------------------
# Live introspection / draft edits
# --------------------------------------------------------------------------


async def _live_entity_ids(db: AsyncSession, template_id: UUID) -> set[UUID]:
    rows = await db.execute(
        text("SELECT id FROM public.extraction_entity_types WHERE project_template_id = :tid"),
        {"tid": str(template_id)},
    )
    return {row.id for row in rows}


async def _live_field_ids(db: AsyncSession, template_id: UUID) -> set[UUID]:
    rows = await db.execute(
        text(
            "SELECT f.id FROM public.extraction_fields f "
            "JOIN public.extraction_entity_types et ON et.id = f.entity_type_id "
            "WHERE et.project_template_id = :tid"
        ),
        {"tid": str(template_id)},
    )
    return {row.id for row in rows}


async def _set_field_name(db: AsyncSession, field_id: UUID, name: str) -> None:
    await db.execute(
        text("UPDATE public.extraction_fields SET name = :name, label = :name WHERE id = :id"),
        {"id": str(field_id), "name": name},
    )
    await db.flush()


async def _delete_section(db: AsyncSession, entity_id: UUID) -> None:
    await db.execute(
        text("DELETE FROM public.extraction_entity_types WHERE id = :id"), {"id": str(entity_id)}
    )
    await db.flush()


async def _assert_matches_baseline(
    db: AsyncSession,
    *,
    template_id: UUID,
    baseline: dict[str, Any],
    extra_entity_ids: frozenset[UUID] = frozenset(),
    extra_field_ids: frozenset[UUID] = frozenset(),
    unrestorable_field_ids: frozenset[UUID] = frozenset(),
) -> None:
    """T1's structural check, reduced to what T2 owns: everything outside
    the KEPT set is back on the baseline.

    ``unrestorable_field_ids`` are BASELINE fields the restore had to leave
    alone because a kept node holds their per-section name slot: they drop
    out of both sides of every comparison, so the rest of the tree is still
    asserted exactly."""
    await db.execute(text("SET CONSTRAINTS ALL IMMEDIATE"))
    rebuilt = await build_template_version_snapshot(db, template_id)
    extras = extra_entity_ids | extra_field_ids | unrestorable_field_ids
    unexplained = [
        c
        for c in diff_snapshots(baseline, rebuilt, fields_with_values=frozenset()).changes
        if c.node_id not in extras
    ]
    assert not unexplained, f"discard left {len(unexplained)} change(s): {unexplained}"

    base_entity_ids = {UUID(et["id"]) for et in baseline["entity_types"]}
    base_field_ids = {
        UUID(f["id"]) for et in baseline["entity_types"] for f in et.get("fields") or []
    } - unrestorable_field_ids
    assert await _live_entity_ids(db, template_id) == base_entity_ids | extra_entity_ids
    assert (
        await _live_field_ids(db, template_id)
    ) - unrestorable_field_ids == base_field_ids | extra_field_ids


async def _discard(
    db: AsyncSession,
    *,
    project_id: UUID,
    template_id: UUID,
    acknowledge_orphans: bool = False,
):
    return await discard_draft(
        db,
        project_id=project_id,
        template_id=template_id,
        user_id=SEED.primary_profile,
        acknowledge_orphans=acknowledge_orphans,
    )


# ==========================================================================
# D4 — partial discard
# ==========================================================================


@pytest.mark.asyncio
async def test_section_holding_recorded_work_is_kept_and_the_rest_restored(
    db_session: AsyncSession,
) -> None:
    """The shape partial discard exists for: a new top-level section a
    reviewer has already recorded something under. Refusing the whole
    Discard would make it permanently unavailable, so the section is KEPT,
    the rest of the draft is undone, and the marker stays set (D4/D7).

    The work is a proposal, NOT merely the instance a session materialized:
    an empty instance is scaffolding and is discarded like the rest of the
    draft (see the sibling test above)."""
    project_id, template_id, baseline = await _fresh_charms(db_session)
    added = await _add_section(db_session, template_id, "b9c1_kept_section")
    target = await _add_field(db_session, added, "b9c1_kept_field")
    renamed = await _entity_id(db_session, template_id, "participants")
    await _set_label(db_session, "extraction_entity_types", renamed, "Draft label")
    session = await open_session(
        db_session,
        project_id=project_id,
        article_id=_ARTICLE_ID,
        template_id=template_id,
        user_id=SEED.primary_profile,
    )
    await make_proposal(
        db_session,
        run_id=session.run_id,
        instance_id=UUID(session.instances_by_entity_type[str(added)]),
        field_id=target,
        user_id=SEED.primary_profile,
    )

    result = await _discard(db_session, project_id=project_id, template_id=template_id)

    assert result.draft_was_open is True
    assert [(k.node_id, k.node_kind, k.reason) for k in result.kept] == [
        (added, "entity_type", "has_recorded_data"),
        (target, "field", "has_recorded_data"),
    ]
    assert result.deleted_entity_types == 0
    assert result.updated_entity_types == 1
    await _assert_matches_baseline(
        db_session,
        template_id=template_id,
        baseline=baseline,
        extra_entity_ids=frozenset({added}),
        extra_field_ids=frozenset({target}),
    )
    # D4: something was kept, so the template is still in draft.
    assert await get_config_draft_marker(db_session, template_id) is not None


@pytest.mark.asyncio
async def test_a_section_whose_only_instance_is_empty_is_discarded(
    db_session: AsyncSession,
) -> None:
    """Opening an article seeds ONE empty instance per top-level section.
    That row is scaffolding, not work — the draft-added section is undone
    like the rest of the draft, and nothing is kept.

    The regression this pins: instance OWNERSHIP used to be the gate, so a
    single reviewer opening a single article made every draft-added section
    permanently un-discardable and the report claimed it held recorded
    data."""
    project_id, template_id, baseline = await _fresh_charms(db_session)
    added = await _add_section(db_session, template_id, "b9c1_empty_instance_section")
    await open_session(
        db_session,
        project_id=project_id,
        article_id=_ARTICLE_ID,
        template_id=template_id,
        user_id=SEED.primary_profile,
    )

    result = await _discard(db_session, project_id=project_id, template_id=template_id)

    assert list(result.kept) == []
    assert result.deleted_entity_types == 1
    await _assert_matches_baseline(db_session, template_id=template_id, baseline=baseline)
    # Nothing was kept, so the draft is fully undone and the marker clears.
    assert await get_config_draft_marker(db_session, template_id) is None
    assert (
        await db_session.execute(
            text("SELECT count(*) FROM public.extraction_instances WHERE entity_type_id = :et"),
            {"et": str(added)},
        )
    ).scalar_one() == 0


@pytest.mark.asyncio
async def test_draft_added_field_referenced_by_a_proposal_is_kept(
    db_session: AsyncSession,
) -> None:
    """A workflow reference on a draft-added FIELD is kept, not fatal —
    and it needs no orphan ack, because nothing about it is discarded."""
    project_id, template_id, baseline = await _fresh_charms(db_session)
    owner = await _entity_id(db_session, template_id, "sample_size")
    added = await _add_field(db_session, owner, "b9c1_kept_field")
    session = await open_session(
        db_session,
        project_id=project_id,
        article_id=_ARTICLE_ID,
        template_id=template_id,
        user_id=SEED.primary_profile,
    )
    await make_proposal(
        db_session,
        run_id=session.run_id,
        instance_id=UUID(session.instances_by_entity_type[str(owner)]),
        field_id=added,
        user_id=SEED.primary_profile,
    )

    result = await _discard(db_session, project_id=project_id, template_id=template_id)

    assert [(k.node_id, k.node_kind, k.reason) for k in result.kept] == [
        (added, "field", "has_recorded_data")
    ]
    assert result.deleted_fields == 0
    await _assert_matches_baseline(
        db_session,
        template_id=template_id,
        baseline=baseline,
        extra_field_ids=frozenset({added}),
    )
    assert await get_config_draft_marker(db_session, template_id) is not None


@pytest.mark.asyncio
async def test_keeping_a_field_keeps_its_draft_added_siblings(
    db_session: AsyncSession,
) -> None:
    """The writer's skip set is entity-type-granular: sparing one blocked
    field spares every draft-added field of the same section. The response
    reports the collateral honestly rather than pretending it was deleted."""
    project_id, template_id, baseline = await _fresh_charms(db_session)
    owner = await _entity_id(db_session, template_id, "sample_size")
    referenced = await _add_field(db_session, owner, "b9c1_referenced", sort_order=97)
    sibling = await _add_field(db_session, owner, "b9c1_sibling", sort_order=98)
    session = await open_session(
        db_session,
        project_id=project_id,
        article_id=_ARTICLE_ID,
        template_id=template_id,
        user_id=SEED.primary_profile,
    )
    await make_proposal(
        db_session,
        run_id=session.run_id,
        instance_id=UUID(session.instances_by_entity_type[str(owner)]),
        field_id=referenced,
        user_id=SEED.primary_profile,
    )

    result = await _discard(db_session, project_id=project_id, template_id=template_id)

    assert [(k.node_id, k.reason) for k in result.kept] == [
        (referenced, "has_recorded_data"),
        (sibling, "related_to_kept_node"),
    ]
    await _assert_matches_baseline(
        db_session,
        template_id=template_id,
        baseline=baseline,
        extra_field_ids=frozenset({referenced, sibling}),
    )


@pytest.mark.asyncio
async def test_draft_added_ancestor_of_a_blocked_node_is_kept(
    db_session: AsyncSession,
) -> None:
    """``parent_entity_type_id`` is ON DELETE CASCADE, so keeping a blocked
    node is worthless unless every draft-added ANCESTOR is kept with it —
    deleting the parent would destroy the child the RESTRICT FK protects.

    The baseline is a CHARMS clone with its model container removed, so
    the draft can legally add a container (the one-container-per-project
    index has no incumbent) and a model_section under it. The child's
    instance is inserted directly with a NULL parent: that isolates the
    ancestor walk, which is otherwise masked because today's
    materialization gives the parent an instance of its own."""
    project_id = SEED.secondary_project
    await clean_project_clones(db_session, project_id)
    clone = await clone_charms(db_session, project_id, SEED.primary_profile)
    template_id = clone.project_template_id
    # ``trg_check_model_section_parent_role`` is DEFERRABLE INITIALLY
    # DEFERRED: its AFTER-INSERT events for the clone's model_sections
    # outlive the rows themselves and re-fire at the first constraint check,
    # reporting "has no parent row" for sections this setup permanently
    # deletes. Drain the queue while the tree is still whole, then restore
    # deferral so the assertions still exercise the trigger.
    await db_session.execute(text("SET CONSTRAINTS ALL IMMEDIATE"))
    await db_session.execute(text("SET CONSTRAINTS ALL DEFERRED"))
    await _delete_section(
        db_session, await _entity_id(db_session, template_id, "prediction_models")
    )
    await TemplateVersionService(db_session).republish(
        project_id=project_id, project_template_id=template_id, user_id=SEED.primary_profile
    )
    baseline = await _active_schema(db_session, template_id)

    container = await _add_section(
        db_session,
        template_id,
        "b9c1_container",
        role="model_container",
        cardinality="many",
        entry_label="model",
        sort_order=98,
    )
    child = await _add_section(
        db_session,
        template_id,
        "b9c1_child",
        role="model_section",
        parent_id=container,
        sort_order=99,
    )
    await db_session.execute(
        text(
            "INSERT INTO public.articles (id, project_id, title, row_version) "
            "VALUES (:id, :pid, 'B-9c1 discard article', 1) ON CONFLICT (id) DO NOTHING"
        ),
        {"id": str(_ARTICLE_ID), "pid": str(project_id)},
    )
    target = await _add_field(db_session, child, "b9c1_child_field")
    instance = await _add_instance(
        db_session, project_id=project_id, template_id=template_id, entity_type_id=child
    )
    # A bare instance is scaffolding; the proposal is what blocks the child.
    session = await open_session(
        db_session,
        project_id=project_id,
        article_id=_ARTICLE_ID,
        template_id=template_id,
        user_id=SEED.primary_profile,
    )
    await make_proposal(
        db_session,
        run_id=session.run_id,
        instance_id=instance,
        field_id=target,
        user_id=SEED.primary_profile,
    )

    result = await _discard(db_session, project_id=project_id, template_id=template_id)

    kept = {k.node_id: k.reason for k in result.kept}
    assert kept == {
        child: "has_recorded_data",
        container: "related_to_kept_node",
        target: "has_recorded_data",
    }
    assert result.deleted_entity_types == 0
    await _assert_matches_baseline(
        db_session,
        template_id=template_id,
        baseline=baseline,
        extra_entity_ids=frozenset({container, child}),
        extra_field_ids=frozenset({target}),
    )


@pytest.mark.asyncio
async def test_the_sweep_never_cascades_through_a_nested_instance(
    db_session: AsyncSession,
) -> None:
    """The hazard the instance sweep introduces, pinned.

    ``extraction_instances.parent_instance_id`` is ON DELETE CASCADE, and
    four of the five work tables cascade from ``instance_id`` too — so
    deleting a per-model container's instance would silently destroy the
    reviewer decisions recorded against its ENTRY instances. Nothing but
    the gate stands between the sweep and that, which is why this asserts
    the work is still there afterwards rather than only that the nodes
    were kept.

    It holds because the child section is blocked by its own work and
    ``_closed_over_the_tree`` walks UP: keeping the child forces keeping
    its draft-added container, so neither reaches the sweep."""
    project_id = SEED.secondary_project
    await clean_project_clones(db_session, project_id)
    clone = await clone_charms(db_session, project_id, SEED.primary_profile)
    template_id = clone.project_template_id
    # Drain the deferred role/parent queue while the tree is still whole
    # (see the ancestor test above), then restore deferral.
    await db_session.execute(text("SET CONSTRAINTS ALL IMMEDIATE"))
    await db_session.execute(text("SET CONSTRAINTS ALL DEFERRED"))
    await _delete_section(
        db_session, await _entity_id(db_session, template_id, "prediction_models")
    )
    await TemplateVersionService(db_session).republish(
        project_id=project_id, project_template_id=template_id, user_id=SEED.primary_profile
    )

    container = await _add_section(
        db_session,
        template_id,
        "b9c1_nested_container",
        role="model_container",
        cardinality="many",
        entry_label="model",
        sort_order=98,
    )
    child = await _add_section(
        db_session,
        template_id,
        "b9c1_nested_child",
        role="model_section",
        parent_id=container,
        sort_order=99,
    )
    target = await _add_field(db_session, child, "b9c1_nested_field")
    await db_session.execute(
        text(
            "INSERT INTO public.articles (id, project_id, title, row_version) "
            "VALUES (:id, :pid, 'B-9c1 discard article', 1) ON CONFLICT (id) DO NOTHING"
        ),
        {"id": str(_ARTICLE_ID), "pid": str(project_id)},
    )
    # The container's OWN instance is empty; the work hangs off its entry.
    entry = await _add_instance(
        db_session, project_id=project_id, template_id=template_id, entity_type_id=container
    )
    nested = await _add_instance(
        db_session,
        project_id=project_id,
        template_id=template_id,
        entity_type_id=child,
        parent_instance_id=entry,
    )
    session = await open_session(
        db_session,
        project_id=project_id,
        article_id=_ARTICLE_ID,
        template_id=template_id,
        user_id=SEED.primary_profile,
    )
    proposal = await make_proposal(
        db_session,
        run_id=session.run_id,
        instance_id=nested,
        field_id=target,
        user_id=SEED.primary_profile,
    )

    result = await _discard(db_session, project_id=project_id, template_id=template_id)

    # Asserted FIRST, and deliberately: this is the harm, and a failure
    # here should name it rather than surface as a kept-set diff. Verified
    # to bite by disabling the up-walk, which destroys all three rows.
    for table, row_id in (
        ("extraction_instances", entry),
        ("extraction_instances", nested),
        ("extraction_proposal_records", proposal),
    ):
        assert (
            await db_session.execute(
                text(f"SELECT count(*) FROM public.{table} WHERE id = :id"),
                {"id": str(row_id)},
            )
        ).scalar_one() == 1, f"{table} row was destroyed by the sweep"
    assert {k.node_id for k in result.kept} == {container, child, target}
    assert result.deleted_entity_types == 0


@pytest.mark.asyncio
async def test_instance_blocked_section_keeps_its_draft_added_children(
    db_session: AsyncSession,
) -> None:
    """The DOWN half of the closure: a section kept because it owns
    instances keeps its draft-added children too (D4's "plus their
    subtrees"), so the manager is left with a coherent branch instead of a
    decapitated container.

    ``ck_extraction_entity_types_role_parent`` plus
    ``trg_check_model_section_parent_role`` cap the live tree at two levels
    (a ``model_section``'s parent must be a ``model_container``; the other
    two roles must have none), so a container and its sections ARE the
    whole subtree — there are no grandchildren to walk to."""
    project_id = SEED.secondary_project
    await clean_project_clones(db_session, project_id)
    clone = await clone_charms(db_session, project_id, SEED.primary_profile)
    template_id = clone.project_template_id
    # Drain the deferred role/parent queue while the tree is still whole
    # (see the ancestor test above), then restore deferral.
    await db_session.execute(text("SET CONSTRAINTS ALL IMMEDIATE"))
    await db_session.execute(text("SET CONSTRAINTS ALL DEFERRED"))
    await _delete_section(
        db_session, await _entity_id(db_session, template_id, "prediction_models")
    )
    await TemplateVersionService(db_session).republish(
        project_id=project_id, project_template_id=template_id, user_id=SEED.primary_profile
    )
    baseline = await _active_schema(db_session, template_id)

    container = await _add_section(
        db_session,
        template_id,
        "b9c1_parent_container",
        role="model_container",
        cardinality="many",
        entry_label="model",
        sort_order=98,
    )
    child = await _add_section(
        db_session,
        template_id,
        "b9c1_subtree_child",
        role="model_section",
        parent_id=container,
        sort_order=99,
    )
    await db_session.execute(
        text(
            "INSERT INTO public.articles (id, project_id, title, row_version) "
            "VALUES (:id, :pid, 'B-9c1 discard article', 1) ON CONFLICT (id) DO NOTHING"
        ),
        {"id": str(_ARTICLE_ID), "pid": str(project_id)},
    )
    # Only the CONTAINER holds recorded work; the child is deletable on its
    # own and is kept solely to leave a coherent branch behind.
    target = await _add_field(db_session, container, "b9c1_container_field")
    instance = await _add_instance(
        db_session, project_id=project_id, template_id=template_id, entity_type_id=container
    )
    session = await open_session(
        db_session,
        project_id=project_id,
        article_id=_ARTICLE_ID,
        template_id=template_id,
        user_id=SEED.primary_profile,
    )
    await make_proposal(
        db_session,
        run_id=session.run_id,
        instance_id=instance,
        field_id=target,
        user_id=SEED.primary_profile,
    )

    result = await _discard(db_session, project_id=project_id, template_id=template_id)

    kept = {k.node_id: k.reason for k in result.kept}
    assert kept == {
        container: "has_recorded_data",
        child: "related_to_kept_node",
        target: "has_recorded_data",
    }
    assert result.deleted_entity_types == 0
    await _assert_matches_baseline(
        db_session,
        template_id=template_id,
        baseline=baseline,
        extra_entity_ids=frozenset({container, child}),
        extra_field_ids=frozenset({target}),
    )


@pytest.mark.asyncio
async def test_baseline_field_whose_name_a_kept_field_took_is_reported(
    db_session: AsyncSession,
) -> None:
    """The standard "change a field's type" workaround — delete the field,
    re-add one under the same name — puts a KEPT node in the exact slot the
    baseline field wants back.

    ``uq_extraction_fields_entity_type_name`` is immediate and
    non-deferrable, so re-creating the baseline field aborts the
    transaction with a 23505 the D8 backstop does not recognise: an
    untyped 500, and Discard permanently impossible for the template. D4's
    philosophy extends instead — the baseline field is left alone and
    REPORTED."""
    project_id, template_id, baseline = await _fresh_charms(db_session)
    owner = await _entity_id(db_session, template_id, "sample_size")
    victim = await _field_id(db_session, template_id, "sample_size", "epv_epp")
    await _delete_field(db_session, victim)
    replacement = await _add_field(db_session, owner, "epv_epp")
    session = await open_session(
        db_session,
        project_id=project_id,
        article_id=_ARTICLE_ID,
        template_id=template_id,
        user_id=SEED.primary_profile,
    )
    await make_proposal(
        db_session,
        run_id=session.run_id,
        instance_id=UUID(session.instances_by_entity_type[str(owner)]),
        field_id=replacement,
        user_id=SEED.primary_profile,
    )

    result = await _discard(db_session, project_id=project_id, template_id=template_id)

    assert [(k.node_id, k.node_kind, k.reason) for k in result.kept] == [
        (replacement, "field", "has_recorded_data"),
        (victim, "field", "name_taken_by_kept_node"),
    ]
    assert result.created_fields == 0
    assert victim not in await _live_field_ids(db_session, template_id)
    await _assert_matches_baseline(
        db_session,
        template_id=template_id,
        baseline=baseline,
        extra_field_ids=frozenset({replacement}),
        unrestorable_field_ids=frozenset({victim}),
    )
    # Something could not be undone, so the template is still in draft.
    assert await get_config_draft_marker(db_session, template_id) is not None


@pytest.mark.asyncio
async def test_baseline_rename_blocked_by_a_kept_field_is_reported(
    db_session: AsyncSession,
) -> None:
    """The same collision on the UPDATE path (phase 6): the draft renamed a
    baseline field out of the way and gave its old name to a field that now
    holds recorded data. The rename back is skipped and reported, and the
    field keeps its draft name rather than aborting the whole Discard."""
    project_id, template_id, baseline = await _fresh_charms(db_session)
    owner = await _entity_id(db_session, template_id, "sample_size")
    renamed = await _field_id(db_session, template_id, "sample_size", "number_of_events")
    await _set_field_name(db_session, renamed, "b9c1_renamed_away")
    replacement = await _add_field(db_session, owner, "number_of_events")
    session = await open_session(
        db_session,
        project_id=project_id,
        article_id=_ARTICLE_ID,
        template_id=template_id,
        user_id=SEED.primary_profile,
    )
    await make_proposal(
        db_session,
        run_id=session.run_id,
        instance_id=UUID(session.instances_by_entity_type[str(owner)]),
        field_id=replacement,
        user_id=SEED.primary_profile,
    )

    result = await _discard(db_session, project_id=project_id, template_id=template_id)

    assert [(k.node_id, k.reason) for k in result.kept] == [
        (replacement, "has_recorded_data"),
        (renamed, "name_taken_by_kept_node"),
    ]
    still_named = (
        await db_session.execute(
            text("SELECT name FROM public.extraction_fields WHERE id = :id"),
            {"id": str(renamed)},
        )
    ).scalar_one()
    assert still_named == "b9c1_renamed_away"
    await _assert_matches_baseline(
        db_session,
        template_id=template_id,
        baseline=baseline,
        extra_field_ids=frozenset({replacement}),
        unrestorable_field_ids=frozenset({renamed}),
    )
    assert await get_config_draft_marker(db_session, template_id) is not None


# ==========================================================================
# D5 — refusals
# ==========================================================================


@pytest.mark.asyncio
async def test_cardinality_many_to_one_with_two_entries_is_refused(
    db_session: AsyncSession,
) -> None:
    """Restoring ``many`` -> ``one`` under a parent holding 2 entries makes
    the run un-completable — the same hazard the PATCH-time and
    publish-time guards refuse. Discard is the third door."""
    project_id, template_id, baseline = await _fresh_charms(db_session)
    section = await _entity_id(db_session, template_id, "model_development")
    container = await _entity_id(db_session, template_id, "prediction_models")
    await db_session.execute(
        text("UPDATE public.extraction_entity_types SET cardinality = 'many' WHERE id = :id"),
        {"id": str(section)},
    )
    await db_session.flush()
    parent = await _add_instance(
        db_session, project_id=project_id, template_id=template_id, entity_type_id=container
    )
    for _ in range(2):
        await _add_instance(
            db_session,
            project_id=project_id,
            template_id=template_id,
            entity_type_id=section,
            parent_instance_id=parent,
        )

    with pytest.raises(DiscardBlockedByCardinalityError):
        await _discard(db_session, project_id=project_id, template_id=template_id)

    # The draft is intact — the refusal happened before any write.
    still_many = (
        await db_session.execute(
            text("SELECT cardinality FROM public.extraction_entity_types WHERE id = :id"),
            {"id": str(section)},
        )
    ).scalar_one()
    assert still_many == "many"
    assert baseline["entity_types"]


@pytest.mark.asyncio
async def test_container_swap_is_refused(db_session: AsyncSession) -> None:
    """The writer's D3 structural refusal, surfaced as a typed 409."""
    project_id, template_id, _ = await _fresh_charms(db_session)
    await _delete_section(
        db_session, await _entity_id(db_session, template_id, "prediction_models")
    )
    await _add_section(
        db_session,
        template_id,
        "b9c1_new_container",
        role="model_container",
        cardinality="many",
        entry_label="model",
    )

    with pytest.raises(ContainerSwapUnsupportedError):
        await _discard(db_session, project_id=project_id, template_id=template_id)


@pytest.mark.asyncio
async def test_container_swap_is_refused_even_when_the_new_container_is_kept(
    db_session: AsyncSession,
) -> None:
    """D3's guard read the delete set AFTER D4 had filtered the skip set out
    of it, so a draft-added container that owns instances never set the
    flag: the refusal did not fire, phase 1 re-inserted the baseline
    container, and ``uq_extraction_entity_types_one_container_per_project``
    turned the actionable 409 into an untyped 500.

    The guard must read the PRE-skip view — every live container absent
    from the baseline counts, kept or not."""
    project_id, template_id, _ = await _fresh_charms(db_session)
    await _delete_section(
        db_session, await _entity_id(db_session, template_id, "prediction_models")
    )
    new_container = await _add_section(
        db_session,
        template_id,
        "b9c1_kept_container",
        role="model_container",
        cardinality="many",
        entry_label="model",
    )
    await _add_instance(
        db_session, project_id=project_id, template_id=template_id, entity_type_id=new_container
    )

    with pytest.raises(ContainerSwapUnsupportedError):
        await _discard(db_session, project_id=project_id, template_id=template_id)


@pytest.mark.asyncio
async def test_narrow_baseline_is_refused(db_session: AsyncSession) -> None:
    """A pre-0026 baseline would wipe ``llm_description``/``allow_other``
    project-wide if written back — no Discard until B-9x."""
    project_id, template_id, _ = await _fresh_charms(db_session)
    section = await _entity_id(db_session, template_id, "participants")
    await force_narrow_baseline(db_session, template_id, section)

    with pytest.raises(NarrowBaselineError, match="B-9x"):
        await _discard(db_session, project_id=project_id, template_id=template_id)


@pytest.mark.asyncio
async def test_empty_baseline_is_restorable(db_session: AsyncSession) -> None:
    """``snapshot_is_narrow([])`` is True by design (the run view falls back
    to live rows), but an EMPTY published baseline is wide and restorable:
    the restore is a plain delete-all. The gate must be
    ``entity_types and snapshot_is_narrow(entity_types)``."""
    project_id, template_id, _ = await _fresh_charms(db_session)
    await _force_active_schema(db_session, template_id, {"entity_types": []})
    await set_config_draft_marker(db_session, template_id, datetime.now(UTC))

    result = await _discard(db_session, project_id=project_id, template_id=template_id)

    assert result.kept == []
    assert result.deleted_entity_types == 14
    assert await _live_entity_ids(db_session, template_id) == set()
    assert await _live_field_ids(db_session, template_id) == set()
    assert await get_config_draft_marker(db_session, template_id) is None


@pytest.mark.asyncio
async def test_no_active_version_is_a_typed_error(db_session: AsyncSession) -> None:
    project_id, template_id, _ = await _fresh_charms(db_session)
    await db_session.execute(
        text(
            "UPDATE public.extraction_template_versions SET is_active = false "
            "WHERE project_template_id = :tid"
        ),
        {"tid": str(template_id)},
    )
    await db_session.flush()

    with pytest.raises(NoActiveTemplateVersionError):
        await _discard(db_session, project_id=project_id, template_id=template_id)


@pytest.mark.asyncio
async def test_foreign_project_is_not_found(db_session: AsyncSession) -> None:
    """BOLA: a manager elsewhere must not be able to discard this
    template's draft — and the 404 never leaks that it exists."""
    _, template_id, _ = await _fresh_charms(db_session)

    with pytest.raises(ProjectTemplateNotFoundError):
        await _discard(db_session, project_id=SEED.primary_project, template_id=template_id)


# ==========================================================================
# D6 — orphan acknowledgement
# ==========================================================================


async def _field_label(db: AsyncSession, field_id: UUID) -> str:
    label: str = (
        await db.execute(
            text("SELECT label FROM public.extraction_fields WHERE id = :id"),
            {"id": str(field_id)},
        )
    ).scalar_one()
    return label


@pytest.mark.asyncio
async def test_orphaning_change_without_the_ack_is_refused(db_session: AsyncSession) -> None:
    """``diff total`` cannot see this: removing a draft-added option a
    reviewer already picked orphans recorded work, so it needs an explicit
    ack rather than a silent restore."""
    project_id, template_id, field = await _option_orphan_setup(db_session)

    with pytest.raises(OrphanAcknowledgementRequiredError) as exc:
        await _discard(db_session, project_id=project_id, template_id=template_id)

    # B-9c2 D1: the prose names the field; the id rides in ``details``.
    assert await _field_label(db_session, field) in str(exc.value)
    assert str(field) not in str(exc.value)
    still_there = (
        await db_session.execute(
            text("SELECT allowed_values FROM public.extraction_fields WHERE id = :id"),
            {"id": str(field)},
        )
    ).scalar_one()
    assert still_there == ["draft_option"]


@pytest.mark.asyncio
async def test_orphaning_change_with_the_ack_proceeds(db_session: AsyncSession) -> None:
    project_id, template_id, field = await _option_orphan_setup(db_session)

    result = await _discard(
        db_session, project_id=project_id, template_id=template_id, acknowledge_orphans=True
    )

    assert result.updated_fields == 1
    restored = (
        await db_session.execute(
            text("SELECT allowed_values FROM public.extraction_fields WHERE id = :id"),
            {"id": str(field)},
        )
    ).scalar_one()
    assert restored is None


@pytest.mark.asyncio
async def test_destructive_change_on_a_value_free_field_needs_no_ack(
    db_session: AsyncSession,
) -> None:
    """The gate is ``destructive AND the field holds values`` — a draft
    option nobody picked is discarded without ceremony."""
    project_id, template_id, baseline = await _fresh_charms(db_session)
    field = await _field_id(db_session, template_id, "sample_size", "number_of_participants")
    await db_session.execute(
        text(
            "UPDATE public.extraction_fields "
            "SET allowed_values = CAST('[\"unused_option\"]' AS jsonb) WHERE id = :id"
        ),
        {"id": str(field)},
    )
    await db_session.flush()

    result = await _discard(db_session, project_id=project_id, template_id=template_id)

    assert result.updated_fields == 1
    await _assert_matches_baseline(db_session, template_id=template_id, baseline=baseline)


# ==========================================================================
# D7 — the marker
# ==========================================================================


@pytest.mark.asyncio
async def test_clean_but_drifted_template_reports_draft_was_open_false(
    db_session: AsyncSession,
) -> None:
    """There is no "no draft open => no-op" short-circuit: a marker-NULL
    template whose live tree drifted is a real state (a lost republish),
    and Discard is what repairs it."""
    project_id, template_id, baseline = await _fresh_charms(db_session)
    section = await _entity_id(db_session, template_id, "participants")
    await _set_label(db_session, "extraction_entity_types", section, "Drifted")
    await set_config_draft_marker(db_session, template_id, None)

    result = await _discard(db_session, project_id=project_id, template_id=template_id)

    assert result.draft_was_open is False
    assert result.updated_entity_types == 1
    await _assert_matches_baseline(db_session, template_id=template_id, baseline=baseline)
    assert await get_config_draft_marker(db_session, template_id) is None


@pytest.mark.asyncio
async def test_marker_is_cleared_when_nothing_is_kept(db_session: AsyncSession) -> None:
    """The writer's own flushes re-stamp the marker through the 0048
    AFTER-ROW triggers, so the clear has to be the LAST statement."""
    project_id, template_id, baseline = await _fresh_charms(db_session)
    section = await _entity_id(db_session, template_id, "participants")
    await _add_field(db_session, section, "b9c1_transient")
    assert await get_config_draft_marker(db_session, template_id) is not None

    result = await _discard(db_session, project_id=project_id, template_id=template_id)

    assert result.kept == []
    assert result.deleted_fields == 1
    assert await get_config_draft_marker(db_session, template_id) is None
    await _assert_matches_baseline(db_session, template_id=template_id, baseline=baseline)


@pytest.mark.asyncio
async def test_instruction_is_reset(db_session: AsyncSession) -> None:
    project_id, template_id, baseline = await _fresh_charms(db_session)
    await db_session.execute(
        text(
            "UPDATE public.project_extraction_templates "
            "SET llm_template_instruction = 'draft instruction' WHERE id = :id"
        ),
        {"id": str(template_id)},
    )
    await db_session.flush()

    result = await _discard(db_session, project_id=project_id, template_id=template_id)

    assert result.instruction_reset is True
    await _assert_matches_baseline(db_session, template_id=template_id, baseline=baseline)


# ==========================================================================
# D8 — the DB is authoritative
# ==========================================================================


@pytest.mark.asyncio
async def test_lost_race_on_a_blocked_node_raises_a_typed_error(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Detection is advisory: ``acquire_publish_locks`` narrows the window
    but the AI proposal writers take no locks. A 23503 from the RESTRICT
    FK must surface as a typed refusal, never as a 500 or as more SQL on a
    poisoned transaction. Blinding the detection reads reproduces exactly
    the state a lost race leaves behind — a proposal written after the
    gate looked.

    Real work, not a bare instance: the writer now SWEEPS the empty
    instances it is allowed to delete, so instance ownership alone no
    longer reaches the FK. What survives a blinded gate is the work the
    five ``field_id`` RESTRICT FKs guard."""
    project_id, template_id, _ = await _fresh_charms(db_session)
    added = await _add_section(db_session, template_id, "b9c1_raced_section")
    target = await _add_field(db_session, added, "b9c1_raced_field")
    session = await open_session(
        db_session,
        project_id=project_id,
        article_id=_ARTICLE_ID,
        template_id=template_id,
        user_id=SEED.primary_profile,
    )
    await make_proposal(
        db_session,
        run_id=session.run_id,
        instance_id=UUID(session.instances_by_entity_type[str(added)]),
        field_id=target,
        user_id=SEED.primary_profile,
    )

    async def _blind(*_args: object, **_kwargs: object) -> frozenset[UUID]:
        return frozenset()

    monkeypatch.setattr(ExtractionFieldReferenceRepository, "sections_with_recorded_work", _blind)
    monkeypatch.setattr(ExtractionFieldReferenceRepository, "fields_with_recorded_work", _blind)

    with pytest.raises(DiscardRacedError):
        await _discard(db_session, project_id=project_id, template_id=template_id)


# ==========================================================================
# D10 — telemetry
# ==========================================================================


@pytest_asyncio.fixture
async def captured_logs() -> AsyncGenerator[LogCapture, None]:
    capture = LogCapture()
    structlog.configure(processors=[capture])
    yield capture
    structlog.reset_defaults()


@pytest.mark.asyncio
async def test_discard_emits_one_reconstructable_event(
    db_session: AsyncSession, captured_logs: LogCapture
) -> None:
    project_id, template_id, _ = await _fresh_charms(db_session)
    section = await _entity_id(db_session, template_id, "participants")
    await _set_label(db_session, "extraction_entity_types", section, "Draft label")
    added = await _add_section(db_session, template_id, "b9c1_logged_section")
    target = await _add_field(db_session, added, "b9c1_logged_field")
    session = await open_session(
        db_session,
        project_id=project_id,
        article_id=_ARTICLE_ID,
        template_id=template_id,
        user_id=SEED.primary_profile,
    )
    await make_proposal(
        db_session,
        run_id=session.run_id,
        instance_id=UUID(session.instances_by_entity_type[str(added)]),
        field_id=target,
        user_id=SEED.primary_profile,
    )

    await _discard(db_session, project_id=project_id, template_id=template_id)

    events = [e for e in captured_logs.entries if e["event"] == "template_config_draft_discarded"]
    assert len(events) == 1
    event = events[0]
    assert event["log_level"] == "info"
    assert event["project_id"] == str(project_id)
    assert event["template_id"] == str(template_id)
    assert event["user_id"] == str(SEED.primary_profile)
    assert event["config_draft_since"] is not None
    assert event["updated_entity_types"] == 1
    assert event["kept"] == [
        {"node_id": str(added), "node_kind": "entity_type", "reason": "has_recorded_data"},
        {"node_id": str(target), "node_kind": "field", "reason": "has_recorded_data"},
    ]
    assert event["marker_cleared"] is False
    # The summary is the diff in the direction of the OPERATION (live ->
    # published), minus the kept nodes: the label revert is what this
    # Discard actually undid, and the kept section is not counted as a loss.
    assert event["discarded_changes_by_tier"] == {
        "additive": 0,
        "cosmetic": 1,
        "semantic": 0,
        "destructive": 0,
    }


@pytest.mark.asyncio
async def test_refusal_emits_a_warning_naming_the_blocking_node(
    db_session: AsyncSession, captured_logs: LogCapture
) -> None:
    project_id, template_id, _ = await _fresh_charms(db_session)
    section = await _entity_id(db_session, template_id, "participants")
    await force_narrow_baseline(db_session, template_id, section)

    with pytest.raises(NarrowBaselineError):
        await _discard(db_session, project_id=project_id, template_id=template_id)

    warnings = [e for e in captured_logs.entries if e["event"] == "template_config_discard_refused"]
    assert len(warnings) == 1
    assert warnings[0]["log_level"] == "warning"
    assert warnings[0]["refusal"] == "NarrowBaselineError"
    assert warnings[0]["template_id"] == str(template_id)


# ==========================================================================
# HTTP surface — routing, auth, envelope
# ==========================================================================


@pytest.mark.asyncio
async def test_endpoint_discards_through_the_asgi_stack(
    db_session: AsyncSession, db_client: AsyncClient, auth_as_manager: UUID
) -> None:
    assert auth_as_manager == SEED.primary_profile
    project_id, template_id, _ = await _fresh_charms(db_session)
    section = await _entity_id(db_session, template_id, "participants")
    await _add_field(db_session, section, "b9c1_http_field")

    res = await db_client.post(
        f"/api/v1/projects/{project_id}/templates/{template_id}/discard-draft",
        json={"acknowledge_orphans": False},
    )

    assert res.status_code == 200, res.text
    envelope = res.json()
    assert envelope["ok"] is True
    assert envelope["data"]["deleted_fields"] == 1
    assert envelope["data"]["kept"] == []
    await db_session.rollback()


@pytest.mark.asyncio
async def test_endpoint_refusal_carries_the_orphans_as_structured_details(
    db_session: AsyncSession, db_client: AsyncClient, auth_as_manager: UUID
) -> None:
    """B-9c2 D1, at the level that matters: the dialog branches on
    ``error.code`` and renders ``error.details.orphans``, neither of which
    a service-level ``pytest.raises`` can see. A raw ``UUID`` in ``details``
    would 500 *inside* ``app_error_handler`` (bare ``JSONResponse``), so the
    node ids must arrive as strings."""
    assert auth_as_manager == SEED.primary_profile
    project_id, template_id, field = await _option_orphan_setup(db_session)
    label = await _field_label(db_session, field)

    res = await db_client.post(
        f"/api/v1/projects/{project_id}/templates/{template_id}/discard-draft",
        json={"acknowledge_orphans": False},
    )

    assert res.status_code == 409, res.text
    error = res.json()["error"]
    assert error["code"] == "ORPHAN_ACK_REQUIRED"
    orphans = error["details"]["orphans"]
    assert len(orphans) == 1
    assert orphans[0]["node_id"] == str(field)
    assert isinstance(orphans[0]["node_id"], str)
    assert label in orphans[0]["label"]
    # The prose lost the parameter leak and the ids (they ride in details).
    assert "acknowledge_orphans" not in error["message"]
    assert str(field) not in error["message"]
    await db_session.rollback()


@pytest.mark.asyncio
async def test_endpoint_dedupes_orphans_by_field(
    db_session: AsyncSession, db_client: AsyncClient, auth_as_manager: UUID
) -> None:
    """``allowed_values`` is diffed per option code, so one field losing two
    recorded options is TWO destructive changes — and one orphan."""
    assert auth_as_manager == SEED.primary_profile
    project_id, template_id, field = await _option_orphan_setup(
        db_session, options=("draft_option", "second_option")
    )

    res = await db_client.post(
        f"/api/v1/projects/{project_id}/templates/{template_id}/discard-draft",
        json={"acknowledge_orphans": False},
    )

    assert res.status_code == 409, res.text
    orphans = res.json()["error"]["details"]["orphans"]
    assert [o["node_id"] for o in orphans] == [str(field)]
    await db_session.rollback()


@pytest.mark.asyncio
async def test_endpoint_hard_refusal_has_its_own_code_and_no_details(
    db_session: AsyncSession, db_client: AsyncClient, auth_as_manager: UUID
) -> None:
    """A hard refusal is not the ack question: a distinct code, so the
    dialog cannot re-ask with ``acknowledge_orphans`` and get the same 409
    forever."""
    assert auth_as_manager == SEED.primary_profile
    project_id, template_id, _ = await _fresh_charms(db_session)
    section = await _entity_id(db_session, template_id, "participants")
    await force_narrow_baseline(db_session, template_id, section)

    res = await db_client.post(
        f"/api/v1/projects/{project_id}/templates/{template_id}/discard-draft",
        json={"acknowledge_orphans": False},
    )

    assert res.status_code == 409, res.text
    error = res.json()["error"]
    assert error["code"] == "NARROW_BASELINE"
    assert error["details"] is None
    await db_session.rollback()


@pytest.mark.asyncio
async def test_endpoint_rejects_a_non_manager(
    db_session: AsyncSession, db_client: AsyncClient
) -> None:
    async def _reviewer() -> TokenPayload:
        return TokenPayload(
            sub=str(SEED.reviewer_profile), email="r@example.com", role="authenticated", aal="aal1"
        )

    app.dependency_overrides[get_current_user] = _reviewer
    try:
        res = await db_client.post(
            f"/api/v1/projects/{SEED.primary_project}/templates/{SEED.primary_template}"
            "/discard-draft",
            json={"acknowledge_orphans": False},
        )
        assert res.status_code == 403, res.text
    finally:
        app.dependency_overrides.pop(get_current_user, None)
    await db_session.rollback()


# ==========================================================================
# Entry key — Discard after deleting the key field gives the identity back
# ==========================================================================


@pytest.mark.asyncio
async def test_discard_after_deleting_the_entry_key_field_restores_the_identity(
    db_session: AsyncSession,
) -> None:
    """Identity is versioned config. Before the snapshot carried
    ``is_entity_key``, Discard rebuilt the deleted key field as an ordinary
    field and the container's next AI re-run was refused
    (``MissingEntityKeyError``) on a template the manager had just restored."""
    project_id, template_id, baseline = await _fresh_charms(db_session)
    section = await _entity_id(db_session, template_id, "prediction_models")
    key_field = await _field_id(db_session, template_id, "prediction_models", "model_name")
    await _delete_field(db_session, key_field)

    result = await _discard(db_session, project_id=project_id, template_id=template_id)

    assert result.kept == []
    assert result.created_fields == 1
    assert (await resolve_key_field(db_session, section)).id == key_field
    assert await get_config_draft_marker(db_session, template_id) is None
    await _assert_matches_baseline(db_session, template_id=template_id, baseline=baseline)
