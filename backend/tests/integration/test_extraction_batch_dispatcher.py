"""Dispatcher (spec §8, G6–G10, G12, G16): real session runs and attempts, fake queue."""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from types import SimpleNamespace
from uuid import UUID, uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.pool import NullPool

from app.core.config import settings
from app.services.extraction_attempt_service import ExtractionAttemptService
from app.services.extraction_batch_dispatcher import ExtractionBatchDispatcher, batch_request_id
from app.services.hitl_session_service import HITLSessionInputError, HITLSessionService
from tests.integration.conftest import SEED
from tests.integration.helpers.batch_fixtures import make_article, make_batch


class FakeQueue:
    def __init__(self) -> None:
        self.calls: list[tuple[UUID, UUID]] = []

    def __call__(self, attempt, batch_id: UUID) -> None:  # noqa: ANN001
        self.calls.append((attempt.id, batch_id))


async def _items(db: AsyncSession, batch_id: UUID) -> list[tuple[str, str | None, UUID | None]]:
    return [
        (r.status, r.reason_code, r.attempt_id)
        for r in (
            await db.execute(
                text(
                    "SELECT status, reason_code, attempt_id FROM public.extraction_batch_items "
                    "WHERE batch_id=:b ORDER BY created_at, id"
                ),
                {"b": str(batch_id)},
            )
        ).all()
    ]


async def _batch(db: AsyncSession, count: int, **fields) -> tuple[UUID, list[UUID]]:  # noqa: ANN003
    articles = [await make_article(db, SEED.primary_project, f"A{i}") for i in range(count)]
    batch_id = await make_batch(
        db,
        owner_id=SEED.primary_profile,
        project_id=SEED.primary_project,
        template_id=SEED.primary_template,
        article_ids=articles,
        **fields,
    )
    await db.commit()
    return batch_id, articles


@pytest.mark.asyncio
async def test_dispatches_at_most_two_articles(db_session: AsyncSession) -> None:
    batch_id, _ = await _batch(db_session, 3)
    queue = FakeQueue()

    await ExtractionBatchDispatcher(db_session, enqueue=queue).advance(batch_id)

    items = await _items(db_session, batch_id)
    assert [s for s, _, _ in items] == ["dispatched", "dispatched", "queued"]
    assert len(queue.calls) == 2 and all(b == batch_id for _, b in queue.calls)
    payload = (
        await db_session.execute(
            text("SELECT request_payload FROM public.extraction_attempts WHERE id=:id"),
            {"id": str(items[0][2])},
        )
    ).scalar_one()
    assert payload["run_id"] and payload["skip_fields_with_human_proposals"] is True


@pytest.mark.asyncio
async def test_advancing_again_creates_no_duplicate_attempt(db_session: AsyncSession) -> None:
    batch_id, _ = await _batch(db_session, 2)
    queue = FakeQueue()
    dispatcher = ExtractionBatchDispatcher(db_session, enqueue=queue)

    await dispatcher.advance(batch_id)
    await dispatcher.advance(batch_id, reenqueue_stale=True)

    attempts = (
        await db_session.execute(
            text(
                "SELECT count(*) FROM public.extraction_attempts a "
                "JOIN public.extraction_batch_items i ON i.attempt_id = a.id WHERE i.batch_id=:b"
            ),
            {"b": str(batch_id)},
        )
    ).scalar_one()
    assert attempts == 2 and len(queue.calls) == 2


@pytest.mark.asyncio
async def test_completion_frees_a_slot(db_session: AsyncSession) -> None:
    batch_id, _ = await _batch(db_session, 3)
    queue = FakeQueue()
    dispatcher = ExtractionBatchDispatcher(db_session, enqueue=queue)
    await dispatcher.advance(batch_id)
    first_attempt = (await _items(db_session, batch_id))[0][2]
    await db_session.execute(
        text("UPDATE public.extraction_attempts SET status='completed', result='{}' WHERE id=:id"),
        {"id": str(first_attempt)},
    )

    await dispatcher.advance(batch_id)

    assert [s for s, _, _ in await _items(db_session, batch_id)] == ["dispatched"] * 3


