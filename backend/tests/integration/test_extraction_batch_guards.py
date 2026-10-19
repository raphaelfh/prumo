"""Shared batch eligibility guards: the plan's read-only prediction matches the dispatcher."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction import ExtractionRunStage
from app.models.extraction_attempt import ExtractionAttempt
from app.services.current_run import CurrentRunResolver
from app.services.extraction_batch_dispatcher import ExtractionBatchDispatcher
from app.services.extraction_batch_guards import (
    run_write_reason,
    runs_with_ai_suggestions,
    runs_with_owner_live_attempt,
    stage_reason,
)
from app.services.extraction_run_write import RunWriteError
from app.services.run_lifecycle_service import RunLifecycleService
from tests.integration.conftest import SEED, make_ai_proposal, open_session
from tests.integration.helpers.batch_fixtures import make_article, make_batch

_CASES = [
    "no-run",
    "pending",
    "extract",
    "extract-owner-live-attempt",
    "extract-ai-proposal",
    "consensus",
    "finalized",
]

_LIVE_WINDOW = ExtractionBatchDispatcher.LIVE_WINDOW


class _RecordingQueue:
    def __init__(self) -> None:
        self.calls: list[UUID] = []

    def __call__(self, attempt: ExtractionAttempt, _batch_id: UUID) -> None:
        self.calls.append(attempt.id)


async def _created_run(db: AsyncSession, article_id: UUID) -> UUID:
    run = await RunLifecycleService(db).create_run(
        project_id=SEED.primary_project,
        article_id=article_id,
        project_template_id=SEED.primary_template,
        user_id=SEED.primary_profile,
    )
    return run.id


async def _park(db: AsyncSession, run_id: UUID, stage: ExtractionRunStage) -> None:
    await db.execute(
        text("UPDATE public.extraction_runs SET stage = :stage WHERE id = :id"),
        {"stage": stage.value, "id": run_id},
    )


async def _extract_run(db: AsyncSession, article_id: UUID) -> UUID:
    session = await open_session(
        db,
        project_id=SEED.primary_project,
        article_id=article_id,
        template_id=SEED.primary_template,
        user_id=SEED.primary_profile,
    )
    return session.run_id


async def _live_attempt(db: AsyncSession, run_id: UUID, article_id: UUID) -> ExtractionAttempt:
    attempt = ExtractionAttempt(
        request_id=uuid4(),
        owner_id=SEED.primary_profile,
        project_id=SEED.primary_project,
        article_id=article_id,
        template_id=SEED.primary_template,
        run_id=run_id,
        request_payload={},
        status="running",
    )
    db.add(attempt)
    await db.flush()
    return attempt


async def _ai_proposal(db: AsyncSession, run_id: UUID, article_id: UUID) -> None:
    instance_id, field_id = (
        await db.execute(
            text(
                "SELECT i.id, f.id FROM public.extraction_instances i "
                "JOIN public.extraction_fields f ON f.entity_type_id = i.entity_type_id "
                "WHERE i.article_id = :a ORDER BY i.id, f.id LIMIT 1"
            ),
            {"a": str(article_id)},
        )
    ).one()
    await make_ai_proposal(db, run_id=run_id, instance_id=instance_id, field_id=field_id)


async def _arrange(db: AsyncSession, case: str) -> UUID:
    """One fresh article of the primary project in the state ``case`` names."""
    article_id = await make_article(db, SEED.primary_project, f"guard {case}")
    if case == "no-run":
        return article_id
    if case in ("pending", "consensus", "finalized"):
        run_id = await _created_run(db, article_id)
        await _park(db, run_id, ExtractionRunStage(case))
        return article_id
    run_id = await _extract_run(db, article_id)
    if case == "extract-owner-live-attempt":
        await _live_attempt(db, run_id, article_id)
    elif case == "extract-ai-proposal":
        await _ai_proposal(db, run_id, article_id)
    return article_id


async def _predict(db: AsyncSession, article_id: UUID) -> str | None:
    """The plan-side prediction: read-only resolution, then the shared guards in order."""
    run = (
        await CurrentRunResolver(db).resolve_by_article(
            project_id=SEED.primary_project,
            template_id=SEED.primary_template,
            article_ids=[article_id],
        )
    ).get(article_id)
    reason = stage_reason(run.stage if run is not None else None)
    if reason is not None or run is None:
        return reason
    if run.id in await runs_with_owner_live_attempt(
        db,
        run_ids=[run.id],
        owner_id=SEED.primary_profile,
        since=datetime.now(UTC) - _LIVE_WINDOW,
    ):
        return "AI_ALREADY_RUNNING"
    if run.id in await runs_with_ai_suggestions(db, [run.id]):
        return "ALREADY_HAS_AI_SUGGESTIONS"
    return None


async def _dispatched_reason(db: AsyncSession, article_id: UUID) -> str | None:
    batch_id = await make_batch(
        db,
        owner_id=SEED.primary_profile,
        project_id=SEED.primary_project,
        template_id=SEED.primary_template,
        article_ids=[article_id],
    )
    await db.commit()
    queue = _RecordingQueue()
    await ExtractionBatchDispatcher(db, enqueue=queue).advance(batch_id)
    status, reason = (
        await db.execute(
            text("SELECT status, reason_code FROM public.extraction_batch_items WHERE batch_id=:b"),
            {"b": str(batch_id)},
        )
    ).one()
    assert (status == "dispatched") == (reason is None) == (len(queue.calls) == 1)
    return reason


_EXPECTED = {
    "no-run": None,
    "pending": None,
    "extract": None,
    "extract-owner-live-attempt": "AI_ALREADY_RUNNING",
    "extract-ai-proposal": "ALREADY_HAS_AI_SUGGESTIONS",
    "consensus": "RUN_NOT_EDITABLE",
    "finalized": "RUN_FINALIZED",
}


@pytest.mark.asyncio
@pytest.mark.parametrize("case", _CASES, ids=_CASES)
async def test_guard_parity_with_the_dispatcher(db_session: AsyncSession, case: str) -> None:
    article_id = await _arrange(db_session, case)

    predicted = await _predict(db_session, article_id)
    dispatched = await _dispatched_reason(db_session, article_id)

    assert predicted == dispatched == _EXPECTED[case]


async def _counts(db: AsyncSession) -> tuple[int, int, int]:
    return (
        await db.execute(
            text(
                "SELECT (SELECT count(*) FROM public.extraction_runs), "
                "(SELECT count(*) FROM public.extraction_instances), "
                "(SELECT count(*) FROM public.extraction_attempts)"
            )
        )
    ).one()


@pytest.mark.asyncio
async def test_guards_are_pure_reads(db_session: AsyncSession) -> None:
    articles = [await _arrange(db_session, case) for case in _CASES]
    await db_session.flush()
    before = await _counts(db_session)

    predictions = [await _predict(db_session, article_id) for article_id in articles]

    assert predictions == [_EXPECTED[case] for case in _CASES]
    assert not db_session.new and not db_session.dirty
    assert await _counts(db_session) == before


@pytest.mark.parametrize(
    ("stage", "expected"),
    [
        (None, None),
        ("pending", None),
        ("extract", None),
        ("finalized", "RUN_FINALIZED"),
        ("consensus", "RUN_NOT_EDITABLE"),
    ],
    ids=["none", "pending", "extract", "finalized", "consensus"],
)
def test_stage_reason_table(stage: str | None, expected: str | None) -> None:
    assert stage_reason(stage) == expected


def _stage_refusal(stage: str | None) -> RunWriteError:
    return RunWriteError("refused", reason="stage", run_id=uuid4(), stage=stage)


@pytest.mark.parametrize(
    ("error", "expected"),
    [
        (RunWriteError("gone", reason="missing", run_id=uuid4()), "NO_LONGER_AVAILABLE"),
        (_stage_refusal("finalized"), "RUN_FINALIZED"),
        (_stage_refusal("consensus"), "RUN_NOT_EDITABLE"),
        (_stage_refusal("pending"), "RUN_NOT_EDITABLE"),
        (_stage_refusal(None), "RUN_NOT_EDITABLE"),
    ],
    ids=["missing", "finalized", "consensus", "pending", "no-stage"],
)
def test_run_write_reason_table(error: RunWriteError, expected: str) -> None:
    assert run_write_reason(error) == expected


@pytest.mark.asyncio
async def test_set_guards_answer_per_run(db_session: AsyncSession) -> None:
    running_article = await make_article(db_session, SEED.primary_project, "running")
    suggested_article = await make_article(db_session, SEED.primary_project, "suggested")
    running_run = await _extract_run(db_session, running_article)
    suggested_run = await _extract_run(db_session, suggested_article)
    attempt = await _live_attempt(db_session, running_run, running_article)
    await _ai_proposal(db_session, suggested_run, suggested_article)
    both = [running_run, suggested_run]
    since = datetime.now(UTC) - timedelta(hours=1)

    assert await runs_with_owner_live_attempt(
        db_session, run_ids=both, owner_id=SEED.primary_profile, since=since
    ) == {running_run}
    assert await runs_with_ai_suggestions(db_session, both) == {suggested_run}
    assert (
        await runs_with_owner_live_attempt(
            db_session,
            run_ids=both,
            owner_id=SEED.primary_profile,
            since=since,
            exclude_request_id=attempt.request_id,
        )
        == set()
    )
    assert (
        await runs_with_owner_live_attempt(
            db_session, run_ids=both, owner_id=SEED.reviewer_profile, since=since
        )
        == set()
    )
    assert await runs_with_ai_suggestions(db_session, []) == set()
