"""Screening decisions racing each other and the config, with real commits.

Every session here commits for real; ``throwaway_project`` deletes the project
(and, by cascade, its screening rows) and ``_members`` deletes the users it made.
"""

from __future__ import annotations

import asyncio
import contextlib
from collections.abc import AsyncIterator
from uuid import UUID

import pytest
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.models.article import Article
from app.models.project import Project
from app.models.screening import ScreeningAssignment, ScreeningDecision
from app.repositories.duplicate_predicates import removed_duplicate
from app.repositories.project_repository import ProjectRepository
from app.repositories.screening_repository import ScreeningRepository
from app.schemas.duplicates import DuplicateVerdictCreate
from app.schemas.screening import ScreeningConfigUpdate, ScreeningDecisionCreate
from app.services.duplicate_service import DuplicateService
from app.services.screening_config_service import ScreeningConfigService
from app.services.screening_errors import ScreeningStateError
from app.services.screening_outcome import Outcome
from app.services.screening_review_service import ScreeningReviewService, assignment_states
from app.services.screening_settings import reviewer_count_of
from tests.integration.conftest import SEED
from tests.integration.helpers.screening_fixtures import (
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
    factory: Factory, *, reviewers: int, reviewer_count: int = 2
) -> AsyncIterator[tuple[UUID, list[UUID], UUID]]:
    """A committed project with ``reviewer_count``, ``reviewers`` reviewers and one enrolled article.

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
                await set_reviewer_count(s, project_id, reviewer_count)
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
                s,
                project_id=project_id,
                phase="title_abstract",
                reviewer_count=2,
                assignment_ids=[assignment],
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
                    await ScreeningConfigService(s2).set_config(
                        project_id, MANAGER, ScreeningConfigUpdate(reviewer_count=1)
                    )
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
        assert reviewer_count_of(settings, "title_abstract") == 2
        assert await _decision_rows(session_factory, assignment) == 1


async def test_one_reviewer_posting_twice_at_once_writes_one_decision(
    session_factory: Factory,
) -> None:
    """The finality check runs under the assignment lock: the second post sees the first."""
    async with _screening(session_factory, reviewers=2) as (_, (a, _), assignment):
        results = await asyncio.gather(
            _decide(session_factory, assignment, a),
            _decide(session_factory, assignment, a),
            return_exceptions=True,
        )

        errors = [r for r in results if isinstance(r, BaseException)]
        assert len(errors) == 1
        assert isinstance(errors[0], ScreeningStateError)
        assert errors[0].code == "SCREENING_DECISION_FINAL"
        assert await _decision_rows(session_factory, assignment) == 1


async def _wait_for_a_lock_waiter(factory: Factory) -> bool:
    """Poll (<= 1 s) until some backend waits on a lock it was not granted."""
    async with factory() as s:
        for _ in range(50):
            waiting = (
                await s.execute(text("SELECT count(*) FROM pg_locks WHERE NOT granted"))
            ).scalar_one()
            if waiting > 0:
                return True
            await s.rollback()  # a fresh snapshot of pg_locks on the next poll
            await asyncio.sleep(0.02)
    return False


async def test_solo_re_decide_racing_a_ruling_is_refused(session_factory: Factory) -> None:
    """The ruling check reads the post-lock snapshot: a re-decide parked on the lock is FINAL."""
    async with _screening(session_factory, reviewers=1, reviewer_count=1) as (
        _,
        (r,),
        assignment,
    ):
        await _decide(session_factory, assignment, r)
        locked = asyncio.Event()
        saw_waiter: list[bool] = []

        async def rule() -> None:
            async with session_factory() as s1:
                await ScreeningRepository(s1).lock_assignment(assignment)
                await ScreeningRepository(s1).add_arbitration(
                    assignment, "exclude", None, None, None, MANAGER
                )
                locked.set()
                saw_waiter.append(await _wait_for_a_lock_waiter(session_factory))
                await s1.commit()

        async def redecide() -> None:
            await locked.wait()
            async with session_factory() as s2:
                await ScreeningReviewService(s2).decide(
                    assignment, r, ScreeningDecisionCreate(decision="maybe")
                )
                await s2.commit()

        results = await asyncio.gather(rule(), redecide(), return_exceptions=True)

        assert saw_waiter == [True]
        assert results[0] is None
        assert isinstance(results[1], ScreeningStateError)
        assert results[1].code == "SCREENING_DECISION_FINAL"
        assert await _decision_rows(session_factory, assignment) == 1


async def _current_decision_of(factory: Factory, project: UUID, assignment: UUID, who: UUID) -> str:
    async with factory() as s:
        rows = await ScreeningRepository(s).current_decisions(
            project_id=project, assignment_ids=[assignment]
        )
    return next(d.decision for d in rows if d.reviewer_id == who)


async def _latest_ruling_of(factory: Factory, project: UUID, assignment: UUID) -> str:
    async with factory() as s:
        rulings = await ScreeningRepository(s).latest_rulings(
            project_id=project, assignment_ids=[assignment]
        )
    return rulings[assignment].decision


async def test_latest_decision_is_the_last_committed_not_the_first_started(
    session_factory: Factory,
) -> None:
    """Two writes of one seat overlap: the one whose transaction began first commits last.

    ``now()`` stamps the transaction start, so the late committer would carry
    the EARLIER ``created_at`` and the superseded row would read as current.
    """
    async with _screening(session_factory, reviewers=1) as (project_id, (a,), assignment):
        async with session_factory() as first, session_factory() as second:
            await first.execute(text("SELECT 1"))  # first's transaction starts now
            await ScreeningRepository(second).add_decision(assignment, a, "exclude", None, None)
            await second.commit()
            await ScreeningRepository(first).add_decision(assignment, a, "include", None, None)
            await first.commit()

        assert await _current_decision_of(session_factory, project_id, assignment, a) == "include"


async def test_latest_ruling_is_the_last_committed_not_the_first_started(
    session_factory: Factory,
) -> None:
    """Two arbitrators re-rule at once: same overlap, same trap, on the rulings."""
    async with _screening(session_factory, reviewers=1) as (project_id, _, assignment):
        async with session_factory() as first, session_factory() as second:
            await first.execute(text("SELECT 1"))  # first's transaction starts now
            await ScreeningRepository(second).add_arbitration(
                assignment, "exclude", None, None, None, MANAGER
            )
            await second.commit()
            await ScreeningRepository(first).add_arbitration(
                assignment, "include", None, None, None, MANAGER
            )
            await first.commit()

        assert await _latest_ruling_of(session_factory, project_id, assignment) == "include"


@contextlib.asynccontextmanager
async def _sendable(factory: Factory) -> AsyncIterator[UUID]:
    """A committed project with two solo-included articles, full text on and protocol reasons set."""
    async with _screening(factory, reviewers=1, reviewer_count=1) as (project_id, (r,), first):
        async with factory() as s:
            second_article = await make_screening_article(s, project_id)
            (second,) = await enroll_articles(s, project_id, [second_article], by=MANAGER)
            await set_reviewer_count(s, project_id, 1, key="full_text_reviewer_count")
            await s.execute(
                text(
                    "UPDATE public.projects SET eligibility_criteria = CAST(:e AS jsonb) WHERE id = :p"
                ),
                {"e": '{"exclusion": ["Wrong population"]}', "p": str(project_id)},
            )
            await s.commit()
        await _decide(factory, first, r)
        await _decide(factory, second, r)
        yield project_id


async def _send(factory: Factory, project_id: UUID):
    async with factory() as s:
        result = await ScreeningConfigService(s).enroll(project_id, MANAGER, None, "full_text")
        await s.commit()
        return result


async def _full_text_rows(factory: Factory, project_id: UUID) -> int:
    async with factory() as s:
        stmt = (
            select(func.count())
            .select_from(ScreeningAssignment)
            .where(
                ScreeningAssignment.project_id == project_id,
                ScreeningAssignment.phase == "full_text",
            )
        )
        return int((await s.execute(stmt)).scalar_one())


async def test_two_sends_enroll_once(session_factory: Factory) -> None:
    """The project lock serializes sends: the second sees the first's rows and has nothing to send."""
    async with _sendable(session_factory) as project_id:
        first, second = await asyncio.gather(
            _send(session_factory, project_id), _send(session_factory, project_id)
        )

        assert sorted((first.enrolled, second.enrolled)) == [0, 2]
        assert first.already_enrolled == second.already_enrolled == 0
        assert await _full_text_rows(session_factory, project_id) == 2


