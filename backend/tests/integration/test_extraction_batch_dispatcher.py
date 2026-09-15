"""Dispatcher (spec §8, G6–G12, G16): real session runs and attempts, fake queue."""

from __future__ import annotations

from datetime import UTC, datetime
from types import SimpleNamespace
from uuid import UUID, uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.extraction_batch_dispatcher import ExtractionBatchDispatcher, batch_request_id
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
    item = SimpleNamespace(id=uuid4())

    assert await dispatcher._run_reason(batch, item, uuid4(), "finalized") == "RUN_FINALIZED"
    assert await dispatcher._run_reason(batch, item, uuid4(), "consensus") == "RUN_NOT_EDITABLE"
    assert await dispatcher._run_reason(batch, item, uuid4(), "extract") is None


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
