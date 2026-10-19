"""ProjectMemberRepository.count_reviewer_capable: the members the RLS
reviewer predicate (`public.is_project_reviewer`) admits, counted through the
ORM. The expected value is computed member by member with the SQL function
itself, so the repository and the policies cannot drift apart."""

from __future__ import annotations

from uuid import UUID

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.repositories.project_repository import ProjectMemberRepository
from tests.integration.conftest import SEED


async def _predicate_count(db: AsyncSession, project_id: UUID) -> int:
    members = (
        await db.execute(
            text("SELECT user_id FROM public.project_members WHERE project_id = :pid"),
            {"pid": str(project_id)},
        )
    ).scalars()
    count = 0
    for user_id in list(members):
        admitted = (
            await db.execute(
                text("SELECT public.is_project_reviewer(:pid, :uid)"),
                {"pid": str(project_id), "uid": str(user_id)},
            )
        ).scalar_one()
        count += bool(admitted)
    return count


async def _add_member(db: AsyncSession, project_id: UUID, user_id: UUID, role: str) -> None:
    await db.execute(
        text(
            "INSERT INTO public.project_members (id, project_id, user_id, role) "
            "VALUES (gen_random_uuid(), :pid, :uid, CAST(:role AS project_member_role)) "
            "ON CONFLICT (project_id, user_id) DO UPDATE SET role = EXCLUDED.role"
        ),
        {"pid": str(project_id), "uid": str(user_id), "role": role},
    )


@pytest.mark.parametrize(
    ("role", "delta"),
    [("viewer", 0), ("consensus", 1), ("manager", 1)],
    ids=["viewer", "consensus", "manager"],
)
async def test_count_reviewer_capable(db_session: AsyncSession, role: str, delta: int) -> None:
    repo = ProjectMemberRepository(db_session)
    before = await repo.count_reviewer_capable(SEED.primary_project)
    # Precondition: the seed's manager and reviewer are both counted.
    assert before == await _predicate_count(db_session, SEED.primary_project) == 2

    await _add_member(db_session, SEED.primary_project, SEED.outsider_profile, role)

    after = await repo.count_reviewer_capable(SEED.primary_project)
    assert after == await _predicate_count(db_session, SEED.primary_project)
    assert after == before + delta


async def test_count_reviewer_capable_is_scoped_to_the_project(db_session: AsyncSession) -> None:
    repo = ProjectMemberRepository(db_session)
    # The reviewer of primary_project is not a member of secondary_project.
    assert await repo.count_reviewer_capable(SEED.secondary_project) == 1
    await _add_member(db_session, SEED.primary_project, SEED.outsider_profile, "reviewer")
    assert await repo.count_reviewer_capable(SEED.secondary_project) == 1
