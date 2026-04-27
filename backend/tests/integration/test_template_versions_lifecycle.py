"""Integration tests for ExtractionTemplateVersion against a real DB."""

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction_versioning import ExtractionTemplateVersion


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
    row = await db_session.execute(
        text(
            "SELECT id FROM public.project_extraction_templates LIMIT 1",
        )
    )
    template_id = row.scalar()
    if template_id is None:
        pytest.skip("No project_extraction_templates rows; backfill skipped this test.")

    profile_row = await db_session.execute(
        text("SELECT id FROM public.profiles LIMIT 1"),
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
    row = await db_session.execute(
        text(
            "SELECT id FROM public.project_extraction_templates LIMIT 1",
        )
    )
    template_id = row.scalar()
    if template_id is None:
        pytest.skip("No project_extraction_templates rows.")

    profile_row = await db_session.execute(
        text("SELECT id FROM public.profiles LIMIT 1"),
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
async def test_template_version_backfill_created_v1_for_each_existing_template(
    db_session: AsyncSession,
) -> None:
    template_count_row = await db_session.execute(
        text("SELECT COUNT(*) FROM public.project_extraction_templates"),
    )
    template_count = template_count_row.scalar()
    if template_count == 0:
        pytest.skip("No project_extraction_templates rows; backfill is vacuously satisfied.")

    # Every existing project_extraction_template must have a v=1 row.
    result = await db_session.execute(
        text(
            """
            SELECT t.id
            FROM public.project_extraction_templates t
            LEFT JOIN public.extraction_template_versions v
              ON v.project_template_id = t.id AND v.version = 1
            WHERE v.id IS NULL
            """
        )
    )
    missing = result.fetchall()
    assert missing == [], f"Templates missing v=1: {missing}"

    # And the count of distinct templates with v=1 must equal the template count.
    distinct_row = await db_session.execute(
        text(
            "SELECT COUNT(DISTINCT project_template_id) FROM public.extraction_template_versions WHERE version = 1",
        )
    )
    assert distinct_row.scalar() == template_count