async def test_full_text_enroll_and_config_serialize(session_factory: Factory) -> None:
    """A send parked behind a config change that turns full text off is refused, not half-applied."""
    async with _sendable(session_factory) as project_id:
        locked = asyncio.Event()
        saw_waiter: list[bool] = []

        async def turn_off() -> None:
            async with session_factory() as s1:
                await ProjectRepository(s1).update_settings_key(
                    project_id,
                    "screening",
                    lambda old: {k: v for k, v in old.items() if k != "full_text_reviewer_count"},
                )
                locked.set()
                saw_waiter.append(await _wait_for_a_lock_waiter(session_factory))
                await s1.commit()

        async def send() -> None:
            await locked.wait()
            await _send(session_factory, project_id)

        results = await asyncio.gather(turn_off(), send(), return_exceptions=True)

        assert saw_waiter == [True]
        assert results[0] is None
        assert isinstance(results[1], ScreeningStateError)
        assert results[1].code == "SCREENING_NOT_CONFIGURED"
        assert await _full_text_rows(session_factory, project_id) == 0


async def test_title_abstract_re_decide_and_full_text_send_serialize(
    session_factory: Factory,
) -> None:
    """A TA re-decide parked on the project's FOR SHARE lock sees the committed send and is refused."""
    async with _sendable(session_factory) as project_id:
        async with session_factory() as s:
            first = (
                await s.execute(
                    select(ScreeningAssignment.id, ScreeningAssignment.article_id).where(
                        ScreeningAssignment.project_id == project_id
                    )
                )
            ).first()
            assert first is not None
            assignment = first.id
            reviewer = (
                await s.execute(
                    select(ScreeningDecision.reviewer_id).where(
                        ScreeningDecision.assignment_id == assignment
                    )
                )
            ).scalar_one()
        locked = asyncio.Event()
        saw_waiter: list[bool] = []

        async def send() -> None:
            async with session_factory() as s1:
                await s1.execute(
                    text("SELECT id FROM public.projects WHERE id = :p FOR UPDATE"),
                    {"p": str(project_id)},
                )
                locked.set()
                saw_waiter.append(await _wait_for_a_lock_waiter(session_factory))
                await ScreeningConfigService(s1).enroll(project_id, MANAGER, None, "full_text")
                await s1.commit()

        async def redecide() -> None:
            await locked.wait()
            async with session_factory() as s2:
                await ScreeningReviewService(s2).decide(
                    assignment,
                    reviewer,
                    ScreeningDecisionCreate(
                        decision="exclude", exclusion_reason="Wrong population"
                    ),
                )
                await s2.commit()

        results = await asyncio.gather(send(), redecide(), return_exceptions=True)

        assert saw_waiter == [True]
        assert results[0] is None
        assert isinstance(results[1], ScreeningStateError)
        assert results[1].code == "SCREENING_PHASE_ADVANCED"
        assert (
            await _current_decision_of(session_factory, project_id, assignment, reviewer)
            == "include"
        )


