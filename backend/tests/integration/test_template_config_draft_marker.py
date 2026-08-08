"""Draft-marker lifecycle (slice B-4).

The editor writes config through PostgREST until B-7, so the ONLY
reliable place to record "there are unpublished edits" is the DB:
AFTER-row triggers on the two live config tables stamp
``project_extraction_templates.config_draft_since``; publish paths
clear it inside ``TemplateVersionService.republish``'s locked section.

The stamp is ``COALESCE(config_draft_since, now())`` with no WHERE
predicate beyond the id: an UPDATE whose WHERE misses the committed row
takes no row lock, so a predicate-guarded stamp racing a mid-flight
publish would commit unserialized and the publish would clear a draft
it never snapshotted.
"""

from datetime import UTC, datetime
from uuid import UUID, uuid4

import pytest
from sqlalchemy import select, text, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction import (
    ExtractionEntityType,
    ExtractionField,
    ExtractionTemplateGlobal,
    ProjectExtractionTemplate,
)
from tests.integration.conftest import SEED

# A sentinel far in the past: within one test transaction now() is
# constant, so "a later edit keeps the first timestamp" is only
# falsifiable against a PRE-SET value, never against two in-txn stamps.
_SENTINEL = datetime(2020, 1, 1, tzinfo=UTC)


async def _marker(db: AsyncSession, template_id: UUID) -> datetime | None:
    return (
        await db.execute(
            select(ProjectExtractionTemplate.config_draft_since).where(
                ProjectExtractionTemplate.id == template_id
            )
        )
    ).scalar_one()


async def _set_marker(db: AsyncSession, template_id: UUID, value: datetime | None) -> None:
    await db.execute(
        update(ProjectExtractionTemplate)
        .where(ProjectExtractionTemplate.id == template_id)
        .values(config_draft_since=value)
    )
    await db.flush()


def _probe_field(name: str) -> ExtractionField:
    return ExtractionField(
        entity_type_id=SEED.primary_entity_type,
        name=name,
        label=f"probe {name}",
        field_type="text",
        is_required=False,
        validation_schema={},
        sort_order=999,
    )


@pytest.mark.asyncio
async def test_field_insert_update_delete_mark_draft(db_session: AsyncSession) -> None:
    await _set_marker(db_session, SEED.primary_template, None)

    field = _probe_field("b4_marker_probe")
    db_session.add(field)
    await db_session.flush()
    assert await _marker(db_session, SEED.primary_template) is not None

    await _set_marker(db_session, SEED.primary_template, None)
    field.label = "probe renamed"
    await db_session.flush()
    assert await _marker(db_session, SEED.primary_template) is not None

    await _set_marker(db_session, SEED.primary_template, None)
    await db_session.delete(field)
    await db_session.flush()
    assert await _marker(db_session, SEED.primary_template) is not None


@pytest.mark.asyncio
async def test_entity_type_write_marks_draft(db_session: AsyncSession) -> None:
    await _set_marker(db_session, SEED.primary_template, None)
    et = await db_session.get(ExtractionEntityType, SEED.primary_entity_type)
    assert et is not None
    et.label = f"{et.label} (b4)"
    await db_session.flush()
    assert await _marker(db_session, SEED.primary_template) is not None


@pytest.mark.asyncio
async def test_marker_keeps_first_edit_timestamp(db_session: AsyncSession) -> None:
    """COALESCE semantics: a later edit never moves an existing stamp."""
    await _set_marker(db_session, SEED.primary_template, _SENTINEL)
    et = await db_session.get(ExtractionEntityType, SEED.primary_entity_type)
    assert et is not None
    et.label = f"{et.label} (later edit)"
    await db_session.flush()
    assert await _marker(db_session, SEED.primary_template) == _SENTINEL


@pytest.mark.asyncio
async def test_global_lineage_writes_never_stamp(db_session: AsyncSession) -> None:
    """The seed writes these SAME tables in global lineage (template_id
    set, project_template_id NULL) — the trigger's v_template IS NULL
    skip is what keeps seeding a no-op. Pin it so the guard is never
    "simplified" away."""
    await _set_marker(db_session, SEED.primary_template, None)

    global_tpl = ExtractionTemplateGlobal(
        name="b4 marker probe global",
        framework="CUSTOM",
        kind="extraction",
    )
    db_session.add(global_tpl)
    await db_session.flush()

    global_et = ExtractionEntityType(
        template_id=global_tpl.id,
        project_template_id=None,
        name="b4_probe_global_section",
        label="B4 probe global section",
        role="study_section",
        cardinality="one",
        sort_order=0,
    )
    db_session.add(global_et)
    await db_session.flush()

    global_field = ExtractionField(
        entity_type_id=global_et.id,
        name="b4_probe_global_field",
        label="B4 probe global field",
        field_type="text",
        is_required=False,
        validation_schema={},
        sort_order=0,
    )
    db_session.add(global_field)
    await db_session.flush()
    global_field.label = "B4 probe global field (renamed)"
    await db_session.flush()

    assert await _marker(db_session, SEED.primary_template) is None