@pytest.mark.asyncio
async def test_engine_class_failure_stops_the_batch(db_session: AsyncSession) -> None:
    batch_id, _ = await _batch(db_session, 3)
    queue = FakeQueue()
    dispatcher = ExtractionBatchDispatcher(db_session, enqueue=queue)
    await dispatcher.advance(batch_id)
    first_attempt = (await _items(db_session, batch_id))[0][2]
    await db_session.execute(
        text(
            "UPDATE public.extraction_attempts "
            "SET status='failed', error_code='MISSING_API_KEY', error='no key' WHERE id=:id"
        ),
        {"id": str(first_attempt)},
    )

    await dispatcher.advance(batch_id)

    stop = (
        await db_session.execute(
            text("SELECT stop_code, stop_message FROM public.extraction_batches WHERE id=:b"),
            {"b": str(batch_id)},
        )
    ).one()
    assert stop == ("MISSING_API_KEY", "no key")
    assert (await _items(db_session, batch_id))[2][:2] == ("cancelled", "STOPPED_ENGINE_ERROR")
    assert len(queue.calls) == 2


@pytest.mark.asyncio
async def test_cancelled_batch_cancels_queued_and_dispatches_nothing(
    db_session: AsyncSession,
) -> None:
    batch_id, _ = await _batch(db_session, 2, cancelled_at=datetime.now(UTC))
    queue = FakeQueue()

    await ExtractionBatchDispatcher(db_session, enqueue=queue).advance(batch_id)

    assert [(s, r) for s, r, _ in await _items(db_session, batch_id)] == [
        ("cancelled", "CANCELLED")
    ] * 2
    assert queue.calls == []


@pytest.mark.asyncio
async def test_owner_without_reviewer_role_skips_every_article(db_session: AsyncSession) -> None:
    articles = [await make_article(db_session, SEED.primary_project)]
    batch_id = await make_batch(
        db_session,
        owner_id=SEED.outsider_profile,
        project_id=SEED.primary_project,
        template_id=SEED.primary_template,
        article_ids=articles,
    )
    queue = FakeQueue()

    await ExtractionBatchDispatcher(db_session, enqueue=queue).advance(batch_id)

    assert (await _items(db_session, batch_id))[0][:2] == ("skipped", "NO_LONGER_AVAILABLE")
    assert queue.calls == []


@pytest.mark.asyncio
async def test_disabled_tool_skips(db_session: AsyncSession) -> None:
    batch_id, _ = await _batch(db_session, 1)
    await db_session.execute(
        text("UPDATE public.project_extraction_templates SET is_active=false WHERE id=:t"),
        {"t": str(SEED.primary_template)},
    )

    await ExtractionBatchDispatcher(db_session, enqueue=FakeQueue()).advance(batch_id)

    assert (await _items(db_session, batch_id))[0][:2] == ("skipped", "NO_LONGER_AVAILABLE")


@pytest.mark.asyncio
async def test_run_stage_reasons(db_session: AsyncSession) -> None:
    dispatcher = ExtractionBatchDispatcher(db_session, enqueue=FakeQueue())
    batch = SimpleNamespace(owner_id=SEED.primary_profile, skip_articles_with_ai_suggestions=False)

    assert await dispatcher._run_reason(batch, uuid4(), uuid4(), "finalized") == "RUN_FINALIZED"
    assert await dispatcher._run_reason(batch, uuid4(), uuid4(), "consensus") == "RUN_NOT_EDITABLE"
    assert await dispatcher._run_reason(batch, uuid4(), uuid4(), "extract") is None


