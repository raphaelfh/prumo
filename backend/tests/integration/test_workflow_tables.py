"""Integration tests for the 5 HITL workflow tables."""

from uuid import UUID

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.run_lifecycle_service import RunLifecycleService
from tests.integration.conftest import SEED

WORKFLOW_TABLES = [
    "extraction_proposal_records",
    "extraction_reviewer_decisions",
    "extraction_reviewer_states",
    "extraction_consensus_decisions",
    "extraction_published_states",
]


async def _provision_run(db: AsyncSession) -> tuple[UUID, UUID, UUID]:
    """Create a run on the seed project/article/template; return (run_id, instance_id, field_id).

    The seed provides the article + template + entity_type + field +
    instance chain but intentionally leaves ``extraction_runs`` empty, so
    these CHECK-constraint tests must materialise their own run rather than
    probing for a pre-existing one (which made them skip in CI). The run is
    created on the rolled-back ``db_session``, so it never persists.
    """
    run = await RunLifecycleService(db).create_run(
        project_id=SEED.primary_project,
        article_id=SEED.primary_article,
        project_template_id=SEED.primary_template,
        user_id=SEED.primary_profile,
    )
    return run.id, SEED.primary_instance, SEED.primary_field


@pytest.mark.asyncio
@pytest.mark.parametrize("table_name", WORKFLOW_TABLES)
async def test_workflow_table_exists(db_session: AsyncSession, table_name: str) -> None:
    result = await db_session.execute(
        text(f"SELECT to_regclass('public.{table_name}') AS reg"),
    )
    assert result.scalar() is not None


@pytest.mark.asyncio
@pytest.mark.parametrize("table_name", WORKFLOW_TABLES)
async def test_workflow_table_rls_enabled(db_session: AsyncSession, table_name: str) -> None:
    rls = await db_session.execute(
        text(
            f"SELECT relrowsecurity FROM pg_class WHERE oid = 'public.{table_name}'::regclass",
        )
    )
    assert rls.scalar() is True

    policies = await db_session.execute(
        text(f"SELECT count(*) FROM pg_policies WHERE tablename = '{table_name}'"),
    )
    assert policies.scalar() >= 4


@pytest.mark.asyncio
@pytest.mark.parametrize("table_name", WORKFLOW_TABLES)
async def test_workflow_table_updated_at_trigger(
    db_session: AsyncSession,
    table_name: str,
) -> None:
    result = await db_session.execute(
        text(
            f"SELECT count(*) FROM pg_trigger WHERE tgname = 'update_{table_name}_updated_at'",
        )
    )
    assert result.scalar() == 1


@pytest.mark.asyncio
async def test_proposal_record_human_requires_user_check(db_session: AsyncSession) -> None:
    run_id, instance_id, field_id = await _provision_run(db_session)

    with pytest.raises(IntegrityError):
        await db_session.execute(
            text(
                """
                INSERT INTO public.extraction_proposal_records
                    (run_id, instance_id, field_id, source, proposed_value)
                VALUES (:run_id, :instance_id, :field_id, 'human', '{}'::jsonb)
                """
            ),
            {"run_id": run_id, "instance_id": instance_id, "field_id": field_id},
        )
    await db_session.rollback()


@pytest.mark.asyncio
async def test_reviewer_decision_accept_requires_proposal_check(
    db_session: AsyncSession,
) -> None:
    run_id, instance_id, field_id = await _provision_run(db_session)
    reviewer_id = SEED.primary_profile

    with pytest.raises(IntegrityError):
        await db_session.execute(
            text(
                """
                INSERT INTO public.extraction_reviewer_decisions
                    (run_id, instance_id, field_id, reviewer_id, decision)
                VALUES (:run_id, :instance_id, :field_id, :reviewer_id, 'accept_proposal')
                """
            ),
            {
                "run_id": run_id,
                "instance_id": instance_id,
                "field_id": field_id,
                "reviewer_id": reviewer_id,
            },
        )
    await db_session.rollback()


@pytest.mark.asyncio
async def test_reviewer_decision_edit_requires_value_check(
    db_session: AsyncSession,
) -> None:
    run_id, instance_id, field_id = await _provision_run(db_session)
    reviewer_id = SEED.primary_profile

    with pytest.raises(IntegrityError):
        await db_session.execute(
            text(
                """
                INSERT INTO public.extraction_reviewer_decisions
                    (run_id, instance_id, field_id, reviewer_id, decision)
                VALUES (:run_id, :instance_id, :field_id, :reviewer_id, 'edit')
                """
            ),
            {
                "run_id": run_id,
                "instance_id": instance_id,
                "field_id": field_id,
                "reviewer_id": reviewer_id,
            },
        )
    await db_session.rollback()


@pytest.mark.asyncio
async def test_consensus_decision_select_existing_requires_decision_check(
    db_session: AsyncSession,
) -> None:
    run_id, instance_id, field_id = await _provision_run(db_session)
    consensus_user_id = SEED.primary_profile

    with pytest.raises(IntegrityError):
        await db_session.execute(
            text(
                """
                INSERT INTO public.extraction_consensus_decisions
                    (run_id, instance_id, field_id, consensus_user_id, mode)
                VALUES (:run_id, :instance_id, :field_id, :user_id, 'select_existing')
                """
            ),
            {
                "run_id": run_id,
                "instance_id": instance_id,
                "field_id": field_id,
                "user_id": consensus_user_id,
            },
        )
    await db_session.rollback()


@pytest.mark.asyncio
async def test_published_states_unique_per_run_item(db_session: AsyncSession) -> None:
    result = await db_session.execute(
        text(
            """
            SELECT conname FROM pg_constraint
            WHERE conname = 'uq_extraction_published_states_run_item'
            """
        )
    )
    assert result.scalar() == "uq_extraction_published_states_run_item"


@pytest.mark.asyncio
async def test_reviewer_states_unique_per_reviewer_item(db_session: AsyncSession) -> None:
    result = await db_session.execute(
        text(
            """
            SELECT conname FROM pg_constraint
            WHERE conname = 'uq_extraction_reviewer_states_run_reviewer_item'
            """
        )
    )
    assert result.scalar() == "uq_extraction_reviewer_states_run_reviewer_item"
