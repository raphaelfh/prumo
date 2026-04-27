"""Integration tests for ExtractionHitlConfig."""

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction_versioning import (
    ConsensusRule,
    ExtractionHitlConfig,
    HitlConfigScopeKind,
)


@pytest.mark.asyncio
async def test_hitl_configs_table_exists(db_session: AsyncSession) -> None:
    result = await db_session.execute(
        text("SELECT to_regclass('public.extraction_hitl_configs') AS reg"),
    )
    assert result.scalar() is not None


@pytest.mark.asyncio
async def test_hitl_config_insert_project_scope_and_unique_per_scope(
    db_session: AsyncSession,
) -> None:
    project_row = await db_session.execute(
        text("SELECT id FROM public.projects LIMIT 1"),
    )
    project_id = project_row.scalar()
    if project_id is None:
        pytest.skip("No projects rows.")

    a = ExtractionHitlConfig(
        scope_kind=HitlConfigScopeKind.PROJECT.value,
        scope_id=project_id,
        reviewer_count=2,
        consensus_rule=ConsensusRule.MAJORITY.value,
    )
    db_session.add(a)
    await db_session.flush()

    b = ExtractionHitlConfig(
        scope_kind=HitlConfigScopeKind.PROJECT.value,
        scope_id=project_id,
        reviewer_count=3,
        consensus_rule=ConsensusRule.UNANIMOUS.value,
    )
    db_session.add(b)
    with pytest.raises(IntegrityError):
        await db_session.flush()
    await db_session.rollback()
