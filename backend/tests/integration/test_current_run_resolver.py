"""CurrentRunResolver — the one answer to "which run is current for a coordinate".

The ranking (live > finalized > cancelled; newest ``created_at``; ``id``
descending on a tie) is exercised table-driven against every reader, then the
two writers (``open_for_session``, ``resolve_or_create_extract``) on the cases
where they differ. All state is savepoint-scoped via ``db_session``.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import NamedTuple
from uuid import UUID, uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction import ExtractionRun, ExtractionRunStage
from app.services.current_run import CurrentRunResolver
from app.services.extraction_run_write import RunWriteError
from tests.integration.conftest import SEED, open_session

T0 = datetime(2026, 1, 1, tzinfo=UTC)
PENDING, EXTRACT, CONSENSUS, FINALIZED, CANCELLED = (s.value for s in ExtractionRunStage)


@pytest.fixture
async def aid(db_session: AsyncSession) -> UUID:
    """A fresh article in the SEED project: the coordinate starts with no run."""
    return (
        await db_session.execute(
            text(
                "INSERT INTO public.articles (id, project_id, title, row_version) "
                "VALUES (gen_random_uuid(), :pid, 'current-run', 1) RETURNING id"
            ),
            {"pid": str(SEED.primary_project)},
        )
    ).scalar_one()


async def _version_id(db: AsyncSession) -> UUID:
    return (
        await db.execute(
            text(
                "SELECT id FROM public.extraction_template_versions "
                "WHERE project_template_id = :tid AND is_active"
            ),
            {"tid": str(SEED.primary_template)},
        )
    ).scalar_one()


async def _run(
    db: AsyncSession, aid: UUID, *, stage: str, minute: int, run_id: UUID | None = None
) -> UUID:
    run = ExtractionRun(
        id=run_id or uuid4(),
        project_id=SEED.primary_project,
        article_id=aid,
        template_id=SEED.primary_template,
        kind="extraction",
        version_id=await _version_id(db),
        stage=stage,
        status="completed",
        created_by=SEED.primary_profile,
        created_at=T0 + timedelta(minutes=minute),
    )
    db.add(run)
    await db.flush()
    return run.id


def _resolver(db: AsyncSession) -> CurrentRunResolver:
    return CurrentRunResolver(db)


async def _current(db: AsyncSession, aid: UUID) -> UUID | None:
    by_article = await _resolver(db).current_by_article(
        project_id=SEED.primary_project,
        template_id=SEED.primary_template,
        article_ids=[aid],
    )
    by_template = await _resolver(db).current_by_template(
        project_id=SEED.primary_project, article_id=aid
    )
    a, t = by_article.get(aid), by_template.get(SEED.primary_template)
    assert (a and a.id) == (t and t.id), "the two partitions must rank identically"
    return a.id if a else None


async def _resolved(db: AsyncSession, aid: UUID) -> UUID | None:
    run = await _resolver(db).resolve(
        project_id=SEED.primary_project,
        article_id=aid,
        template_id=SEED.primary_template,
    )
    return run.id if run else None


class Case(NamedTuple):
    runs: list[tuple[str, int]]  # (stage, minute offset), written in this order
    current: int | None  # index into runs
    resolved: int | None


CASES = {
    "no-run": Case([], None, None),
    "live-beats-newer-finalized": Case([(FINALIZED, 5), (EXTRACT, 0)], 1, 1),
    "consensus-is-live": Case([(FINALIZED, 0), (CONSENSUS, 1)], 1, 1),
    "pending-is-live": Case([(FINALIZED, 5), (PENDING, 0)], 1, 1),
    "newest-finalized": Case([(FINALIZED, 1), (FINALIZED, 0)], 0, 0),
    "finalized-beats-newer-cancelled": Case([(CANCELLED, 9), (FINALIZED, 0)], 1, 1),
    "cancelled-only-is-current-not-resolved": Case([(CANCELLED, 0), (CANCELLED, 1)], 1, None),
    "every-tier": Case([(CANCELLED, 9), (FINALIZED, 5), (EXTRACT, 0)], 2, 2),
}


@pytest.mark.parametrize("case", list(CASES.values()), ids=list(CASES))
async def test_ranking(db_session: AsyncSession, aid: UUID, case: Case) -> None:
    ids = [await _run(db_session, aid, stage=stage, minute=m) for stage, m in case.runs]

    want_current = None if case.current is None else ids[case.current]
    want_resolved = None if case.resolved is None else ids[case.resolved]
    assert await _current(db_session, aid) == want_current
    assert await _resolved(db_session, aid) == want_resolved


@pytest.mark.parametrize("high_id_first", [True, False], ids=["high-id-first", "low-id-first"])
async def test_every_reader_agrees_on_a_created_at_tie(
    db_session: AsyncSession, aid: UUID, high_id_first: bool
) -> None:
    """The disagreement this resolver removed: runs written in one transaction
    share ``now()``. The session opener and the form-run read ranked by
    ``created_at`` alone (so the heap order won: the first-written run), while
    export, the agent read and the article-progress read broke the tie by
    ``id`` — the HITL page and the export showed different runs."""
    low, high = sorted([uuid4(), uuid4()])
    for run_id in [high, low] if high_id_first else [low, high]:
        await _run(db_session, aid, stage=FINALIZED, minute=0, run_id=run_id)

    session = await open_session(
        db_session,
        project_id=SEED.primary_project,
        article_id=aid,
        template_id=SEED.primary_template,
        user_id=SEED.primary_profile,
    )
    assert (session.run_id, await _resolved(db_session, aid), await _current(db_session, aid)) == (
        high,
        high,
        high,
    )


# --------------------------------------------------------------------------
# Writers
# --------------------------------------------------------------------------


async def _open(db: AsyncSession, aid: UUID) -> tuple[ExtractionRun, bool]:
    return await _resolver(db).open_for_session(
        project_id=SEED.primary_project,
        article_id=aid,
        template_id=SEED.primary_template,
        user_id=SEED.primary_profile,
        parameters={"opened_via": "test"},
    )


async def _gate(db: AsyncSession, aid: UUID) -> tuple[ExtractionRun, bool]:
    return await _resolver(db).resolve_or_create_extract(
        project_id=SEED.primary_project,
        article_id=aid,
        template_id=SEED.primary_template,
        user_id=SEED.primary_profile,
    )


@pytest.mark.parametrize("writer", [_open, _gate], ids=["session", "extract-gate"])
async def test_writer_creates_an_extract_run_on_an_empty_coordinate(
    db_session: AsyncSession, aid: UUID, writer
) -> None:
    run, created = await writer(db_session, aid)
    assert created is True
    assert run.stage == EXTRACT

    again, created_again = await writer(db_session, aid)
    assert (again.id, created_again) == (run.id, False)


@pytest.mark.parametrize("writer", [_open, _gate], ids=["session", "extract-gate"])
async def test_writer_parks_a_pending_run_in_extract(
    db_session: AsyncSession, aid: UUID, writer
) -> None:
    pending = await _run(db_session, aid, stage=PENDING, minute=0)

    run, created = await writer(db_session, aid)
    assert (run.id, run.stage, created) == (pending, EXTRACT, False)


@pytest.mark.parametrize(
    ("writer", "reuses"), [(_open, True), (_gate, False)], ids=["session", "extract-gate"]
)
async def test_finalized_coordinate(
    db_session: AsyncSession, aid: UUID, writer, reuses: bool
) -> None:
    """The session shows a finalized run read-only (reopen is its own action);
    standalone AI extraction needs a live run, so it creates one beside it."""
    finalized = await _run(db_session, aid, stage=FINALIZED, minute=0)

    run, created = await writer(db_session, aid)
    assert (run.id == finalized, created) == (reuses, not reuses)
    if not reuses:
        assert run.stage == EXTRACT


@pytest.mark.parametrize("writer", [_open, _gate], ids=["session", "extract-gate"])
async def test_cancelled_coordinate_gets_a_fresh_run(
    db_session: AsyncSession, aid: UUID, writer
) -> None:
    cancelled = await _run(db_session, aid, stage=CANCELLED, minute=0)

    run, created = await writer(db_session, aid)
    assert (run.id != cancelled, created, run.stage) == (True, True, EXTRACT)


async def test_session_resumes_a_run_in_consensus(db_session: AsyncSession, aid: UUID) -> None:
    consensus = await _run(db_session, aid, stage=CONSENSUS, minute=0)

    run, created = await _open(db_session, aid)
    assert (run.id, run.stage, created) == (consensus, CONSENSUS, False)


async def test_extract_gate_refuses_a_run_in_consensus(db_session: AsyncSession, aid: UUID) -> None:
    """Appending AI proposals to an adjudication in progress is the shadow work
    the one-live-run invariant forbids: a clear error, never a forked run."""
    await _run(db_session, aid, stage=CONSENSUS, minute=0)

    with pytest.raises(RunWriteError, match="consensus") as refused:
        await _gate(db_session, aid)
    assert refused.value.reason == "stage"


async def test_a_stale_loaded_run_never_decides(db_session: AsyncSession, aid: UUID) -> None:
    """A run already in the identity map whose stage a raw UPDATE changed: the
    resolver ranks the row, not the stale object (the gate forked no run over
    a cancelled one before the cancellation was visible to it)."""
    run_id = await _run(db_session, aid, stage=EXTRACT, minute=0)
    loaded = await _resolver(db_session).resolve(  # held: the identity map is weak
        project_id=SEED.primary_project, article_id=aid, template_id=SEED.primary_template
    )
    assert loaded is not None and loaded.id == run_id
    await db_session.execute(
        text("UPDATE public.extraction_runs SET stage = 'cancelled' WHERE id = :id"),
        {"id": str(run_id)},
    )

    assert await _resolved(db_session, aid) is None
    run, created = await _gate(db_session, aid)
    assert (run.id != run_id, created) == (True, True)


async def test_a_stale_loaded_stage_is_refreshed(db_session: AsyncSession, aid: UUID) -> None:
    """The gate's busy check reads the stage the ranking saw: a held object
    still saying EXTRACT does not let AI work into a run now in consensus."""
    run_id = await _run(db_session, aid, stage=EXTRACT, minute=0)
    loaded = await _resolver(db_session).resolve(  # held: the identity map is weak
        project_id=SEED.primary_project, article_id=aid, template_id=SEED.primary_template
    )
    assert loaded is not None and loaded.id == run_id
    await db_session.execute(
        text("UPDATE public.extraction_runs SET stage = 'consensus' WHERE id = :id"),
        {"id": str(run_id)},
    )

    with pytest.raises(RunWriteError):
        await _gate(db_session, aid)
    assert loaded.stage == CONSENSUS
