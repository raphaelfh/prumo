"""Integration tests for `is_project_reviewer` and the relaxed workflow RLS."""

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


@pytest.mark.asyncio
async def test_is_project_reviewer_function_exists(db_session: AsyncSession) -> None:
    result = await db_session.execute(
        text(
            """
            SELECT 1 FROM pg_proc p
            JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public'
              AND p.proname = 'is_project_reviewer'
            """
        )
    )
    assert result.scalar() == 1


@pytest.mark.asyncio
async def test_is_project_reviewer_admits_manager_reviewer_consensus(
    db_session: AsyncSession,
) -> None:
    """The fn should return true for any project_member role that
    legitimately writes workflow rows: manager, reviewer, consensus."""
    project_id = (await db_session.execute(text("SELECT id FROM public.projects LIMIT 1"))).scalar()
    if project_id is None:
        pytest.skip("Need a project")

    member = (
        await db_session.execute(
            text(
                """
                SELECT user_id FROM public.project_members
                WHERE project_id = :pid AND role IN ('manager', 'reviewer', 'consensus')
                LIMIT 1
                """
            ),
            {"pid": str(project_id)},
        )
    ).scalar()
    if member is None:
        pytest.skip("No manager/reviewer/consensus membership in fixture")

    is_reviewer = (
        await db_session.execute(
            text("SELECT public.is_project_reviewer(:pid, :uid)"),
            {"pid": str(project_id), "uid": str(member)},
        )
    ).scalar()
    assert is_reviewer is True


@pytest.mark.asyncio
async def test_is_project_reviewer_rejects_outsider(db_session: AsyncSession) -> None:
    project_id = (await db_session.execute(text("SELECT id FROM public.projects LIMIT 1"))).scalar()
    if project_id is None:
        pytest.skip("Need a project")

    outsider = (
        await db_session.execute(
            text(
                """
                SELECT id FROM public.profiles
                WHERE id NOT IN (
                    SELECT user_id FROM public.project_members WHERE project_id = :pid
                )
                LIMIT 1
                """
            ),
            {"pid": str(project_id)},
        )
    ).scalar()
    if outsider is None:
        pytest.skip("Need a profile that isn't a project_member")

    is_reviewer = (
        await db_session.execute(
            text("SELECT public.is_project_reviewer(:pid, :uid)"),
            {"pid": str(project_id), "uid": str(outsider)},
        )
    ).scalar()
    assert is_reviewer is False


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "table_name",
    [
        "extraction_proposal_records",
        "extraction_reviewer_decisions",
        "extraction_reviewer_states",
        "extraction_consensus_decisions",
        "extraction_published_states",
    ],
)
async def test_workflow_insert_policy_routes_through_is_project_reviewer(
    db_session: AsyncSession,
    table_name: str,
) -> None:
    """Sanity: each workflow table's INSERT policy now references the
    reviewer helper (not is_project_manager) — the rewrite from migration
    0018 has landed."""
    result = await db_session.execute(
        text(
            f"""
            SELECT pg_get_expr(p.polwithcheck, p.polrelid)
            FROM pg_policy p
            JOIN pg_class c ON c.oid = p.polrelid
            WHERE c.relname = '{table_name}'
              AND p.polname = '{table_name}_insert'
            """
        )
    )
    expr = result.scalar()
    assert expr is not None
    assert "is_project_reviewer" in expr
    assert "is_project_manager" not in expr
