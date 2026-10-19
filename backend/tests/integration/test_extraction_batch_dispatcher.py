"""Dispatcher (spec §8, G6–G10, G12, G16): real session runs and attempts, fake queue."""

from __future__ import annotations

import asyncio
import contextlib
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
from app.models.extraction import ExtractionRunStage
from app.services import extraction_batch_dispatcher as dispatcher_module
from app.services.extraction_attempt_service import ExtractionAttemptService
from app.services.extraction_batch_dispatcher import ExtractionBatchDispatcher, batch_request_id
from app.services.hitl_session_service import HITLSessionInputError, HITLSessionService
from app.services.run_lifecycle_service import RunLifecycleService
from tests.fakes.recorded_llm import RecordedLlm
from tests.fakes.usage_sink import RecordingUsageSink
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
    """G8 reads the stage through the write oracle, on the locked row."""
    dispatcher = ExtractionBatchDispatcher(db_session, enqueue=FakeQueue())
    batch = SimpleNamespace(owner_id=SEED.primary_profile, skip_articles_with_ai_suggestions=False)
    run = await RunLifecycleService(db_session).create_run(
        project_id=SEED.primary_project,
        article_id=SEED.primary_article,
        project_template_id=SEED.primary_template,
        user_id=SEED.primary_profile,
    )

    async def park(stage: ExtractionRunStage) -> None:
        await db_session.execute(
            text("UPDATE public.extraction_runs SET stage = :stage WHERE id = :id"),
            {"stage": stage.value, "id": run.id},
        )

    await park(ExtractionRunStage.FINALIZED)
    assert await dispatcher._run_reason(batch, uuid4(), run.id) == "RUN_FINALIZED"
    await park(ExtractionRunStage.CONSENSUS)
    assert await dispatcher._run_reason(batch, uuid4(), run.id) == "RUN_NOT_EDITABLE"
    await park(ExtractionRunStage.EXTRACT)
    assert await dispatcher._run_reason(batch, uuid4(), run.id) is None
    assert await dispatcher._run_reason(batch, uuid4(), uuid4()) == "NO_LONGER_AVAILABLE"


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
    async def has_ai(_db, run_ids):  # noqa: ANN001, ANN202
        return set(run_ids)

    monkeypatch.setattr(dispatcher_module, "runs_with_ai_suggestions", has_ai)
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


# ---------------------------------------------------------------------------
# Execution never reaches the deployment key for an agent batch.
#
# The attempt runs through the REAL task body: ``run_task`` is captured so its
# coroutine runs on the test loop, and every ``worker_session()`` is a fresh
# session on the test connection (its own SAVEPOINT), so the preparation, the
# ownership and the domain sessions stay separate as in the worker. Only the
# model call (``RecordedLlm``), the usage sink and storage are faked; the
# credential ladder, ``build_model`` and the dispatcher are real.
# ---------------------------------------------------------------------------


def _run_attempt_body(
    db: AsyncSession, monkeypatch: pytest.MonkeyPatch, llm: RecordedLlm, sink: RecordingUsageSink
):  # noqa: ANN202
    from app.services import ai_extraction
    from app.worker.tasks import extraction_tasks

    connection = db.bind

    @asynccontextmanager
    async def worker_session(_engine: object = None) -> AsyncIterator[AsyncSession]:
        async with AsyncSession(
            bind=connection, join_transaction_mode="create_savepoint", expire_on_commit=False
        ) as session:
            yield session

    @asynccontextmanager
    async def worker_engine() -> AsyncIterator[object]:
        yield connection

    real_service = ai_extraction.AiExtraction

    def with_fakes(**kwargs):  # noqa: ANN003, ANN202
        return real_service(**{**kwargs, "llm": llm, "usage_sink": sink})

    captured: list = []
    monkeypatch.setattr("app.worker._session.worker_session", worker_session)
    monkeypatch.setattr("app.worker._session.worker_engine", worker_engine)
    monkeypatch.setattr(ai_extraction, "AiExtraction", with_fakes)
    monkeypatch.setattr("app.core.deps.get_supabase_client", lambda: None)
    monkeypatch.setattr("app.core.factories.create_storage_adapter", lambda _c: None)
    monkeypatch.setattr(extraction_tasks, "run_task", captured.append)

    async def run(attempt_id: UUID) -> None:
        extraction_tasks.run_section_extraction_task.apply(
            kwargs={
                "payload_json": {},
                "user_id": str(SEED.primary_profile),
                "attempt_id": str(attempt_id),
            }
        )
        (body,) = captured
        captured.clear()
        # The attempt row records the outcome; a failed attempt re-raises here.
        with contextlib.suppress(Exception):
            await body()

    return run