@pytest.mark.asyncio
async def test_owner_already_running_ai_on_the_run_is_skipped(db_session: AsyncSession) -> None:
    first_batch, articles = await _batch(db_session, 1)
    dispatcher = ExtractionBatchDispatcher(db_session, enqueue=FakeQueue())
    await dispatcher.advance(first_batch)
    second_batch = await make_batch(
        db_session,
        owner_id=SEED.primary_profile,
        project_id=SEED.primary_project,
        template_id=SEED.primary_template,
        article_ids=articles,
    )

    await dispatcher.advance(second_batch)

    assert (await _items(db_session, second_batch))[0][:2] == ("skipped", "AI_ALREADY_RUNNING")


@pytest.mark.asyncio
async def test_existing_ai_suggestions_skip_only_when_asked(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def has_ai(self, run_id):  # noqa: ANN001, ANN202, ARG001
        return True

    monkeypatch.setattr(ExtractionBatchDispatcher, "_run_has_ai_suggestions", has_ai)
    skip_on, _ = await _batch(db_session, 1)
    skip_off, _ = await _batch(db_session, 1, skip_articles_with_ai_suggestions=False)
    queue = FakeQueue()
    dispatcher = ExtractionBatchDispatcher(db_session, enqueue=queue)

    await dispatcher.advance(skip_on)
    await dispatcher.advance(skip_off)

    assert (await _items(db_session, skip_on))[0][:2] == ("skipped", "ALREADY_HAS_AI_SUGGESTIONS")
    assert (await _items(db_session, skip_off))[0][0] == "dispatched"


@pytest.mark.asyncio
async def test_resume_reenqueues_an_hour_old_pending_attempt(db_session: AsyncSession) -> None:
    batch_id, _ = await _batch(db_session, 1)
    queue = FakeQueue()
    dispatcher = ExtractionBatchDispatcher(db_session, enqueue=queue)
    await dispatcher.advance(batch_id)
    attempt_id = (await _items(db_session, batch_id))[0][2]
    await db_session.execute(
        text(
            "UPDATE public.extraction_attempts SET updated_at = now() - interval '61 minutes' "
            "WHERE id=:id"
        ),
        {"id": str(attempt_id)},
    )

    await dispatcher.advance(batch_id)
    assert len(queue.calls) == 1
    await dispatcher.advance(batch_id, reenqueue_stale=True)
    assert len(queue.calls) == 2 and queue.calls[1][0] == attempt_id


def test_request_id_is_stable_per_item() -> None:
    item = uuid4()
    assert batch_request_id(item) == batch_request_id(item) != batch_request_id(uuid4())


# ---------------------------------------------------------------------------
# Lock lifetime — these CANNOT use ``db_session``.
#
# That fixture pins one connection inside an outer transaction and never
# releases it, so a lock that dies with its connection still looks alive. The
# real worker runs on ``worker_session()`` (NullPool), where every commit
# returns — and therefore CLOSES — the connection, ending the backend session
# that owns a session-level advisory lock. These tests commit for real, on
# their own connections, and clean up the rows they create (the local Supabase
# stack is shared).
# ---------------------------------------------------------------------------

#: The backend(s) holding the advisory lock for one batch. ``classid``/``objid``
#: are unsigned ``oid``s carrying the two halves of the 64-bit key, so the key
#: is masked rather than cast straight to ``int`` (which overflows when
#: ``hashtextextended`` returns a negative bigint).
_LOCK_HOLDERS_SQL = """
SELECT l.pid FROM pg_locks l
WHERE l.locktype = 'advisory' AND l.granted
  AND l.classid = ((hashtextextended(:k, 0) >> 32) & 4294967295)::oid
  AND l.objid   = (hashtextextended(:k, 0) & 4294967295)::oid
"""

_LOCK_SQL = "SELECT pg_advisory_lock(hashtextextended(:k, 0))"
_UNLOCK_SQL = "SELECT pg_advisory_unlock(hashtextextended(:k, 0))"


async def _lock_holders(engine: AsyncEngine, batch_id: UUID) -> list[int]:
    """Backend pids holding this batch's lock, read from an INDEPENDENT connection."""
    async with engine.connect() as probe:
        return [
            row[0]
            for row in (
                await probe.execute(text(_LOCK_HOLDERS_SQL), {"k": f"extraction_batch:{batch_id}"})
            ).all()
        ]


@asynccontextmanager
async def _committed_batch(
    count: int,
) -> AsyncIterator[tuple[AsyncEngine, async_sessionmaker[AsyncSession], UUID]]:
    """A really-committed batch on its own engine, torn down row by row."""
    engine = create_async_engine(settings.async_database_url, poolclass=NullPool)
    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    articles: list[UUID] = []
    batch_id: UUID | None = None
    try:
        async with factory() as setup:
            articles = [
                await make_article(setup, SEED.primary_project, f"lock-probe-{i}")
                for i in range(count)
            ]
            batch_id = await make_batch(
                setup,
                owner_id=SEED.primary_profile,
                project_id=SEED.primary_project,
                template_id=SEED.primary_template,
                article_ids=articles,
            )
            await setup.commit()
        yield engine, factory, batch_id
    finally:
        async with factory() as cleanup:
            params = {"ids": [str(a) for a in articles], "b": str(batch_id)}
            for statement in (
                # Runs cascade to their attempts and published states.
                "DELETE FROM public.extraction_runs WHERE article_id = ANY(CAST(:ids AS uuid[]))",
                "DELETE FROM public.extraction_instances "
                "WHERE article_id = ANY(CAST(:ids AS uuid[]))",
                "DELETE FROM public.extraction_batch_items WHERE batch_id = :b",
                "DELETE FROM public.extraction_batches WHERE id = :b",
                "DELETE FROM public.articles WHERE id = ANY(CAST(:ids AS uuid[]))",
            ):
                await cleanup.execute(text(statement), params)
            await cleanup.commit()
        await engine.dispose()


@pytest.mark.asyncio
async def test_the_batch_lock_survives_every_commit_inside_advance(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The lock must outlive the commits `advance` makes, on ONE unchanged backend."""
    async with _committed_batch(3) as (engine, factory, batch_id):
        holders: list[list[int]] = []
        original = ExtractionBatchDispatcher._dispatch_one

        async def observing(self, *args, **kwargs):  # noqa: ANN001, ANN002, ANN003, ANN202
            await original(self, *args, **kwargs)
            holders.append(await _lock_holders(engine, batch_id))

        monkeypatch.setattr(ExtractionBatchDispatcher, "_dispatch_one", observing)

        async with factory() as db:
            await ExtractionBatchDispatcher(db, enqueue=FakeQueue()).advance(batch_id)

        assert len(holders) == 2, "expected one observation after each dispatch's commit"
        assert all(len(h) == 1 for h in holders), f"lock dropped mid-advance: {holders}"
        assert holders[0] == holders[1], f"lock moved to another backend: {holders}"
        assert await _lock_holders(engine, batch_id) == [], "lock leaked after advance returned"


@pytest.mark.asyncio
async def test_two_concurrent_advances_cannot_dispatch_the_same_item_twice(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Mutual exclusion across SEPARATE connections — the real completion-callback race."""
    async with _committed_batch(1) as (_engine, factory, batch_id):
        calls: list[UUID] = []
        original = ExtractionAttemptService.prepare_request

        async def slow_prepare(self, payload, owner_id, *, job_id):  # noqa: ANN001, ANN202
            attempt = await original(self, payload, owner_id, job_id=job_id)
            # ``prepare_request`` has COMMITTED by now, which drops the
            # ``FOR UPDATE SKIP LOCKED`` row lock while the item is STILL
            # `queued` — the exact window only a per-batch lock can cover.
            await asyncio.sleep(0.25)
            return attempt

        monkeypatch.setattr(ExtractionAttemptService, "prepare_request", slow_prepare)

        async def advance_once() -> None:
            async with factory() as db:
                dispatcher = ExtractionBatchDispatcher(
                    db, enqueue=lambda attempt, _b: calls.append(attempt.id)
                )
                await dispatcher.advance(batch_id)

        await asyncio.gather(advance_once(), advance_once())

        assert len(calls) == 1, f"the single queued item was dispatched {len(calls)} times"
        async with factory() as check:
            attempts = (
                await check.execute(
                    text(
                        "SELECT count(*) FROM public.extraction_attempts a JOIN "
                        "public.extraction_batch_items i ON i.attempt_id = a.id "
                        "WHERE i.batch_id=:b"
                    ),
                    {"b": str(batch_id)},
                )
            ).scalar_one()
            statuses = [s for s, _, _ in await _items(check, batch_id)]
        assert attempts == 1
        assert statuses == ["dispatched"]


@pytest.mark.asyncio
async def test_advance_gives_up_instead_of_waiting_forever_for_the_lock(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A contended advance must fail fast, not occupy a worker slot indefinitely.

    The holder recounts before it finishes, so giving up is semantically
    correct: there is nothing for this advance to do. ``asyncio.wait_for``
    keeps an unbounded wait from hanging the suite.
    """
    async with _committed_batch(2) as (engine, factory, batch_id):
        monkeypatch.setattr(ExtractionBatchDispatcher, "LOCK_TIMEOUT_MS", 300, raising=False)
        queue = FakeQueue()
        key = {"k": f"extraction_batch:{batch_id}"}

        async with engine.connect() as holder:
            await holder.execute(text(_LOCK_SQL), key)
            async with factory() as db:
                await asyncio.wait_for(
                    ExtractionBatchDispatcher(db, enqueue=queue).advance(batch_id), timeout=20
                )
            await holder.execute(text(_UNLOCK_SQL), key)

        assert queue.calls == [], "a contended advance must not dispatch"
        async with factory() as check:
            assert [s for s, _, _ in await _items(check, batch_id)] == ["queued", "queued"]
        assert await _lock_holders(engine, batch_id) == [], "the waiter leaked a lock"


@pytest.mark.asyncio
async def test_a_rolled_back_skip_does_not_break_the_next_claimed_item(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A `discard_writes` skip rolls back, expiring every ORM instance in the session.

    The remaining claimed items must still dispatch. Reading `batch`/`item`
    attributes after that rollback triggers an implicit refresh, which aborted
    the whole advance — and with `max_retries=0` no callback fires for the rest
    of the batch, so it sits active until it reads stalled.

    Real session, not ``db_session``: inside that fixture the dispatcher's
    rollback unwinds the SAVEPOINT holding the test's own fixture rows, so the
    batch vanishes and the test cannot observe the product behaviour at all.
    """
    async with _committed_batch(2) as (_engine, factory, batch_id):
        original = HITLSessionService.open_or_resume
        seen = {"n": 0}

        async def first_one_vanishes(self, **kwargs):  # noqa: ANN001, ANN003, ANN202
            seen["n"] += 1
            if seen["n"] == 1:
                raise HITLSessionInputError("article vanished mid-batch")
            return await original(self, **kwargs)

        monkeypatch.setattr(HITLSessionService, "open_or_resume", first_one_vanishes)
        queue = FakeQueue()

        async with factory() as db:
            await ExtractionBatchDispatcher(db, enqueue=queue).advance(batch_id)

        async with factory() as check:
            statuses = [(s, r) for s, r, _ in await _items(check, batch_id)]
        assert statuses[0] == ("skipped", "NO_LONGER_AVAILABLE")
        assert statuses[1][0] == "dispatched", "the second claimed item never dispatched"
        assert len(queue.calls) == 1
