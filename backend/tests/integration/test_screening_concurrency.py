"""Screening decisions racing each other and the config, with real commits.

Every session here commits for real; ``throwaway_project`` deletes the project
(and, by cascade, its screening rows) and ``_members`` deletes the users it made.
"""

from __future__ import annotations

import asyncio
import contextlib
from collections.abc import AsyncIterator
from uuid import UUID

from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.models.project import Project
from app.models.screening import ScreeningArbitration, ScreeningDecision
from app.schemas.screening import ScreeningArbitrationCreate, ScreeningDecisionCreate
from app.services.screening_config_service import ScreeningConfigService, reviewer_count_of
from app.services.screening_errors import ScreeningStateError
from app.services.screening_outcome import Outcome
from app.services.screening_review_service import ScreeningReviewService, assignment_states
from tests.integration.conftest import SEED
from tests.integration.helpers.screening_fixtures import (
    add_decision,
    add_member,
    enroll_articles,
    make_screening_article,
    set_reviewer_count,
)
from tests.integration.helpers.shared_fixtures import throwaway_project

Factory = async_sessionmaker[AsyncSession]
MANAGER = SEED.primary_profile
INCLUDE = ScreeningDecisionCreate(decision="include")


@contextlib.asynccontextmanager
async def _screening(
    factory: Factory, *, reviewers: int
) -> AsyncIterator[tuple[UUID, list[UUID], UUID]]:
    """A committed project with rc 2, ``reviewers`` reviewers and one enrolled article.

    Yields (project, reviewer ids, assignment id); the users are deleted after the project.
    """
    users: list[UUID] = []
    try:
        async with throwaway_project(factory) as project_id:
            async with factory() as s:
                users.extend(
                    [await add_member(s, project_id, "reviewer") for _ in range(reviewers)]
                )
                article = await make_screening_article(s, project_id)
                (assignment,) = await enroll_articles(s, project_id, [article], by=MANAGER)
                await set_reviewer_count(s, project_id, 2)
                await s.commit()
            yield project_id, users, assignment
    finally:
        async with factory() as s:
            for table in ("public.profiles", "auth.users"):
                await s.execute(
                    text(f"DELETE FROM {table} WHERE id = ANY(:ids)"),  # noqa: S608 - fixed names
                    {"ids": users},
                )
            await s.commit()


async def _decide(factory: Factory, assignment: UUID, reviewer: UUID) -> None:
    async with factory() as s:
        await ScreeningReviewService(s).decide(assignment, reviewer, INCLUDE)
        await s.commit()


async def _decision_rows(factory: Factory, assignment: UUID) -> int:
    async with factory() as s:
        stmt = (
            select(func.count())
            .select_from(ScreeningDecision)
            .where(ScreeningDecision.assignment_id == assignment)
        )
        return int((await s.execute(stmt)).scalar_one())


async def test_two_reviewers_deciding_at_once_reach_consensus(session_factory: Factory) -> None:
    async with _screening(session_factory, reviewers=2) as (project_id, (a, b), assignment):
        await asyncio.gather(
            _decide(session_factory, assignment, a), _decide(session_factory, assignment, b)
        )

        async with session_factory() as s:
            states = await assignment_states(
                s, project_id=project_id, reviewer_count=2, assignment_ids=[assignment]
            )
        assert states[assignment].state.outcome == Outcome("consensus", "include", None, False)


async def test_cap_holds_when_three_reviewers_decide_at_once(session_factory: Factory) -> None:
    async with _screening(session_factory, reviewers=3) as (_, reviewers, assignment):
        results = await asyncio.gather(
            *(_decide(session_factory, assignment, r) for r in reviewers), return_exceptions=True
        )

        errors = [r for r in results if isinstance(r, BaseException)]
        assert len(errors) == 1
        assert isinstance(errors[0], ScreeningStateError)
        assert errors[0].code == "SCREENING_REVIEWER_CAP"
        assert await _decision_rows(session_factory, assignment) == 2


async def test_reviewer_count_change_racing_the_first_decision_is_frozen(
    session_factory: Factory,
) -> None:
    async with _screening(session_factory, reviewers=2) as (project_id, (a, _), assignment):
        decided, put_done = asyncio.Event(), asyncio.Event()
        recorded: list[str] = []

        async def decide() -> None:
            async with session_factory() as s1:
                await ScreeningReviewService(s1).decide(assignment, a, INCLUDE)
                decided.set()
                with contextlib.suppress(TimeoutError):
                    await asyncio.wait_for(put_done.wait(), timeout=1)
                await s1.commit()

        async def put() -> None:
            await decided.wait()
            async with session_factory() as s2:
                try:
                    await ScreeningConfigService(s2).set_reviewer_count(project_id, MANAGER, 1)
                    await s2.commit()
                except ScreeningStateError as exc:
                    recorded.append(exc.code)
                finally:
                    put_done.set()

        await asyncio.gather(decide(), put())

        assert recorded == ["SCREENING_CONFIG_FROZEN"]
        async with session_factory() as s:
            settings = (
                await s.execute(select(Project.settings).where(Project.id == project_id))
            ).scalar_one()
        assert reviewer_count_of(settings) == 2
        assert await _decision_rows(session_factory, assignment) == 1


async def test_arbitration_racing_a_decision_change_is_stale(session_factory: Factory) -> None:
    async with _screening(session_factory, reviewers=2) as (project_id, (a, b), assignment):
        async with session_factory() as s:
            d_a = await add_decision(s, assignment, a, "include")
            d_b = await add_decision(s, assignment, b, "exclude")
            await s.commit()
        decided, ruled = asyncio.Event(), asyncio.Event()
        recorded: list[str] = []

        async def change() -> None:
            async with session_factory() as s1:
                await ScreeningReviewService(s1).decide(
                    assignment, a, ScreeningDecisionCreate(decision="maybe")
                )
                decided.set()
                with contextlib.suppress(TimeoutError):
                    await asyncio.wait_for(ruled.wait(), timeout=1)
                await s1.commit()

        async def rule() -> None:
            await decided.wait()
            body = ScreeningArbitrationCreate(
                ruled_on_decision_ids=[d_a, d_b], selected_decision_id=d_b
            )
            async with session_factory() as s2:
                try:
                    await ScreeningReviewService(s2).arbitrate(assignment, MANAGER, body)
                    await s2.commit()
                except ScreeningStateError as exc:
                    recorded.append(exc.code)
                finally:
                    ruled.set()

        await asyncio.gather(change(), rule())

        assert recorded == ["SCREENING_STALE_DECISIONS"]
        async with session_factory() as s:
            rulings = (
                await s.execute(
                    select(func.count())
                    .select_from(ScreeningArbitration)
                    .where(ScreeningArbitration.assignment_id == assignment)
                )
            ).scalar_one()
            states = await assignment_states(
                s, project_id=project_id, reviewer_count=2, assignment_ids=[assignment]
            )
        assert rulings == 0
        mine = next(d for d in states[assignment].decisions if d.reviewer_id == a)
        assert mine.decision == "maybe"
