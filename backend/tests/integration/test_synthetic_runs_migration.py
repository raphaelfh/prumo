"""Integration tests for migration 0015 - synthetic Runs for extracted_values."""

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


@pytest.mark.asyncio
async def test_synthetic_runs_exist_for_each_article_template_pair(
    db_session: AsyncSession,
) -> None:
    # Every (article_id, template_id) pair in extracted_values should have a synthetic Run.
    result = await db_session.execute(
        text(
            """
            WITH legacy AS (
                SELECT DISTINCT ev.article_id, i.template_id
                FROM public.extracted_values ev
                JOIN public.extraction_instances i ON i.id = ev.instance_id
            )
            SELECT COUNT(*) FROM legacy l
            WHERE NOT EXISTS (
                SELECT 1 FROM public.extraction_runs r
                WHERE r.article_id = l.article_id
                  AND r.template_id = l.template_id
                  AND (r.parameters->>'_synthetic') = 'true'
            )
            """
        )
    )
    assert result.scalar() == 0


@pytest.mark.asyncio
async def test_published_states_count_matches_extracted_values(
    db_session: AsyncSession,
) -> None:
    ev_count = (
        await db_session.execute(text("SELECT COUNT(*) FROM public.extracted_values"))
    ).scalar()
    ps_count_in_synthetic = (
        await db_session.execute(
            text(
                """
                SELECT COUNT(*) FROM public.extraction_published_states ps
                JOIN public.extraction_runs r ON r.id = ps.run_id
                WHERE (r.parameters->>'_synthetic') = 'true'
                """
            )
        )
    ).scalar()
    assert ps_count_in_synthetic == ev_count


@pytest.mark.asyncio
async def test_synthetic_runs_are_finalized_and_completed(
    db_session: AsyncSession,
) -> None:
    bad = (
        await db_session.execute(
            text(
                """
                SELECT COUNT(*) FROM public.extraction_runs
                WHERE (parameters->>'_synthetic') = 'true'
                  AND (stage::text <> 'finalized' OR status::text <> 'completed')
                """
            )
        )
    ).scalar()
    assert bad == 0


@pytest.mark.asyncio
async def test_synthetic_run_has_active_version_id(
    db_session: AsyncSession,
) -> None:
    bad = (
        await db_session.execute(
            text(
                """
                SELECT COUNT(*) FROM public.extraction_runs r
                LEFT JOIN public.extraction_template_versions v
                  ON v.id = r.version_id AND v.is_active
                WHERE (r.parameters->>'_synthetic') = 'true' AND v.id IS NULL
                """
            )
        )
    ).scalar()
    assert bad == 0
