"""Integration tests for ExtractionHitlConfig."""

from uuid import uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction_versioning import (
    ConsensusRule,
    ExtractionHitlConfig,
    HitlConfigScopeKind,
)
from tests.integration.conftest import SEED, clone_charms


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
        text("SELECT id FROM public.projects WHERE id = :pid"),
        {"pid": str(SEED.primary_project)},
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


@pytest.mark.asyncio
async def test_hitl_config_arbitrator_required_when_rule_is_arbitrator(
    db_session: AsyncSession,
) -> None:
    project_row = await db_session.execute(
        text("SELECT id FROM public.projects WHERE id = :pid"),
        {"pid": str(SEED.primary_project)},
    )
    project_id = project_row.scalar()
    if project_id is None:
        pytest.skip("No projects rows.")

    bad = ExtractionHitlConfig(
        scope_kind=HitlConfigScopeKind.PROJECT.value,
        scope_id=project_id,
        reviewer_count=1,
        consensus_rule=ConsensusRule.ARBITRATOR.value,
        arbitrator_id=None,
    )
    db_session.add(bad)
    with pytest.raises(IntegrityError):
        await db_session.flush()
    await db_session.rollback()


@pytest.mark.asyncio
async def test_project_delete_leaves_no_hitl_configs(db_session: AsyncSession) -> None:
    project_id = uuid4()
    await db_session.execute(
        text(
            "INSERT INTO public.projects (id, name, created_by_id, is_active) "
            "VALUES (:id, 'HITL cascade probe', :by, true)"
        ),
        {"id": str(project_id), "by": str(SEED.primary_profile)},
    )
    template = await clone_charms(db_session, project_id, SEED.primary_profile)
    template_id = template.project_template_id
    db_session.add_all(
        [
            ExtractionHitlConfig(
                scope_kind=HitlConfigScopeKind.PROJECT.value,
                scope_id=project_id,
                reviewer_count=2,
                consensus_rule=ConsensusRule.MAJORITY.value,
            ),
            ExtractionHitlConfig(
                scope_kind=HitlConfigScopeKind.TEMPLATE.value,
                scope_id=template_id,
                reviewer_count=1,
                consensus_rule=ConsensusRule.UNANIMOUS.value,
            ),
        ]
    )
    await db_session.flush()
    count_sql = text(
        "SELECT COUNT(*) FROM public.extraction_hitl_configs WHERE scope_id IN (:pid, :tid)"
    )
    ids = {"pid": str(project_id), "tid": str(template_id)}
    assert (await db_session.execute(count_sql, ids)).scalar_one() == 2

    await db_session.execute(
        text("DELETE FROM public.projects WHERE id = :pid"), {"pid": str(project_id)}
    )

    assert (await db_session.execute(count_sql, ids)).scalar_one() == 0
