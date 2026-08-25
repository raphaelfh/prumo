"""The seed's template GC must survive a template that has been extracted against.

Regression for the wedge observed 2026-08-23: a QA clone left in a sentinel
project by a UI session carried 13 ``extraction_instances``, so the seed's
``DELETE FROM project_extraction_templates`` raised ForeignKeyViolationError.
The seed is session-scoped, so that one failure aborted setup for every test
in the run (~1164 errors), and it survived hand-deleting the rows because the
suite recreated them.

``extraction_runs.template_id`` and ``extraction_instances.template_id`` are
ON DELETE RESTRICT on purpose — ``template_delete_service`` refuses the same
delete in production, and that RESTRICT is the only thing stopping the second,
composite CASCADE FK on ``extraction_runs`` from cascading real work away. So
the fixture clears the guarded rows; the schema stays as it is.
"""

from uuid import UUID, uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from tests.integration.conftest import SEED, purge_templates


async def _seeded(db: AsyncSession) -> bool:
    return (
        await db.execute(
            text("SELECT 1 FROM public.profiles WHERE id = :id"),
            {"id": str(SEED.primary_profile)},
        )
    ).scalar() is not None


async def _clone_in_sentinel_project(db: AsyncSession) -> tuple[UUID, UUID, UUID]:
    """Build the shape that wedged the DB: a non-sentinel template inside a
    sentinel project, carrying one instance and one run. Returns
    (template_id, instance_id, run_id)."""
    template_id, entity_type_id, instance_id, run_id = uuid4(), uuid4(), uuid4(), uuid4()

    # is_active=false: the sentinel project already holds the seed's active
    # extraction template, and uq_one_active_extraction_template_per_project
    # allows only one.
    await db.execute(
        text(
            "INSERT INTO public.project_extraction_templates "
            "(id, project_id, name, description, framework, version, kind, "
            " schema, is_active, created_by) "
            "VALUES (:id, :pid, 'stray-qa-clone', NULL, 'CUSTOM', '1.0', "
            " 'extraction', '{}'::jsonb, false, :uid)"
        ),
        {
            "id": str(template_id),
            "pid": str(SEED.primary_project),
            "uid": str(SEED.primary_profile),
        },
    )
    version_id = (
        await db.execute(
            text(
                "INSERT INTO public.extraction_template_versions "
                "(id, project_template_id, version, schema, published_by, is_active) "
                "VALUES (gen_random_uuid(), :tid, 1, '{\"entity_types\": []}'::jsonb, "
                " :uid, false) RETURNING id"
            ),
            {"tid": str(template_id), "uid": str(SEED.primary_profile)},
        )
    ).scalar_one()
    await db.execute(
        text(
            "INSERT INTO public.extraction_entity_types "
            "(id, project_template_id, name, label, cardinality, role, "
            " parent_entity_type_id, sort_order, is_required) "
            "VALUES (:id, :tid, 'stray_section', 'Stray Section', 'one', "
            " 'study_section', NULL, 0, false)"
        ),
        {"id": str(entity_type_id), "tid": str(template_id)},
    )
    await db.execute(
        text(
            "INSERT INTO public.extraction_instances "
            "(id, project_id, template_id, entity_type_id, article_id, label, created_by) "
            "VALUES (:id, :pid, :tid, :etid, :aid, 'Stray Instance', :uid)"
        ),
        {
            "id": str(instance_id),
            "pid": str(SEED.primary_project),
            "tid": str(template_id),
            "etid": str(entity_type_id),
            "aid": str(SEED.primary_article),
            "uid": str(SEED.primary_profile),
        },
    )
    await db.execute(
        text(
            "INSERT INTO public.extraction_runs "
            "(id, project_id, article_id, template_id, version_id, created_by) "
            "VALUES (:id, :pid, :aid, :tid, :vid, :uid)"
        ),
        {
            "id": str(run_id),
            "pid": str(SEED.primary_project),
            "aid": str(SEED.primary_article),
            "tid": str(template_id),
            "vid": str(version_id),
            "uid": str(SEED.primary_profile),
        },
    )
    await db.flush()
    return template_id, instance_id, run_id


@pytest.mark.asyncio
async def test_bare_template_delete_is_refused_by_the_restrict_fks(
    db_session: AsyncSession,
) -> None:
    """The hazard is real: the plain DELETE the seed used to issue aborts.

    Without this, the purge test below could pass for the wrong reason — a
    template with no children deletes fine either way.
    """
    if not await _seeded(db_session):
        pytest.skip("Missing fixtures.")
    template_id, _, _ = await _clone_in_sentinel_project(db_session)

    with pytest.raises(IntegrityError) as exc:  # noqa: PT012 - savepoint must wrap the raise
        async with db_session.begin_nested():
            await db_session.execute(
                text("DELETE FROM public.project_extraction_templates WHERE id = :tid"),
                {"tid": str(template_id)},
            )
    assert "extraction_runs_template_id_fkey" in str(exc.value) or (
        "extraction_instances_template_id_fkey" in str(exc.value)
    ), str(exc.value)


@pytest.mark.asyncio
async def test_purge_templates_clears_runs_and_instances_first(
    db_session: AsyncSession,
) -> None:
    """The seed's GC removes an extracted-against template and its work."""
    if not await _seeded(db_session):
        pytest.skip("Missing fixtures.")
    template_id, instance_id, run_id = await _clone_in_sentinel_project(db_session)

    await purge_templates(db_session, [template_id])

    for table, row_id in (
        ("project_extraction_templates", template_id),
        ("extraction_instances", instance_id),
        ("extraction_runs", run_id),
    ):
        remaining = (
            await db_session.execute(
                text(f"SELECT count(*) FROM public.{table} WHERE id = :id"),  # noqa: S608
                {"id": str(row_id)},
            )
        ).scalar()
        assert remaining == 0, f"{table} row survived the purge"


@pytest.mark.asyncio
async def test_purge_templates_leaves_the_sentinel_template_alone(
    db_session: AsyncSession,
) -> None:
    """Scoping check: purging a stray must not touch the seed's own template,
    whose instance every other integration test depends on."""
    if not await _seeded(db_session):
        pytest.skip("Missing fixtures.")
    template_id, _, _ = await _clone_in_sentinel_project(db_session)

    await purge_templates(db_session, [template_id])

    survived = (
        await db_session.execute(
            text("SELECT count(*) FROM public.project_extraction_templates WHERE id = :tid"),
            {"tid": str(SEED.primary_template)},
        )
    ).scalar()
    assert survived == 1, "the seed's own template must survive a stray purge"
    instance_survived = (
        await db_session.execute(
            text("SELECT count(*) FROM public.extraction_instances WHERE id = :iid"),
            {"iid": str(SEED.primary_instance)},
        )
    ).scalar()
    assert instance_survived == 1, "the seed's sentinel instance must survive"


@pytest.mark.asyncio
async def test_purge_templates_is_a_noop_for_an_empty_id_list(
    db_session: AsyncSession,
) -> None:
    """``_OBSOLETE_SENTINEL_TEMPLATE_IDS`` empties out over time; an empty
    purge must not become ``DELETE ... WHERE id = ANY('{}')`` against every
    row or blow up on the cast."""
    if not await _seeded(db_session):
        pytest.skip("Missing fixtures.")

    await purge_templates(db_session, [])

    survived = (
        await db_session.execute(
            text("SELECT count(*) FROM public.project_extraction_templates WHERE id = :tid"),
            {"tid": str(SEED.primary_template)},
        )
    ).scalar()
    assert survived == 1