@pytest.mark.parametrize(
    ("second", "expected"),
    [("AC", None), ("CB", "DUPLICATE_KEPT_IS_REMOVED")],
    ids=["chain_sees_the_first", "kept_removed_by_the_first"],
)
async def test_concurrent_batches_serialize_on_the_project_lock(
    session_factory: Factory, second: str, expected: str | None
) -> None:
    """Two managers merge overlapping pairs: the second batch parks on the project lock
    and then reads the first's removal of B."""
    async with throwaway_project(session_factory) as project_id:
        async with session_factory() as s:
            ids = {
                name: await make_screening_article(s, project_id, title=name, pmid="77")
                for name in "ABC"
            }
            await s.commit()

        def item(pair: str) -> DuplicateVerdictCreate:
            return DuplicateVerdictCreate(
                article_id=ids[pair[0]], kept_article_id=ids[pair[1]], verdict="duplicate"
            )

        locked = asyncio.Event()
        saw_waiter: list[bool] = []

        async def first() -> None:
            async with session_factory() as s1:
                await DuplicateService(s1).write_verdicts(project_id, MANAGER, [item("BA")])
                locked.set()
                saw_waiter.append(await _wait_for_a_lock_waiter(session_factory))
                await s1.commit()

        async def then() -> None:
            await locked.wait()
            async with session_factory() as s2:
                await DuplicateService(s2).write_verdicts(project_id, MANAGER, [item(second)])
                await s2.commit()

        results = await asyncio.gather(first(), then(), return_exceptions=True)

        assert saw_waiter == [True]
        assert results[0] is None
        if expected is None:
            assert results[1] is None
        else:
            assert isinstance(results[1], ScreeningStateError)
            assert results[1].code == expected
        async with session_factory() as s:
            removed = set(
                (
                    await s.execute(
                        select(Article.title).where(
                            Article.project_id == project_id, removed_duplicate(Article)
                        )
                    )
                ).scalars()
            )
        assert removed == ({"A", "B"} if expected is None else {"B"})