# ---------------------------------------------------------------------------
# Publish paths clear the marker (Task 2): every path that publishes live
# structure routes through TemplateVersionService.republish, whose locked
# section clears the stamp. The lazy v1 self-heal on run creation is the
# DELIBERATE exception (clearing under create_run's FOR SHARE would be an
# in-place lock upgrade — two concurrent first-runs deadlock).
# ---------------------------------------------------------------------------

CHARMS_GLOBAL_ID = UUID("000c0000-0000-0000-0000-000000000001")


async def _clean_project_clones(db: AsyncSession, project_id: UUID) -> None:
    await db.execute(
        text("DELETE FROM public.project_extraction_templates WHERE project_id = :pid"),
        {"pid": str(project_id)},
    )


async def _clone_charms(db: AsyncSession, project_id: UUID, user_id: UUID):
    from app.models.extraction import TemplateKind
    from app.services.template_clone_service import TemplateCloneService

    return await TemplateCloneService(db).clone(
        project_id=project_id,
        global_template_id=CHARMS_GLOBAL_ID,
        user_id=user_id,
        kind=TemplateKind.EXTRACTION,
    )


async def _first_entity_type_id(db: AsyncSession, project_template_id: UUID) -> UUID:
    return (
        await db.execute(
            select(ExtractionEntityType.id)
            .where(ExtractionEntityType.project_template_id == project_template_id)
            .order_by(ExtractionEntityType.sort_order)
            .limit(1)
        )
    ).scalar_one()


@pytest.mark.asyncio
async def test_republish_clears_marker_after_change(db_session: AsyncSession) -> None:
    from app.services.template_version_service import TemplateVersionService

    project_id = SEED.secondary_project
    user_id = SEED.primary_profile
    await _clean_project_clones(db_session, project_id)
    clone = await _clone_charms(db_session, project_id, user_id)

    et = await db_session.get(
        ExtractionEntityType, await _first_entity_type_id(db_session, clone.project_template_id)
    )
    assert et is not None
    et.label = f"{et.label} (draft edit)"
    await db_session.flush()
    assert await _marker(db_session, clone.project_template_id) is not None

    result = await TemplateVersionService(db_session).republish(
        project_id=project_id,
        project_template_id=clone.project_template_id,
        user_id=user_id,
    )
    assert result.changed is True
    assert await _marker(db_session, clone.project_template_id) is None

    await db_session.rollback()


@pytest.mark.asyncio
async def test_republish_clears_marker_when_snapshot_identical(
    db_session: AsyncSession,
) -> None:
    """Marker set + snapshot-identical live tree (e.g. an A→B→A rename):
    Publish must still clear, or the chip sticks on "Unpublished changes"
    with a dead Publish button."""
    from app.services.template_version_service import TemplateVersionService

    project_id = SEED.secondary_project
    user_id = SEED.primary_profile
    await _clean_project_clones(db_session, project_id)
    clone = await _clone_charms(db_session, project_id, user_id)

    await _set_marker(db_session, clone.project_template_id, _SENTINEL)
    result = await TemplateVersionService(db_session).republish(
        project_id=project_id,
        project_template_id=clone.project_template_id,
        user_id=user_id,
    )
    assert result.changed is False
    assert await _marker(db_session, clone.project_template_id) is None

    await db_session.rollback()


@pytest.mark.asyncio
async def test_fresh_clone_commits_clean(db_session: AsyncSession) -> None:
    """A brand-new clone's own structure inserts stamp the marker
    mid-transaction; the clone must still END clean — a pristine import
    must not show the Draft chip nor 409 the next re-import."""
    project_id = SEED.secondary_project
    user_id = SEED.primary_profile
    await _clean_project_clones(db_session, project_id)

    clone = await _clone_charms(db_session, project_id, user_id)

    assert clone.created is True
    assert await _marker(db_session, clone.project_template_id) is None
    active = (
        await db_session.execute(
            text(
                "SELECT version FROM public.extraction_template_versions "
                "WHERE project_template_id = :tid AND is_active"
            ),
            {"tid": str(clone.project_template_id)},
        )
    ).scalar_one()
    assert active == 1

    await db_session.rollback()


