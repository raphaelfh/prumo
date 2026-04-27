"""Integration tests for the 5 HITL workflow tables."""

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

WORKFLOW_TABLES = [
    "extraction_proposal_records",
    "extraction_reviewer_decisions",
    "extraction_reviewer_states",
    "extraction_consensus_decisions",
    "extraction_published_states",
]


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
    run_id = (await db_session.execute(text("SELECT id FROM public.extraction_runs LIMIT 1"))).scalar()
    if run_id is None:
        pytest.skip("No extraction_runs rows.")
    instance_id = (
        await db_session.execute(text("SELECT id FROM public.extraction_instances LIMIT 1"))
    ).scalar()
    if instance_id is None:
        pytest.skip("No extraction_instances rows.")
    field_id = (await db_session.execute(text("SELECT id FROM public.extraction_fields LIMIT 1"))).scalar()
    if field_id is None:
        pytest.skip("No extraction_fields rows.")

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
    run_id = (await db_session.execute(text("SELECT id FROM public.extraction_runs LIMIT 1"))).scalar()
    if run_id is None:
        pytest.skip("No extraction_runs rows.")
    instance_id = (
        await db_session.execute(text("SELECT id FROM public.extraction_instances LIMIT 1"))
    ).scalar()
    if instance_id is None:
        pytest.skip("No extraction_instances rows.")
    field_id = (await db_session.execute(text("SELECT id FROM public.extraction_fields LIMIT 1"))).scalar()
    if field_id is None:
        pytest.skip("No extraction_fields rows.")
    reviewer_id = (await db_session.execute(text("SELECT id FROM public.profiles LIMIT 1"))).scalar()
    if reviewer_id is None:
        pytest.skip("No profiles rows.")

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
    run_id = (await db_session.execute(text("SELECT id FROM public.extraction_runs LIMIT 1"))).scalar()
    if run_id is None:
        pytest.skip("No extraction_runs rows.")
    instance_id = (
        await db_session.execute(text("SELECT id FROM public.extraction_instances LIMIT 1"))
    ).scalar()
    if instance_id is None:
        pytest.skip("No extraction_instances rows.")
    field_id = (await db_session.execute(text("SELECT id FROM public.extraction_fields LIMIT 1"))).scalar()
    if field_id is None:
        pytest.skip("No extraction_fields rows.")
    reviewer_id = (await db_session.execute(text("SELECT id FROM public.profiles LIMIT 1"))).scalar()
    if reviewer_id is None:
        pytest.skip("No profiles rows.")

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
    run_id = (await db_session.execute(text("SELECT id FROM public.extraction_runs LIMIT 1"))).scalar()
    if run_id is None:
        pytest.skip("No extraction_runs rows.")
    instance_id = (
        await db_session.execute(text("SELECT id FROM public.extraction_instances LIMIT 1"))
    ).scalar()
    if instance_id is None:
        pytest.skip("No extraction_instances rows.")
    field_id = (await db_session.execute(text("SELECT id FROM public.extraction_fields LIMIT 1"))).scalar()
    if field_id is None:
        pytest.skip("No extraction_fields rows.")
    consensus_user_id = (
        await db_session.execute(text("SELECT id FROM public.profiles LIMIT 1"))
    ).scalar()
    if consensus_user_id is None:
        pytest.skip("No profiles rows.")

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