def _deployment_key_only(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.llm import provider
    from app.services import llm_connection_service
    from app.worker import queue_health

    monkeypatch.setattr(llm_connection_service, "global_key_for", lambda _p: "sk-test")
    monkeypatch.setattr(provider, "global_key_for", lambda _p: "sk-test")
    monkeypatch.setattr(queue_health, "is_queue_available", lambda: True)


async def _attempt_outcome(db: AsyncSession, attempt_id: UUID) -> tuple[str, str | None]:
    row = (
        await db.execute(
            text("SELECT status, error_code FROM public.extraction_attempts WHERE id=:id"),
            {"id": str(attempt_id)},
        )
    ).one()
    return row[0], row[1]


async def _start(db: AsyncSession, *, agent: bool) -> tuple[UUID, UUID]:
    """A one-article batch started through the real start path, on a user key
    that is then deleted: the deployment key is the only key left."""
    from pydantic import SecretStr

    from app.schemas.extraction_batch import CreateExtractionBatchRequest
    from app.schemas.llm_connection import UserConnectionCreateRequest
    from app.schemas.llm_target import EngineIdentity
    from app.services.extraction_batch_service import AgentRunOrigin, ExtractionBatchService
    from app.services.llm_connection_service import LlmConnectionService, availability_map
    from tests.integration.helpers.ai_extraction import seed_article_text
    from tests.integration.helpers.engine_setup import set_project_engine
    from tests.integration.helpers.pat_rows import insert_pat_row

    provider, model = settings.LLM_PROVIDER, settings.LLM_DEFAULT_MODEL
    await set_project_engine(db, provider, model)
    article = await make_article(db, SEED.primary_project, "deployment-key probe")
    await seed_article_text(db, "ARTICLE BODY", article_id=article)
    key = await LlmConnectionService(db).create_user(
        user_id=SEED.primary_profile,
        payload=UserConnectionCreateRequest(
            provider=provider, label="own key", api_key=SecretStr("sk-own")
        ),
    )
    origin = None
    if agent:
        await _set_policy(db, "reviewers")
        origin = AgentRunOrigin(
            token_id=await insert_pat_row(db, "agent-key-probe"),
            engine=EngineIdentity(provider=provider, model=model, mode="fast", connection_id=None),
            plan_digest=uuid4().hex,
            daily_cap=100,
        )
    started = await ExtractionBatchService(db).start(
        SEED.primary_profile,
        CreateExtractionBatchRequest(
            project_id=SEED.primary_project,
            template_id=SEED.primary_template,
            article_ids=[article],
            skip_articles_with_ai_suggestions=False,
        ),
        agent=origin,
    )
    await db.execute(text("DELETE FROM public.llm_connections WHERE id=:id"), {"id": str(key.id)})
    available = await availability_map(
        db, project_id=SEED.primary_project, user_id=SEED.primary_profile, providers=[provider]
    )
    assert available == {provider: "global"}, "precondition: only the deployment key is left"
    await db.commit()
    return started.batch_id, article


@pytest.mark.asyncio
async def test_agent_batch_with_only_the_deployment_key_stops_before_any_model_call(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    _deployment_key_only(monkeypatch)
    llm, sink = RecordedLlm(), RecordingUsageSink()
    run_attempt = _run_attempt_body(db_session, monkeypatch, llm, sink)
    batch_id, _ = await _start(db_session, agent=True)
    dispatcher = ExtractionBatchDispatcher(db_session, enqueue=FakeQueue())
    await dispatcher.advance(batch_id)
    ((_, _, attempt_id),) = await _items(db_session, batch_id)

    await run_attempt(attempt_id)

    assert await _attempt_outcome(db_session, attempt_id) == ("failed", "MISSING_API_KEY")
    assert llm.calls == [] and sink.entries == []
    await dispatcher.advance(batch_id)
    stop_code = (
        await db_session.execute(
            text("SELECT stop_code FROM public.extraction_batches WHERE id=:b"),
            {"b": str(batch_id)},
        )
    ).scalar_one()
    assert stop_code == "MISSING_API_KEY"


@pytest.mark.asyncio
async def test_ui_batch_with_only_the_deployment_key_runs_on_it(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    _deployment_key_only(monkeypatch)
    llm, sink = RecordedLlm(), RecordingUsageSink()
    run_attempt = _run_attempt_body(db_session, monkeypatch, llm, sink)
    batch_id, _ = await _start(db_session, agent=False)
    await ExtractionBatchDispatcher(db_session, enqueue=FakeQueue()).advance(batch_id)
    ((_, _, attempt_id),) = await _items(db_session, batch_id)

    await run_attempt(attempt_id)

    assert await _attempt_outcome(db_session, attempt_id) == ("completed", None)
    assert llm.calls, "the UI batch never reached the model"
    assert {e.ctx.key_scope for e in sink.entries} == {"global_service"}


@pytest.mark.asyncio
async def test_keyless_host_row_passes_the_start_rung_but_never_unlocks_the_deployment_key(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A user host row with a base_url and no key counts as the caller's own
    credential at start; at execution the ladder skips it (a host's row is
    never a bare provider key), and an agent batch still gets no deployment key."""
    from app.schemas.llm_target import LlmTarget
    from app.services.engine_credentials import resolve_engine_credentials
    from app.services.llm_connection_service import KeyScope, availability_map
    from tests.integration.helpers.engine_setup import make_host_connection

    monkeypatch.setattr("app.services.llm_connection_service.global_key_for", lambda _p: "sk-test")
    await make_host_connection(db_session, api_key=None)
    engine = LlmTarget(provider="openai_compatible", model="endpoint-model-x")
    ids = {"user_id": SEED.primary_profile, "project_id": SEED.primary_project}

    available = await availability_map(db_session, providers=[engine.provider], **ids)
    refused = await resolve_engine_credentials(
        db_session, engine=engine, allow_global_key=False, **ids
    )
    default = await resolve_engine_credentials(db_session, engine=engine, **ids)

    assert available == {engine.provider: "user"}
    assert (refused.api_key, refused.key_scope) == (None, None)
    assert default.key_scope is KeyScope.GLOBAL_SERVICE, "the ladder would have fallen through"


# --- agent guards (ADR 0021): token, policy, engine, before each advance ------

_AGENT_PROVIDER, _AGENT_MODEL = settings.LLM_PROVIDER, settings.LLM_DEFAULT_MODEL


async def _set_policy(db: AsyncSession, agent_runs: str) -> None:
    from app.schemas.ai_policy import AiPolicyUpdateRequest
    from app.services import ai_policy_service

    await ai_policy_service.set_for_project(
        db,
        project_id=SEED.primary_project,
        update=AiPolicyUpdateRequest(
            agent_runs=agent_runs,  # type: ignore[arg-type]
            max_articles_per_run=25,
            daily_agent_article_cap=100,
        ),
        user_id=SEED.primary_profile,
    )


async def _agent_batch(
    db: AsyncSession, count: int, *, owner: UUID = SEED.primary_profile
) -> tuple[UUID, UUID]:
    """An agent-started batch whose token, policy and engine all still allow it."""
    from app.schemas.llm_target import EngineIdentity
    from tests.integration.helpers.engine_setup import set_project_engine
    from tests.integration.helpers.pat_rows import insert_pat_row

    await set_project_engine(db, _AGENT_PROVIDER, _AGENT_MODEL)
    await _set_policy(db, "reviewers")
    token_id = await insert_pat_row(db, "agent-guard")
    engine = EngineIdentity(
        provider=_AGENT_PROVIDER, model=_AGENT_MODEL, mode="fast", connection_id=None
    )
    articles = [await make_article(db, SEED.primary_project, f"G{i}") for i in range(count)]
    batch_id = await make_batch(
        db,
        owner_id=owner,
        project_id=SEED.primary_project,
        template_id=SEED.primary_template,
        article_ids=articles,
        agent_token_id=str(token_id),
        agent_engine=engine.model_dump_json(),
        agent_plan_digest=uuid4().hex,
    )
    await db.commit()
    return batch_id, token_id


async def _stop(db: AsyncSession, batch_id: UUID) -> tuple[str | None, str | None]:
    row = (
        await db.execute(
            text("SELECT stop_code, stop_message FROM public.extraction_batches WHERE id=:b"),
            {"b": str(batch_id)},
        )
    ).one()
    return row[0], row[1]


async def _state(db: AsyncSession, batch_id: UUID, owner: UUID = SEED.primary_profile) -> str:
    from app.services.extraction_batch_service import ExtractionBatchService

    detail = await ExtractionBatchService(db).detail(owner, batch_id, now=datetime.now(UTC))
    return detail.state


async def _assert_guard_stop(
    db: AsyncSession, batch_id: UUID, queue: FakeQueue, code: str, count: int
) -> None:
    assert (await _stop(db, batch_id))[0] == code
    assert [(s, r) for s, r, _ in await _items(db, batch_id)] == [
        ("cancelled", "STOPPED_AGENT_GUARD")
    ] * count
    assert queue.calls == []


_TOKEN_KILLS = {
    "revoked": "UPDATE public.personal_access_tokens SET revoked_at = now() WHERE id = :tid",
    "expired": (
        "UPDATE public.personal_access_tokens "
        "SET created_at = now() - interval '2 days', expires_at = now() - interval '1 minute' "
        "WHERE id = :tid"
    ),
    "banned": "UPDATE auth.users SET banned_until = now() + interval '1 day' WHERE id = :uid",
}


@pytest.mark.asyncio
@pytest.mark.parametrize("kill", list(_TOKEN_KILLS), ids=list(_TOKEN_KILLS))
async def test_inactive_token_stops_agent_batch(db_session: AsyncSession, kill: str) -> None:
    batch_id, token_id = await _agent_batch(db_session, 2)
    await db_session.execute(
        text(_TOKEN_KILLS[kill]), {"tid": str(token_id), "uid": str(SEED.primary_profile)}
    )
    await db_session.commit()
    queue = FakeQueue()

    await ExtractionBatchDispatcher(db_session, enqueue=queue).advance(batch_id)

    await _assert_guard_stop(db_session, batch_id, queue, "AGENT_TOKEN_INACTIVE", 2)
    assert (await _stop(db_session, batch_id))[1] == (
        "The access token that started this run was revoked or expired."
    )
    assert await _state(db_session, batch_id) == "stopped"


@pytest.mark.asyncio
async def test_deleted_token_row_leaves_agent_token_id_null_and_stops(
    db_session: AsyncSession,
) -> None:
    batch_id, token_id = await _agent_batch(db_session, 1)
    await db_session.execute(
        text("DELETE FROM public.personal_access_tokens WHERE id = :tid"), {"tid": str(token_id)}
    )
    token_after = (
        await db_session.execute(
            text("SELECT agent_token_id FROM public.extraction_batches WHERE id=:b"),
            {"b": str(batch_id)},
        )
    ).scalar_one()
    assert token_after is None, "precondition: the FK nulls the column"
    queue = FakeQueue()

    await ExtractionBatchDispatcher(db_session, enqueue=queue).advance(batch_id)

    await _assert_guard_stop(db_session, batch_id, queue, "AGENT_TOKEN_INACTIVE", 1)


@pytest.mark.asyncio
async def test_policy_off_stops_agent_batch(db_session: AsyncSession) -> None:
    batch_id, _ = await _agent_batch(db_session, 2)
    await _set_policy(db_session, "off")
    await db_session.commit()
    queue = FakeQueue()

    await ExtractionBatchDispatcher(db_session, enqueue=queue).advance(batch_id)

    await _assert_guard_stop(db_session, batch_id, queue, "AGENT_RUNS_DISABLED", 2)
    assert (await _stop(db_session, batch_id))[1] == (
        "A project manager turned off agent-started runs."
    )


@pytest.mark.asyncio
async def test_policy_managers_stops_reviewer_owned_agent_batch(db_session: AsyncSession) -> None:
    batch_id, _ = await _agent_batch(db_session, 1, owner=SEED.reviewer_profile)
    await _set_policy(db_session, "managers")
    await db_session.commit()
    queue = FakeQueue()

    await ExtractionBatchDispatcher(db_session, enqueue=queue).advance(batch_id)

    await _assert_guard_stop(db_session, batch_id, queue, "AGENT_RUNS_DISABLED", 1)


@pytest.mark.asyncio
async def test_policy_managers_keeps_manager_owned_agent_batch_running(
    db_session: AsyncSession,
) -> None:
    batch_id, _ = await _agent_batch(db_session, 1)
    await _set_policy(db_session, "managers")
    await db_session.commit()
    queue = FakeQueue()

    await ExtractionBatchDispatcher(db_session, enqueue=queue).advance(batch_id)

    assert await _stop(db_session, batch_id) == (None, None)
    assert len(queue.calls) == 1


@pytest.mark.asyncio
async def test_engine_change_stops_agent_batch(db_session: AsyncSession) -> None:
    from tests.integration.helpers.engine_setup import set_project_engine

    batch_id, _ = await _agent_batch(db_session, 2)
    await set_project_engine(db_session, _AGENT_PROVIDER, _AGENT_MODEL, mode="verified")
    await db_session.commit()
    queue = FakeQueue()

    await ExtractionBatchDispatcher(db_session, enqueue=queue).advance(batch_id)

    await _assert_guard_stop(db_session, batch_id, queue, "AGENT_ENGINE_CHANGED", 2)
    assert (await _stop(db_session, batch_id))[1] == (
        "The project's AI engine changed after this run was approved."
    )


@pytest.mark.asyncio
async def test_retired_engine_stops_agent_batch_as_engine_retired(
    db_session: AsyncSession,
) -> None:
    batch_id, _ = await _agent_batch(db_session, 1)
    await db_session.execute(
        text(
            "UPDATE public.projects SET settings = COALESCE(settings, '{}'::jsonb) "
            '|| CAST(\'{"llm_engine": {"provider": "openai", "model": "gpt-long-gone"}}\' '
            "AS jsonb) WHERE id = :pid"
        ),
        {"pid": str(SEED.primary_project)},
    )
    await db_session.commit()
    queue = FakeQueue()

    await ExtractionBatchDispatcher(db_session, enqueue=queue).advance(batch_id)

    code, message = await _stop(db_session, batch_id)
    assert code == "ENGINE_RETIRED" and message and "gpt-long-gone" in message
    assert [(s, r) for s, r, _ in await _items(db_session, batch_id)] == [
        ("cancelled", "STOPPED_AGENT_GUARD")
    ]
    assert queue.calls == []


@pytest.mark.asyncio
async def test_in_flight_items_finish_after_a_guard_stop(db_session: AsyncSession) -> None:
    batch_id, token_id = await _agent_batch(db_session, 3)
    queue = FakeQueue()
    dispatcher = ExtractionBatchDispatcher(db_session, enqueue=queue)
    await dispatcher.advance(batch_id)
    assert [s for s, _, _ in await _items(db_session, batch_id)] == [
        "dispatched",
        "dispatched",
        "queued",
    ], "precondition: every guard passed and two items are in flight"
    await db_session.execute(
        text("UPDATE public.personal_access_tokens SET revoked_at = now() WHERE id = :tid"),
        {"tid": str(token_id)},
    )
    await db_session.commit()

    await dispatcher.advance(batch_id)

    items = await _items(db_session, batch_id)
    assert [(s, r) for s, r, _ in items] == [
        ("dispatched", None),
        ("dispatched", None),
        ("cancelled", "STOPPED_AGENT_GUARD"),
    ]
    live = (
        await db_session.execute(
            text("SELECT count(*) FROM public.extraction_attempts WHERE id = ANY(:ids)"),
            {"ids": [items[0][2], items[1][2]]},
        )
    ).scalar_one()
    assert live == 2 and len(queue.calls) == 2
    assert await _state(db_session, batch_id) == "active", "in-flight items still run"


@pytest.mark.asyncio
async def test_ui_batch_ignores_agent_guards(db_session: AsyncSession) -> None:
    await _set_policy(db_session, "off")
    batch_id, _ = await _batch(db_session, 2)
    queue = FakeQueue()

    await ExtractionBatchDispatcher(db_session, enqueue=queue).advance(batch_id)

    assert await _stop(db_session, batch_id) == (None, None)
    assert [s for s, _, _ in await _items(db_session, batch_id)] == ["dispatched"] * 2


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("stop_code", "item_reason"),
    [
        ("MISSING_API_KEY", "STOPPED_ENGINE_ERROR"),
        ("ENGINE_RETIRED", "STOPPED_ENGINE_ERROR"),
        ("AGENT_TOKEN_INACTIVE", "STOPPED_AGENT_GUARD"),
        ("AGENT_RUNS_DISABLED", "STOPPED_AGENT_GUARD"),
        ("AGENT_ENGINE_CHANGED", "STOPPED_AGENT_GUARD"),
    ],
    ids=["missing-key", "retired", "token", "policy", "engine"],
)
async def test_a_stopped_batch_cancels_queued_items_with_the_reason_of_its_stop(
    db_session: AsyncSession, stop_code: str, item_reason: str
) -> None:
    batch_id, _ = await _batch(db_session, 1, stop_code=stop_code)
    queue = FakeQueue()

    await ExtractionBatchDispatcher(db_session, enqueue=queue).advance(batch_id)

    assert [(s, r) for s, r, _ in await _items(db_session, batch_id)] == [
        ("cancelled", item_reason)
    ]
    assert queue.calls == []


@pytest.mark.asyncio
async def test_a_cancel_landing_during_the_guard_check_is_not_overwritten(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The stop is a conditional write: a cancel that lands between the batch
    read and the stop keeps the batch cancelled, never also stopped."""
    batch_id, token_id = await _agent_batch(db_session, 1)
    real_guard = dispatcher_module.agent_stop_reason

    async def cancel_then_check(db: AsyncSession, batch):  # noqa: ANN001, ANN202
        await db.execute(
            text("UPDATE public.extraction_batches SET cancelled_at = now() WHERE id = :b"),
            {"b": str(batch_id)},
        )
        await db.execute(
            text(
                "UPDATE public.extraction_batch_items SET status = 'cancelled', "
                "reason_code = 'CANCELLED' WHERE batch_id = :b AND status = 'queued'"
            ),
            {"b": str(batch_id)},
        )
        await db.execute(
            text("UPDATE public.personal_access_tokens SET revoked_at = now() WHERE id = :tid"),
            {"tid": str(token_id)},
        )
        return await real_guard(db, batch)

    monkeypatch.setattr(dispatcher_module, "agent_stop_reason", cancel_then_check)
    queue = FakeQueue()

    await ExtractionBatchDispatcher(db_session, enqueue=queue).advance(batch_id)

    assert await _stop(db_session, batch_id) == (None, None)
    assert [(s, r) for s, r, _ in await _items(db_session, batch_id)] == [
        ("cancelled", "CANCELLED")
    ]
    assert await _state(db_session, batch_id) == "cancelled"
    assert queue.calls == []
