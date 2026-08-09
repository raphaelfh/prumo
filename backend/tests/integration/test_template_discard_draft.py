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
from uuid import UUID, uuid4

import pytest
import pytest_asyncio
import structlog
from httpx import AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from structlog.testing import LogCapture

from app.core.security import TokenPayload, get_current_user
from app.main import app
from app.services import template_discard_service
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

_ARTICLE_ID = UUID("ffffffff-9999-0002-0000-0000000009c1")


# --------------------------------------------------------------------------
# Baseline setup
# --------------------------------------------------------------------------


async def _fresh_charms(db: AsyncSession) -> tuple[UUID, UUID, dict[str, Any]]:
    """CHARMS cloned into the cross-project seed and published.

    Also materializes an article there: every partial-discard case needs a
    HITL session, and the cross-project seed ships none."""
    project_id = SEED.secondary_project
    await clean_project_clones(db, project_id)
    await db.execute(
        text(
            "INSERT INTO public.articles (id, project_id, title, row_version) "
            "VALUES (:id, :pid, 'B-9c1 discard article', 1) "
            "ON CONFLICT (id) DO NOTHING"
        ),
        {"id": str(_ARTICLE_ID), "pid": str(project_id)},
    )
    clone = await clone_charms(db, project_id, SEED.primary_profile)
    template_id = clone.project_template_id
    await TemplateVersionService(db).republish(
        project_id=project_id,
        project_template_id=template_id,
        user_id=SEED.primary_profile,
    )
    return project_id, template_id, await _active_schema(db, template_id)


async def _active_schema(db: AsyncSession, template_id: UUID) -> dict[str, Any]:
    schema: dict[str, Any] = (
        await db.execute(
            text(
                "SELECT schema FROM public.extraction_template_versions "
                "WHERE project_template_id = :tid AND is_active IS TRUE"
            ),
            {"tid": str(template_id)},
        )
    ).scalar_one()
    return schema


async def _force_active_schema(db: AsyncSession, template_id: UUID, schema: dict[str, Any]) -> None:
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


async def _set_label(db: AsyncSession, table: str, node_id: UUID, label: str) -> None:
    await db.execute(
        text(f"UPDATE public.{table} SET label = :label WHERE id = :id"),  # noqa: S608
        {"id": str(node_id), "label": label},
    )
    await db.flush()


async def _delete_section(db: AsyncSession, entity_id: UUID) -> None:
    await db.execute(
        text("DELETE FROM public.extraction_entity_types WHERE id = :id"), {"id": str(entity_id)}
    )
    await db.flush()


async def _add_instance(
    db: AsyncSession,
    *,
    project_id: UUID,
    template_id: UUID,
    entity_type_id: UUID,
    parent_instance_id: UUID | None = None,
) -> UUID:
    """One extraction instance, the way the run UI adds a repeating entry."""
    instance_id = uuid4()
    await db.execute(
        text(
            "INSERT INTO public.extraction_instances "
            "(id, project_id, article_id, template_id, entity_type_id, parent_instance_id, "
            " label, sort_order, created_by) "
            "VALUES (:id, :pid, :aid, :tid, :et, :parent, 'entry', 0, :uid)"
        ),
        {
            "id": str(instance_id),
            "pid": str(project_id),
            "aid": str(_ARTICLE_ID),
            "tid": str(template_id),
            "et": str(entity_type_id),
            "parent": str(parent_instance_id) if parent_instance_id else None,
            "uid": str(SEED.primary_profile),
        },
    )
    await db.flush()
    return instance_id


