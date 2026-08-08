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
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction import (
    ExtractionEntityType,
    ExtractionField,
    ExtractionTemplateGlobal,
)
from tests.integration.conftest import (
    SEED,
    clean_project_clones,
    clone_charms,
    first_entity_type_id,
    get_config_draft_marker,
    set_config_draft_marker,
)

# A sentinel far in the past: within one test transaction now() is
# constant, so "a later edit keeps the first timestamp" is only
# falsifiable against a PRE-SET value, never against two in-txn stamps.
_SENTINEL = datetime(2020, 1, 1, tzinfo=UTC)


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
    await set_config_draft_marker(db_session, SEED.primary_template, None)

    field = _probe_field("b4_marker_probe")
    db_session.add(field)
    await db_session.flush()
    assert await get_config_draft_marker(db_session, SEED.primary_template) is not None

    await set_config_draft_marker(db_session, SEED.primary_template, None)
    field.label = "probe renamed"
    await db_session.flush()
    assert await get_config_draft_marker(db_session, SEED.primary_template) is not None

    await set_config_draft_marker(db_session, SEED.primary_template, None)
    await db_session.delete(field)
    await db_session.flush()
    assert await get_config_draft_marker(db_session, SEED.primary_template) is not None


@pytest.mark.asyncio
async def test_entity_type_write_marks_draft(db_session: AsyncSession) -> None:
    await set_config_draft_marker(db_session, SEED.primary_template, None)
    et = await db_session.get(ExtractionEntityType, SEED.primary_entity_type)
    assert et is not None
    et.label = f"{et.label} (b4)"
    await db_session.flush()
    assert await get_config_draft_marker(db_session, SEED.primary_template) is not None


@pytest.mark.asyncio
async def test_marker_keeps_first_edit_timestamp(db_session: AsyncSession) -> None:
    """COALESCE semantics: a later edit never moves an existing stamp."""
    await set_config_draft_marker(db_session, SEED.primary_template, _SENTINEL)
    et = await db_session.get(ExtractionEntityType, SEED.primary_entity_type)
    assert et is not None
    et.label = f"{et.label} (later edit)"
    await db_session.flush()
    assert await get_config_draft_marker(db_session, SEED.primary_template) == _SENTINEL


@pytest.mark.asyncio
async def test_global_lineage_writes_never_stamp(db_session: AsyncSession) -> None:
    """The seed writes these SAME tables in global lineage (template_id
    set, project_template_id NULL) — the trigger's v_old/v_new IS NULL
    skips are what keep seeding a no-op. Pin it so the guard is never
    "simplified" away."""
    await set_config_draft_marker(db_session, SEED.primary_template, None)

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

    assert await get_config_draft_marker(db_session, SEED.primary_template) is None


# ---------------------------------------------------------------------------
# Publish paths clear the marker (Task 2): every path that publishes live
# structure routes through TemplateVersionService.republish, whose locked
# section clears the stamp. The lazy v1 self-heal on run creation is the
# DELIBERATE exception (clearing under create_run's FOR SHARE would be an
# in-place lock upgrade — two concurrent first-runs deadlock).
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_republish_clears_marker_after_change(db_session: AsyncSession) -> None:
    from app.services.template_version_service import TemplateVersionService

    project_id = SEED.secondary_project
    user_id = SEED.primary_profile
    await clean_project_clones(db_session, project_id)
    clone = await clone_charms(db_session, project_id, user_id)

    et = await db_session.get(
        ExtractionEntityType, await first_entity_type_id(db_session, clone.project_template_id)
    )
    assert et is not None
    et.label = f"{et.label} (draft edit)"
    await db_session.flush()
    assert await get_config_draft_marker(db_session, clone.project_template_id) is not None

    result = await TemplateVersionService(db_session).republish(
        project_id=project_id,
        project_template_id=clone.project_template_id,
        user_id=user_id,
    )
    assert result.changed is True
    assert await get_config_draft_marker(db_session, clone.project_template_id) is None

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
    await clean_project_clones(db_session, project_id)
    clone = await clone_charms(db_session, project_id, user_id)

    await set_config_draft_marker(db_session, clone.project_template_id, _SENTINEL)
    result = await TemplateVersionService(db_session).republish(
        project_id=project_id,
        project_template_id=clone.project_template_id,
        user_id=user_id,
    )
    assert result.changed is False
    assert await get_config_draft_marker(db_session, clone.project_template_id) is None

    await db_session.rollback()


@pytest.mark.asyncio
async def test_fresh_clone_commits_clean(db_session: AsyncSession) -> None:
    """A brand-new clone's own structure inserts stamp the marker
    mid-transaction; the clone must still END clean — a pristine import
    must not show the Draft chip nor 409 the next re-import."""
    project_id = SEED.secondary_project
    user_id = SEED.primary_profile
    await clean_project_clones(db_session, project_id)

    clone = await clone_charms(db_session, project_id, user_id)

    assert clone.created is True
    assert await get_config_draft_marker(db_session, clone.project_template_id) is None
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
    await clean_project_clones(db_session, project_id)
    clone = await clone_charms(db_session, project_id, user_id)

    await db_session.execute(
        text("DELETE FROM public.extraction_entity_types WHERE project_template_id = :tid"),
        {"tid": str(clone.project_template_id)},
    )
    await db_session.flush()
    # The delete itself stamped the marker; reset to NULL to simulate the
    # legacy zero-state shape (aborted clone, nothing ever edited).
    await set_config_draft_marker(db_session, clone.project_template_id, None)

    healed = await clone_charms(db_session, project_id, user_id)

    assert healed.project_template_id == clone.project_template_id
    assert healed.entity_type_count > 0
    assert await get_config_draft_marker(db_session, clone.project_template_id) is None
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
    from structlog.testing import capture_logs

    from app.services.run_lifecycle_service import RunLifecycleService

    project_id = SEED.secondary_project
    user_id = SEED.primary_profile
    await clean_project_clones(db_session, project_id)

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
    assert await get_config_draft_marker(db_session, template_id) is not None

    article_id = uuid4()
    await db_session.execute(
        text(
            "INSERT INTO public.articles (id, project_id, title, row_version) "
            "VALUES (:id, :pid, 'lazy v1 article', 1)"
        ),
        {"id": str(article_id), "pid": str(project_id)},
    )
    await db_session.flush()

    with capture_logs() as entries:
        run = await RunLifecycleService(db_session).create_run(
            project_id=project_id,
            article_id=article_id,
            project_template_id=template_id,
            user_id=user_id,
        )

    assert run.version_id is not None
    assert await get_config_draft_marker(db_session, template_id) is not None, (
        "lazy v1 must NOT clear the marker (deadlock-free by design)"
    )
    assert any(
        entry["event"] == "lazy_initial_version_published_pending_draft" for entry in entries
    ), "the least-harm publish of a pending draft must be logged"

    await db_session.rollback()


