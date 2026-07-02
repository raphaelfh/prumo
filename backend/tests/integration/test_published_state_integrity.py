"""D5.1 (spec 2026-07-02): the canonical published record must survive
instance deletion.

``extraction_instances`` DELETE arrives PostgREST-direct (no API stage
guard); with the baseline ``ON DELETE CASCADE`` it silently destroyed the
``extraction_published_states`` rows — the canonical published record —
and could leave a FINALIZED run with zero published rows (breaking the
``advance_stage`` >=1-published invariant and constitution §IX
append-only). Migration ``0040_published_state_restrict`` flips the FK to
RESTRICT; this test pins it at the DB level.
"""

from uuid import UUID

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.run_lifecycle_service import RunLifecycleService
from tests.integration.conftest import SEED


async def _fixtures(db: AsyncSession) -> tuple[UUID, UUID, UUID, UUID] | None:
    """Seeded coherent (project, article, template, profile) tuple, or None
    when the autouse seed did not run (mirrors test_run_lifecycle_service)."""
    if (
        await db.execute(
            text("SELECT 1 FROM public.profiles WHERE id = :id"),
            {"id": str(SEED.primary_profile)},
        )
    ).scalar() is None:
        return None
    return (
        SEED.primary_project,
        SEED.primary_article,
        SEED.primary_template,
        SEED.primary_profile,
    )


@pytest.mark.asyncio
async def test_instance_delete_with_published_rows_is_blocked(
    db_session: AsyncSession,
) -> None:
    fx = await _fixtures(db_session)
    if fx is None:
        pytest.skip("Missing fixtures.")
    project_id, article_id, template_id, profile_id = fx

    # Own the run state for this article/template (the suite leaks runs).
    await db_session.execute(
        text(
            "DELETE FROM public.extraction_runs WHERE project_id = :pid "
            "AND article_id = :aid AND template_id = :tid"
        ),
        {"pid": str(project_id), "aid": str(article_id), "tid": str(template_id)},
    )
    svc = RunLifecycleService(db_session)
    run = await svc.create_run(
        project_id=project_id,
        article_id=article_id,
        project_template_id=template_id,
        user_id=profile_id,
    )

    # One published row referencing the seeded instance.
    await db_session.execute(
        text(
            "INSERT INTO public.extraction_published_states "
            "(id, run_id, instance_id, field_id, value, published_at, "
            " published_by, version) "
            "VALUES (gen_random_uuid(), :rid, :iid, :fid, "
            '        \'{"value": "published"}\'::jsonb, now(), :uid, 1)'
        ),
        {
            "rid": str(run.id),
            "iid": str(SEED.primary_instance),
            "fid": str(SEED.primary_field),
            "uid": str(profile_id),
        },
    )
    await db_session.flush()

    # The PostgREST-direct delete path must hit the RESTRICT wall.
    with pytest.raises(IntegrityError):
        await db_session.execute(
            text("DELETE FROM public.extraction_instances WHERE id = :iid"),
            {"iid": str(SEED.primary_instance)},
        )
        await db_session.flush()
    await db_session.rollback()
