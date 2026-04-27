"""Integration tests for the extraction_run_stage enum migration."""

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


@pytest.mark.asyncio
async def test_run_stage_enum_has_new_values(db_session: AsyncSession) -> None:
    result = await db_session.execute(
        text(
            """
            SELECT array_agg(enumlabel ORDER BY enumsortorder)
            FROM pg_enum
            WHERE enumtypid = 'extraction_run_stage'::regtype
            """
        )
    )
    labels = result.scalar()
    assert labels == ["pending", "proposal", "review", "consensus", "finalized", "cancelled"]


@pytest.mark.asyncio
async def test_existing_runs_remapped_to_new_stage_values(db_session: AsyncSession) -> None:
    result = await db_session.execute(
        text(
            """
            SELECT COUNT(*) FROM public.extraction_runs
            WHERE stage::text NOT IN ('pending', 'proposal', 'review', 'consensus', 'finalized', 'cancelled')
            """
        )
    )
    assert result.scalar() == 0


@pytest.mark.asyncio
async def test_no_legacy_data_suggest_or_parsing_or_validation_remains(
    db_session: AsyncSession,
) -> None:
    result = await db_session.execute(
        text(
            """
            SELECT COUNT(*) FROM public.extraction_runs
            WHERE stage::text IN ('data_suggest', 'parsing', 'validation')
            """
        )
    )
    assert result.scalar() == 0