@pytest.mark.asyncio
async def test_qa_session_open_survives_pending_draft(db_session: AsyncSession) -> None:
    """Session-open must NEVER be gated on the draft marker (B-4 global
    constraint): a QA open via global_template_id resolves the existing
    clone AS-IS — no heal, no publish, no 409/500 — and the pending
    draft survives untouched."""
    from app.models.extraction import TemplateKind
    from app.schemas.hitl_session import TemplateKind as SchemaTemplateKind
    from app.services.hitl_session_service import HITLSessionService
    from app.services.template_clone_service import TemplateCloneService

    qa_global = (
        await db_session.execute(
            text(
                "SELECT id FROM public.extraction_templates_global "
                "WHERE kind='quality_assessment' LIMIT 1"
            )
        )
    ).scalar()
    if qa_global is None:
        pytest.skip("No global QA template seeded")
    qa_global_id = UUID(str(qa_global))

    clone = await TemplateCloneService(db_session).clone(
        project_id=SEED.primary_project,
        global_template_id=qa_global_id,
        user_id=SEED.primary_profile,
        kind=TemplateKind.QUALITY_ASSESSMENT,
    )
    active_before = (
        await db_session.execute(
            text(
                "SELECT id FROM public.extraction_template_versions "
                "WHERE project_template_id = :tid AND is_active"
            ),
            {"tid": str(clone.project_template_id)},
        )
    ).scalar_one()

    # Structural draft: a new field (count drift) — the trigger stamps.
    et_id = await first_entity_type_id(db_session, clone.project_template_id)
    await db_session.execute(
        text(
            "INSERT INTO public.extraction_fields "
            "(id, entity_type_id, name, label, field_type, is_required, sort_order) "
            "VALUES (:id, :et, 'qa_draft_field', 'QA draft field', 'text', false, 999)"
        ),
        {"id": str(uuid4()), "et": str(et_id)},
    )
    await db_session.flush()
    assert await get_config_draft_marker(db_session, clone.project_template_id) is not None

    session = await HITLSessionService(db_session).open_or_resume(
        project_id=SEED.primary_project,
        article_id=SEED.primary_article,
        kind=SchemaTemplateKind.QUALITY_ASSESSMENT,
        user_id=SEED.primary_profile,
        global_template_id=qa_global_id,
    )

    assert session.project_template_id == clone.project_template_id, (
        "session-open must resolve the EXISTING clone, not fork or fail"
    )
    assert await get_config_draft_marker(db_session, clone.project_template_id) is not None, (
        "the pending draft must survive session-open (no silent publish)"
    )
    active_after = (
        await db_session.execute(
            text(
                "SELECT id FROM public.extraction_template_versions "
                "WHERE project_template_id = :tid AND is_active"
            ),
            {"tid": str(clone.project_template_id)},
        )
    ).scalar_one()
    assert str(active_after) == str(active_before), "no publish may happen on session-open"

    await db_session.rollback()


@pytest.mark.asyncio
async def test_cross_template_repoint_stamps_both(db_session: AsyncSession) -> None:
    """An UPDATE that re-points a section to another template must stamp
    BOTH templates (the source lost structure and must not fall into the
    silent-self-heal shape). Guards the trigger's v_old/v_new split."""
    project_id = SEED.secondary_project
    user_id = SEED.primary_profile
    await clean_project_clones(db_session, project_id)
    source = await clone_charms(db_session, project_id, user_id)

    target_id = uuid4()
    await db_session.execute(
        text(
            "INSERT INTO public.project_extraction_templates "
            "(id, project_id, name, framework, version, kind, schema, is_active, "
            " created_by) "
            "VALUES (:id, :pid, 'repoint target', 'CUSTOM', '1.0.0', 'extraction', "
            " '{}', false, :uid)"
        ),
        {"id": str(target_id), "pid": str(project_id), "uid": str(user_id)},
    )
    await db_session.flush()
    await set_config_draft_marker(db_session, source.project_template_id, None)
    await set_config_draft_marker(db_session, target_id, None)

    et_id = await first_entity_type_id(db_session, source.project_template_id)
    await db_session.execute(
        text(
            "UPDATE public.extraction_entity_types SET project_template_id = :target WHERE id = :et"
        ),
        {"target": str(target_id), "et": str(et_id)},
    )
    await db_session.flush()

    assert await get_config_draft_marker(db_session, source.project_template_id) is not None, (
        "the SOURCE template lost structure — it must be stamped"
    )
    assert await get_config_draft_marker(db_session, target_id) is not None, (
        "the TARGET template gained structure — it must be stamped"
    )

    await db_session.rollback()
