"""Integration tests for ExtractionTemplateVersion against a real DB."""

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction_versioning import ExtractionTemplateVersion
from tests.integration.conftest import CHARMS_GLOBAL_ID, SEED, clean_project_clones


@pytest.mark.asyncio
async def test_template_version_table_exists(db_session: AsyncSession) -> None:
    result = await db_session.execute(
        text(
            "SELECT to_regclass('public.extraction_template_versions') AS reg",
        )
    )
    assert result.scalar() is not None


@pytest.mark.asyncio
async def test_template_version_unique_template_version_constraint(
    db_session: AsyncSession,
) -> None:
    # Pick a real existing project_template_id from backfill (v1 was seeded for each)
    project_id = (
        await db_session.execute(
            text("SELECT id FROM public.projects WHERE id = :pid"),
            {"pid": str(SEED.primary_project)},
        )
    ).scalar()
    row = await db_session.execute(
        text(
            "SELECT id FROM public.project_extraction_templates WHERE project_id = :pid LIMIT 1",
        ),
        {"pid": project_id},
    )
    template_id = row.scalar()
    if template_id is None:
        pytest.skip("No project_extraction_templates rows; backfill skipped this test.")

    profile_row = await db_session.execute(
        text(
            "SELECT user_id FROM public.project_members "
            "WHERE project_id = :pid AND role = 'manager' LIMIT 1"
        ),
        {"pid": str(SEED.primary_project)},
    )
    profile_id = profile_row.scalar()
    assert profile_id is not None

    duplicate = ExtractionTemplateVersion(
        project_template_id=template_id,
        version=1,
        schema_={},
        published_by=profile_id,
    )
    db_session.add(duplicate)
    with pytest.raises(IntegrityError):
        await db_session.flush()
    await db_session.rollback()


@pytest.mark.asyncio
async def test_template_version_only_one_active_per_template(
    db_session: AsyncSession,
) -> None:
    project_id = (
        await db_session.execute(
            text("SELECT id FROM public.projects WHERE id = :pid"),
            {"pid": str(SEED.primary_project)},
        )
    ).scalar()
    row = await db_session.execute(
        text(
            "SELECT id FROM public.project_extraction_templates WHERE project_id = :pid LIMIT 1",
        ),
        {"pid": project_id},
    )
    template_id = row.scalar()
    if template_id is None:
        pytest.skip("No project_extraction_templates rows.")

    profile_row = await db_session.execute(
        text(
            "SELECT user_id FROM public.project_members "
            "WHERE project_id = :pid AND role = 'manager' LIMIT 1"
        ),
        {"pid": str(SEED.primary_project)},
    )
    profile_id = profile_row.scalar()
    assert profile_id is not None

    # Insert a second active version → must fail unique partial index
    second_active = ExtractionTemplateVersion(
        project_template_id=template_id,
        version=2,
        schema_={"changed": True},
        published_by=profile_id,
        is_active=True,
    )
    db_session.add(second_active)
    with pytest.raises(IntegrityError):
        await db_session.flush()
    await db_session.rollback()


@pytest.mark.asyncio
async def test_create_run_never_publishes_a_pending_draft(
    db_session: AsyncSession,
) -> None:
    """Opening a run must not publish template config.

    ``create_run`` used to lazily snapshot a v=1 version when a template
    had none, building it from LIVE rows — so a reviewer merely opening a
    run published the manager's staged instruction under their own
    identity (it only logged a warning). Migration 0004 makes that
    "no active version" state unrepresentable in committed data, so the
    lazy publisher was dead code carrying a live hazard; it is gone and
    the version is now simply resolved.

    This pins the property that replaced it: run creation is a pure
    reader of template config.
    """
    from app.models.extraction import TemplateKind
    from app.services.run_lifecycle_service import RunLifecycleService
    from app.services.template_clone_service import TemplateCloneService
    from app.services.template_instruction_service import set_template_instruction

    project_id = SEED.primary_project
    user_id = SEED.primary_profile
    await clean_project_clones(db_session, project_id)
    clone = await TemplateCloneService(db_session).clone(
        project_id=project_id,
        global_template_id=CHARMS_GLOBAL_ID,
        user_id=user_id,
        kind=TemplateKind.EXTRACTION,
    )

    draft = "STAGED — opening a run must not publish this"
    await set_template_instruction(
        db_session,
        project_id=project_id,
        template_id=clone.project_template_id,
        llm_template_instruction=draft,
    )
    await db_session.flush()

    run = await RunLifecycleService(db_session).create_run(
        project_id=project_id,
        article_id=SEED.primary_article,
        project_template_id=clone.project_template_id,
        user_id=user_id,
    )

    assert run.version_id == clone.version_id, "the run must pin the version that already existed"
    versions, active_schema = (
        await db_session.execute(
            text(
                "SELECT (SELECT count(*) FROM public.extraction_template_versions "
                "        WHERE project_template_id = :tid), "
                "       (SELECT schema::text FROM public.extraction_template_versions "
                "        WHERE project_template_id = :tid AND is_active)"
            ),
            {"tid": str(clone.project_template_id)},
        )
    ).one()
    assert versions == 1, "run creation must not spawn a version"
    assert draft not in active_schema, "the staged instruction must not reach the snapshot"

    marker = (
        await db_session.execute(
            text(
                "SELECT config_draft_since FROM public.project_extraction_templates WHERE id = :tid"
            ),
            {"tid": str(clone.project_template_id)},
        )
    ).scalar_one()
    assert marker is not None, "the Draft chip must survive a reviewer opening a run"

    await db_session.rollback()
