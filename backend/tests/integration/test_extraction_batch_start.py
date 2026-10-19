"""``ExtractionBatchService.start`` for agent-started batches (0093).

An agent start records its origin, never runs on the deployment key, holds
the project's agent-start lock, replays an already-started plan instead of
writing a second batch, and respects the daily agent article cap — also
under concurrency, where only committed sessions on separate connections
can prove it.
"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID, uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.core.config import settings
from app.schemas.extraction_batch import CreateExtractionBatchRequest
from app.schemas.llm_target import EngineIdentity
from app.services import engine_credentials
from app.services.extraction_batch_service import (
    AgentRunOrigin,
    DailyAgentCapError,
    ExtractionBatchService,
    StartResult,
)
from app.services.llm_connection_service import MissingCredentialError
from app.worker import queue_health
from tests.integration.conftest import SEED
from tests.integration.helpers.batch_fixtures import make_article, make_batch
from tests.integration.helpers.pat_rows import insert_pat_row

ENGINE = EngineIdentity(
    provider="openai", model="gpt-test", mode="fast", connection_id=None, payer="your_key"
)


def _rung(monkeypatch: pytest.MonkeyPatch, rung: str) -> None:
    """Every provider resolves to ``rung``; the queue answers."""

    async def availability(_db: Any, *, providers: list[str], **_kw: Any) -> dict:
        return dict.fromkeys(providers, rung)

    monkeypatch.setattr(engine_credentials, "availability_map", availability)
    monkeypatch.setattr(queue_health, "is_queue_available", lambda: True)


@pytest.fixture
def own_key(monkeypatch: pytest.MonkeyPatch) -> None:
    _rung(monkeypatch, "user")


def _agent(token_id: UUID, digest: str | None = None, *, cap: int = 100) -> AgentRunOrigin:
    return AgentRunOrigin(
        token_id=token_id, engine=ENGINE, plan_digest=digest or uuid4().hex, daily_cap=cap
    )


def _request(
    article_ids: list[UUID],
    *,
    project_id: UUID = SEED.primary_project,
    template_id: UUID = SEED.primary_template,
) -> CreateExtractionBatchRequest:
    return CreateExtractionBatchRequest(
        project_id=project_id, template_id=template_id, article_ids=article_ids
    )


async def _articles(db: AsyncSession, count: int, project_id: UUID = SEED.primary_project):
    return [await make_article(db, project_id, f"agent article {i}") for i in range(count)]


async def _origin(db: AsyncSession, batch_id: UUID) -> tuple[Any, ...]:
    return tuple(
        (
            await db.execute(
                text(
                    "SELECT agent_token_id, agent_engine, agent_plan_digest "
                    "FROM public.extraction_batches WHERE id = :id"
                ),
                {"id": str(batch_id)},
            )
        ).one()
    )


async def _batches_for_digest(db: AsyncSession, digest: str) -> int:
    return (
        await db.execute(
            text("SELECT count(*) FROM public.extraction_batches WHERE agent_plan_digest = :d"),
            {"d": digest},
        )
    ).scalar_one()


@pytest.mark.asyncio
@pytest.mark.usefixtures("own_key")
async def test_agent_start_writes_origin(db_session: AsyncSession) -> None:
    token_id = await insert_pat_row(db_session)
    agent = _agent(token_id)
    result = await ExtractionBatchService(db_session).start(
        SEED.primary_profile, _request(await _articles(db_session, 2)), agent=agent
    )
    assert result.replayed is False
    assert await _origin(db_session, result.batch_id) == (
        token_id,
        {
            "provider": "openai",
            "model": "gpt-test",
            "mode": "fast",
            "connection_id": None,
            "endpoint_sha256": None,
            "payer": "your_key",
        },
        agent.plan_digest,
    )


@pytest.mark.asyncio
async def test_agent_start_refuses_deployment_key(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    _rung(monkeypatch, "global")
    token_id = await insert_pat_row(db_session)
    agent = _agent(token_id)
    articles = await _articles(db_session, 1)
    service = ExtractionBatchService(db_session)

    with pytest.raises(MissingCredentialError) as refused:
        await service.start(SEED.primary_profile, _request(articles), agent=agent)
    assert refused.value.details == {"reason": "DEPLOYMENT_KEY_NOT_ALLOWED"}
    assert await _batches_for_digest(db_session, agent.plan_digest) == 0

    rest = await service.start(SEED.primary_profile, _request(articles))
    assert rest == StartResult(batch_id=rest.batch_id, replayed=False)
    assert await _origin(db_session, rest.batch_id) == (None, None, None)


@pytest.mark.asyncio
@pytest.mark.usefixtures("own_key")
async def test_daily_cap_counts_agent_items_in_24h(db_session: AsyncSession) -> None:
    articles = await _articles(db_session, 95)
    engine_json = ENGINE.model_dump_json()
    for digest, created_at, ids in (
        ("recent", datetime.now(UTC) - timedelta(hours=1), articles),
        ("old", datetime.now(UTC) - timedelta(hours=30), articles[:50]),
    ):
        # Cancelled, so neither blocks the tool; the cap still counts them.
        await make_batch(
            db_session,
            owner_id=SEED.primary_profile,
            project_id=SEED.primary_project,
            template_id=SEED.primary_template,
            article_ids=ids,
            agent_engine=engine_json,
            agent_plan_digest=f"{digest}-{uuid4().hex}",
            created_at=created_at,
            cancelled_at=created_at,
        )
    token_id = await insert_pat_row(db_session)
    service = ExtractionBatchService(db_session)
    fresh = await _articles(db_session, 6)

    with pytest.raises(DailyAgentCapError) as capped:
        await service.start(SEED.primary_profile, _request(fresh), agent=_agent(token_id, cap=100))
    assert capped.value.args == (5,)

    started = await service.start(
        SEED.primary_profile, _request(fresh[:5]), agent=_agent(token_id, cap=100)
    )
    assert started.replayed is False


@pytest.mark.asyncio
@pytest.mark.usefixtures("own_key")
async def test_agent_start_replays_a_started_plan(db_session: AsyncSession) -> None:
    token_id = await insert_pat_row(db_session)
    agent = _agent(token_id)
    service = ExtractionBatchService(db_session)
    request = _request(await _articles(db_session, 3))

    first = await service.start(SEED.primary_profile, request, agent=agent)
    again = await service.start(SEED.primary_profile, request, agent=agent)

    assert again == StartResult(batch_id=first.batch_id, replayed=True)
    assert await _batches_for_digest(db_session, agent.plan_digest) == 1
    items = (
        await db_session.execute(
            text("SELECT count(*) FROM public.extraction_batch_items WHERE batch_id = :b"),
            {"b": str(first.batch_id)},
        )
    ).scalar_one()
    assert items == 3


@pytest.mark.asyncio
@pytest.mark.usefixtures("own_key")
async def test_batch_for_plan_is_owner_and_project_scoped(db_session: AsyncSession) -> None:
    token_id = await insert_pat_row(db_session)
    agent = _agent(token_id)
    service = ExtractionBatchService(db_session)
    started = await service.start(
        SEED.primary_profile, _request(await _articles(db_session, 1)), agent=agent
    )

    assert (
        await service.batch_for_plan(
            SEED.primary_profile, agent.plan_digest, project_id=SEED.primary_project
        )
        == started.batch_id
    )
    assert (
        await service.batch_for_plan(
            SEED.reviewer_profile, agent.plan_digest, project_id=SEED.primary_project
        )
        is None
    )
    assert (
        await service.batch_for_plan(
            SEED.primary_profile, agent.plan_digest, project_id=SEED.secondary_project
        )
        is None
    )


# --- committed sessions on separate connections -----------------------------


@dataclass(frozen=True)
class _World:
    sessions: async_sessionmaker[AsyncSession]
    project_id: UUID
    templates: tuple[UUID, UUID]
    articles: list[UUID]
    token_id: UUID


@asynccontextmanager
async def _committed_world(article_count: int) -> AsyncIterator[_World]:
    """A throwaway project (owner = primary profile, a manager), two tools,
    ``article_count`` articles and a PAT, all committed; deleted afterwards."""
    engine = create_async_engine(settings.async_database_url, poolclass=NullPool)
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    project_id, templates = uuid4(), (uuid4(), uuid4())
    token_id = None
    try:
        async with sessions() as db:
            await db.execute(
                text(
                    "INSERT INTO public.projects (id, name, created_by_id) "
                    "VALUES (:id, 'agent-start-race', :u)"
                ),
                {"id": str(project_id), "u": str(SEED.primary_profile)},
            )
            await db.execute(
                text(
                    "INSERT INTO public.project_members (project_id, user_id, role) "
                    "VALUES (:p, :u, 'manager')"
                ),
                {"p": str(project_id), "u": str(SEED.primary_profile)},
            )
            for template_id in templates:
                await db.execute(
                    text(
                        "INSERT INTO public.project_extraction_templates "
                        "(id, project_id, name, framework, kind, schema, is_active, created_by) "
                        "VALUES (:id, :p, :n, 'CUSTOM', 'extraction', '{}'::jsonb, false, :u)"
                    ),
                    {
                        "id": str(template_id),
                        "p": str(project_id),
                        "n": f"race {template_id}",
                        "u": str(SEED.primary_profile),
                    },
                )
                await db.execute(
                    text(
                        "INSERT INTO public.extraction_template_versions "
                        "(project_template_id, version, schema, published_by, is_active) "
                        "VALUES (:t, 1, '{\"entity_types\": []}'::jsonb, :u, true)"
                    ),
                    {"t": str(template_id), "u": str(SEED.primary_profile)},
                )
            articles = await _articles(db, article_count, project_id)
            token_id = await insert_pat_row(db, "agent-start-race")
            await db.commit()
        yield _World(sessions, project_id, templates, articles, token_id)
    finally:
        async with sessions() as db:
            await db.execute(
                text("DELETE FROM public.projects WHERE id = :id"), {"id": str(project_id)}
            )
            if token_id is not None:
                await db.execute(
                    text("DELETE FROM public.personal_access_tokens WHERE id = :id"),
                    {"id": str(token_id)},
                )
            await db.commit()
        await engine.dispose()


async def _start_and_commit(
    world: _World, request: CreateExtractionBatchRequest, agent: AgentRunOrigin
) -> StartResult:
    async with world.sessions() as db:
        result = await ExtractionBatchService(db).start(SEED.primary_profile, request, agent=agent)
        await db.commit()
        return result


@pytest.mark.asyncio
@pytest.mark.usefixtures("own_key")
async def test_concurrent_agent_starts_over_the_cap_one_wins() -> None:
    async with _committed_world(120) as world:
        outcomes = await asyncio.gather(
            *(
                _start_and_commit(
                    world,
                    _request(
                        world.articles[offset : offset + 60],
                        project_id=world.project_id,
                        template_id=template_id,
                    ),
                    _agent(world.token_id, cap=100),
                )
                for offset, template_id in zip((0, 60), world.templates, strict=True)
            ),
            return_exceptions=True,
        )
        started = [o for o in outcomes if isinstance(o, StartResult)]
        capped = [o for o in outcomes if isinstance(o, DailyAgentCapError)]
        assert len(started) == 1 and len(capped) == 1, outcomes
        assert capped[0].args == (40,)
        async with world.sessions() as db:
            committed = (
                await db.execute(
                    text("SELECT count(*) FROM public.extraction_batches WHERE project_id = :p"),
                    {"p": str(world.project_id)},
                )
            ).scalar_one()
        assert committed == 1


@pytest.mark.asyncio
@pytest.mark.usefixtures("own_key")
async def test_concurrent_same_plan_starts_write_one_batch() -> None:
    async with _committed_world(3) as world:
        agent = _agent(world.token_id)
        request = _request(
            world.articles, project_id=world.project_id, template_id=world.templates[0]
        )
        outcomes = await asyncio.gather(
            _start_and_commit(world, request, agent),
            _start_and_commit(world, request, agent),
            return_exceptions=True,
        )
        assert all(isinstance(o, StartResult) for o in outcomes), outcomes
        assert sorted(o.replayed for o in outcomes) == [False, True]
        assert outcomes[0].batch_id == outcomes[1].batch_id
        async with world.sessions() as db:
            assert await _batches_for_digest(db, agent.plan_digest) == 1


# --- cancel is a conditional transition -------------------------------------


async def _cancel_and_commit(world: _World, batch_id: UUID, now: datetime) -> int | None:
    async with world.sessions() as db:
        cancelled = await ExtractionBatchService(db).cancel(
            SEED.primary_profile, batch_id, now=now, project_id=world.project_id
        )
        await db.commit()
        return cancelled


@pytest.mark.asyncio
async def test_concurrent_service_cancels_apply_once() -> None:
    async with _committed_world(3) as world:
        async with world.sessions() as db:
            batch_id = await make_batch(
                db,
                owner_id=SEED.primary_profile,
                project_id=world.project_id,
                template_id=world.templates[0],
                article_ids=world.articles,
            )
            await db.commit()
        first, second = datetime(2026, 1, 1, tzinfo=UTC), datetime(2026, 1, 2, tzinfo=UTC)

        outcomes = await asyncio.gather(
            _cancel_and_commit(world, batch_id, first),
            _cancel_and_commit(world, batch_id, second),
            return_exceptions=True,
        )

        applied = [o for o in outcomes if isinstance(o, int)]
        assert applied == [3] and outcomes.count(None) == 1, outcomes
        winner = first if outcomes[0] == 3 else second
        async with world.sessions() as db:
            cancelled_at = (
                await db.execute(
                    text("SELECT cancelled_at FROM public.extraction_batches WHERE id = :id"),
                    {"id": str(batch_id)},
                )
            ).scalar_one()
        assert cancelled_at == winner


@pytest.mark.asyncio
async def test_cancel_after_stop_writes_nothing(db_session: AsyncSession) -> None:
    articles = await _articles(db_session, 2)
    batch_id = await make_batch(
        db_session,
        owner_id=SEED.primary_profile,
        project_id=SEED.primary_project,
        template_id=SEED.primary_template,
        article_ids=articles,
        stop_code="MISSING_API_KEY",
    )

    cancelled = await ExtractionBatchService(db_session).cancel(
        SEED.primary_profile, batch_id, now=datetime.now(UTC), project_id=SEED.primary_project
    )

    row = (
        await db_session.execute(
            text(
                "SELECT b.cancelled_at, array_agg(i.status ORDER BY i.created_at) "
                "FROM public.extraction_batches b "
                "JOIN public.extraction_batch_items i ON i.batch_id = b.id "
                "WHERE b.id = :id GROUP BY b.cancelled_at"
            ),
            {"id": str(batch_id)},
        )
    ).one()
    assert cancelled is None
    assert row[0] is None
    assert list(row[1]) == ["queued", "queued"]
