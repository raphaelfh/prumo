"""The run view's entity_types tree must come from the run's frozen version
snapshot, and fall back to a live read when the snapshot is a pre-0026 narrow
one (first entity_type missing 'role')."""

from __future__ import annotations

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.schemas.extraction_run import RunSummaryResponse
from app.services.extraction_run_read_service import _entity_types_for_run
from app.services.run_lifecycle_service import RunLifecycleService
from tests.integration.conftest import SEED


async def _new_run(db: AsyncSession):
    project_id = (
        await db.execute(
            text("SELECT id FROM public.projects WHERE id = :pid"),
            {"pid": str(SEED.primary_project)},
        )
    ).scalar()
    if project_id is None:
        return None
    article_id = (
        await db.execute(
            text("SELECT id FROM public.articles WHERE project_id = :pid LIMIT 1"),
            {"pid": str(project_id)},
        )
    ).scalar()
    template_id = (
        await db.execute(
            text(
                "SELECT id FROM public.project_extraction_templates "
                "WHERE project_id = :pid AND kind = 'extraction' LIMIT 1"
            ),
            {"pid": str(project_id)},
        )
    ).scalar()
    user_id = (
        await db.execute(
            text(
                "SELECT user_id FROM public.project_members "
                "WHERE project_id = :pid AND role = 'manager' LIMIT 1"
            ),
            {"pid": str(project_id)},
        )
    ).scalar()
    if not all((article_id, template_id, user_id)):
        return None
    run = await RunLifecycleService(db).create_run(
        project_id=project_id,
        article_id=article_id,
        project_template_id=template_id,
        user_id=user_id,
    )
    return run


@pytest.mark.asyncio
async def test_entity_types_from_widened_snapshot(db_session: AsyncSession) -> None:
    run = await _new_run(db_session)
    if run is None:
        pytest.skip("Seed graph incomplete")

    entity_types = await _entity_types_for_run(db_session, RunSummaryResponse.model_validate(run))
    assert entity_types, "expected a non-empty entity_types tree"
    # Was a role assertion. `role` left the wire in trees B5; the widened
    # snapshot's structural payload is cardinality plus the parent edge,
    # which is what the run form actually partitions on.
    cardinalities = {et.cardinality for et in entity_types}
    assert cardinalities, "every entity type must carry a cardinality from the snapshot"
    assert cardinalities <= {"one", "many"}
    assert any(et.parent_entity_type_id is None for et in entity_types), "a root is expected"


@pytest.mark.asyncio
async def test_entity_types_live_fallback_for_narrow_snapshot(
    db_session: AsyncSession,
) -> None:
    run = await _new_run(db_session)
    if run is None:
        pytest.skip("Seed graph incomplete")

    # Capture identity before expiry so attribute access doesn't fire a sync load.
    run_id = run.id
    version_id = run.version_id
    run_type = type(run)

    # Force the snapshot back to a pre-0026 narrow shape (strip 'role').
    await db_session.execute(
        text(
            """
            UPDATE public.extraction_template_versions
            SET schema = jsonb_set(
                schema, '{entity_types}',
                (
                    SELECT COALESCE(jsonb_agg(elem - 'role'), '[]'::jsonb)
                    FROM jsonb_array_elements(schema -> 'entity_types') elem
                )
            )
            WHERE id = :vid
            """
        ),
        {"vid": str(version_id)},
    )
    db_session.expire_all()

    refetched = await db_session.get(run_type, run_id)
    entity_types = await _entity_types_for_run(
        db_session, RunSummaryResponse.model_validate(refetched)
    )
    assert entity_types, "live fallback must yield the entity_types tree"
    assert all(et.cardinality in ("one", "many") for et in entity_types), (
        "fallback reads structure from the live table"
    )