async def _assert_matches_baseline(
    db: AsyncSession,
    *,
    template_id: UUID,
    baseline: dict[str, Any],
    extra_entity_ids: frozenset[UUID] = frozenset(),
    extra_field_ids: frozenset[UUID] = frozenset(),
) -> None:
    """T1's structural check, reduced to what T2 owns: everything outside
    the KEPT set is back on the baseline."""
    await db.execute(text("SET CONSTRAINTS ALL IMMEDIATE"))
    rebuilt = await build_template_version_snapshot(db, template_id)
    extras = extra_entity_ids | extra_field_ids
    unexplained = [
        c
        for c in diff_snapshots(baseline, rebuilt, fields_with_values=frozenset()).changes
        if c.node_id not in extras
    ]
    assert not unexplained, f"discard left {len(unexplained)} change(s): {unexplained}"

    base_entity_ids = {UUID(et["id"]) for et in baseline["entity_types"]}
    base_field_ids = {
        UUID(f["id"]) for et in baseline["entity_types"] for f in et.get("fields") or []
    }
    assert await _live_entity_ids(db, template_id) == base_entity_ids | extra_entity_ids
    assert await _live_field_ids(db, template_id) == base_field_ids | extra_field_ids


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
async def test_section_owning_instances_is_kept_and_the_rest_restored(
    db_session: AsyncSession,
) -> None:
    """The commonest draft shape: a new top-level section that a session
    has already materialized an instance for. Refusing the whole Discard
    would make it permanently unavailable, so the section is KEPT, the
    rest of the draft is undone, and the marker stays set (D4/D7)."""
    project_id, template_id, baseline = await _fresh_charms(db_session)
    added = await _add_section(db_session, template_id, "b9c1_kept_section")
    renamed = await _entity_id(db_session, template_id, "participants")
    await _set_label(db_session, "extraction_entity_types", renamed, "Draft label")
    await open_session(
        db_session,
        project_id=project_id,
        article_id=_ARTICLE_ID,
        template_id=template_id,
        user_id=SEED.primary_profile,
    )

    result = await _discard(db_session, project_id=project_id, template_id=template_id)

    assert result.draft_was_open is True
    assert [k.node_id for k in result.kept] == [added]
    assert result.kept[0].reason == "has_recorded_data"
    assert result.kept[0].node_kind == "entity_type"
    assert result.deleted_entity_types == 0
    assert result.updated_entity_types == 1
    await _assert_matches_baseline(
        db_session,
        template_id=template_id,
        baseline=baseline,
        extra_entity_ids=frozenset({added}),
    )
    # D4: something was kept, so the template is still in draft.
    assert await get_config_draft_marker(db_session, template_id) is not None


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
    await _add_instance(
        db_session, project_id=project_id, template_id=template_id, entity_type_id=child
    )

    result = await _discard(db_session, project_id=project_id, template_id=template_id)

    kept = {k.node_id: k.reason for k in result.kept}
    assert kept == {child: "has_recorded_data", container: "related_to_kept_node"}
    assert result.deleted_entity_types == 0
    await _assert_matches_baseline(
        db_session,
        template_id=template_id,
        baseline=baseline,
        extra_entity_ids=frozenset({container, child}),
    )


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
async def test_narrow_baseline_is_refused(db_session: AsyncSession) -> None:
    """A pre-0026 baseline would wipe ``llm_description``/``allow_other``
    project-wide if written back — no Discard until B-9x."""
    project_id, template_id, _ = await _fresh_charms(db_session)
    section = await _entity_id(db_session, template_id, "participants")
    await _force_active_schema(
        db_session,
        template_id,
        {"entity_types": [{"id": str(section), "label": "Participants", "fields": []}]},
    )

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


async def _option_orphan_setup(db_session: AsyncSession) -> tuple[UUID, UUID, UUID]:
    """A draft that added a select option a reviewer then picked."""
    project_id, template_id, _ = await _fresh_charms(db_session)
    owner = await _entity_id(db_session, template_id, "sample_size")
    field = await _field_id(db_session, template_id, "sample_size", "number_of_participants")
    session = await open_session(
        db_session,
        project_id=project_id,
        article_id=_ARTICLE_ID,
        template_id=template_id,
        user_id=SEED.primary_profile,
    )
    await db_session.execute(
        text(
            "UPDATE public.extraction_fields "
            "SET allowed_values = CAST('[\"draft_option\"]' AS jsonb) WHERE id = :id"
        ),
        {"id": str(field)},
    )
    await db_session.flush()
    await make_proposal(
        db_session,
        run_id=session.run_id,
        instance_id=UUID(session.instances_by_entity_type[str(owner)]),
        field_id=field,
        user_id=SEED.primary_profile,
        value="draft_option",
    )
    return project_id, template_id, field


@pytest.mark.asyncio
async def test_orphaning_change_without_the_ack_is_refused(db_session: AsyncSession) -> None:
    """``diff total`` cannot see this: removing a draft-added option a
    reviewer already picked orphans recorded work, so it needs an explicit
    ack rather than a silent restore."""
    project_id, template_id, field = await _option_orphan_setup(db_session)

    with pytest.raises(OrphanAcknowledgementRequiredError) as exc:
        await _discard(db_session, project_id=project_id, template_id=template_id)

    assert str(field) in str(exc.value)
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
    poisoned transaction. Blinding the detection query reproduces exactly
    the state a lost race leaves behind."""
    project_id, template_id, _ = await _fresh_charms(db_session)
    await _add_section(db_session, template_id, "b9c1_raced_section")
    await open_session(
        db_session,
        project_id=project_id,
        article_id=_ARTICLE_ID,
        template_id=template_id,
        user_id=SEED.primary_profile,
    )

    async def _blind(*_args: object, **_kwargs: object) -> frozenset[UUID]:
        return frozenset()

    monkeypatch.setattr(template_discard_service, "_entity_types_with_instances", _blind)

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
    await open_session(
        db_session,
        project_id=project_id,
        article_id=_ARTICLE_ID,
        template_id=template_id,
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
        {"node_id": str(added), "node_kind": "entity_type", "reason": "has_recorded_data"}
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
    await _force_active_schema(
        db_session,
        template_id,
        {"entity_types": [{"id": str(section), "label": "Participants", "fields": []}]},
    )

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


@pytest_asyncio.fixture
async def auth_as_manager(db_session: AsyncSession) -> AsyncGenerator[UUID, None]:
    """JWT sub = a manager of both seeded projects."""
    del db_session  # fixture ordering only: the seed must run first

    async def _override() -> TokenPayload:
        return TokenPayload(
            sub=str(SEED.primary_profile), email="t@example.com", role="authenticated", aal="aal1"
        )

    app.dependency_overrides[get_current_user] = _override
    yield SEED.primary_profile
    app.dependency_overrides.pop(get_current_user, None)


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