@pytest.mark.asyncio
async def test_zero_state_heal_commits_clean(db_session: AsyncSession) -> None:
    """Zero-state heal (empty live structure, marker NULL — the legacy
    aborted-clone shape) rebuilds from the global and publishes: marker
    NULL after, and a NEW active version is minted (append-only history —
    the old in-place rewrite is gone)."""
    project_id = SEED.secondary_project
    user_id = SEED.primary_profile
    await _clean_project_clones(db_session, project_id)
    clone = await _clone_charms(db_session, project_id, user_id)

    await db_session.execute(
        text("DELETE FROM public.extraction_entity_types WHERE project_template_id = :tid"),
        {"tid": str(clone.project_template_id)},
    )
    await db_session.flush()
    # The delete itself stamped the marker; reset to NULL to simulate the
    # legacy zero-state shape (aborted clone, nothing ever edited).
    await _set_marker(db_session, clone.project_template_id, None)

    healed = await _clone_charms(db_session, project_id, user_id)

    assert healed.project_template_id == clone.project_template_id
    assert healed.entity_type_count > 0
    assert await _marker(db_session, clone.project_template_id) is None
    active_version = (
        await db_session.execute(
            text(
                "SELECT version FROM public.extraction_template_versions "
                "WHERE project_template_id = :tid AND is_active"
            ),
            {"tid": str(clone.project_template_id)},
        )
    ).scalar_one()
    assert active_version > 1, "heal publishes a NEW version, never rewrites v1"

    await db_session.rollback()


@pytest.mark.asyncio
async def test_lazy_initial_version_keeps_marker_and_warns(
    db_session: AsyncSession,
) -> None:
    """A template with NO version rows (legacy/frontend-created) gets a
    lazy v1 on first run creation. That path must NOT clear the marker
    (an UPDATE under create_run's FOR SHARE is an in-place lock upgrade —
    two concurrent first-runs deadlock) — it logs a warning instead."""
    import structlog
    from structlog.testing import LogCapture

    from app.services.run_lifecycle_service import RunLifecycleService

    project_id = SEED.secondary_project
    user_id = SEED.primary_profile
    await _clean_project_clones(db_session, project_id)

    template_id = uuid4()
    await db_session.execute(
        text(
            "INSERT INTO public.project_extraction_templates "
            "(id, project_id, name, framework, version, kind, schema, is_active, "
            " created_by) "
            "VALUES (:id, :pid, 'b4 lazy v1 probe', 'CUSTOM', '1.0.0', 'extraction', "
            " '{}', true, :uid)"
        ),
        {"id": str(template_id), "pid": str(project_id), "uid": str(user_id)},
    )
    await db_session.execute(
        text(
            "INSERT INTO public.extraction_entity_types "
            "(id, project_template_id, name, label, cardinality, role, sort_order, "
            " is_required) "
            "VALUES (:id, :tid, 'lazy_section', 'Lazy section', 'one', "
            " 'study_section', 0, false)"
        ),
        {"id": str(uuid4()), "tid": str(template_id)},
    )
    await db_session.flush()
    # The raw inserts above stamped the marker via the trigger — keep it:
    # that IS the pending-draft state the lazy publish must not silently
    # clear.
    assert await _marker(db_session, template_id) is not None

    article_id = uuid4()
    await db_session.execute(
        text(
            "INSERT INTO public.articles (id, project_id, title, row_version) "
            "VALUES (:id, :pid, 'lazy v1 article', 1)"
        ),
        {"id": str(article_id), "pid": str(project_id)},
    )
    await db_session.flush()

    capture = LogCapture()
    structlog.configure(processors=[capture])
    try:
        run = await RunLifecycleService(db_session).create_run(
            project_id=project_id,
            article_id=article_id,
            project_template_id=template_id,
            user_id=user_id,
        )
    finally:
        structlog.reset_defaults()

    assert run.version_id is not None
    assert await _marker(db_session, template_id) is not None, (
        "lazy v1 must NOT clear the marker (deadlock-free by design)"
    )
    assert any(
        entry["event"] == "lazy_initial_version_published_pending_draft"
        for entry in capture.entries
    ), "the least-harm publish of a pending draft must be logged"

    await db_session.rollback()
