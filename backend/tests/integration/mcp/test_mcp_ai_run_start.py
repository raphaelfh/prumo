"""start_ai_run: starts exactly the run a fresh plan described, or refuses with a typed code."""

from __future__ import annotations

import base64
import json
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.mcp import ai_run_plan_token
from app.api.mcp.tools import ai_runs
from app.services.extraction_batch_service import ExtractionBatchService
from app.services.template_versioning import TemplateVersionService
from app.worker import queue_health
from tests.integration.conftest import SEED
from tests.integration.helpers.batch_fixtures import make_article, make_batch
from tests.integration.mcp.ai_run_helpers import (
    ready_article,
    ready_env,
    ready_plan,
    set_policy,
    set_rung,
    start_args,
)
from tests.integration.mcp.conftest import _seed_pat
from tests.integration.mcp.tool_calls import call_tool, error_payload, structured
from tests.integration.test_extraction_batch_guards import _ai_proposal, _extract_run


class _Pg(Exception):
    sqlstate = "40P01"


@pytest.fixture(autouse=True)
def _ready(monkeypatch: pytest.MonkeyPatch) -> None:
    ready_env(monkeypatch)


@pytest.fixture
def kicks(monkeypatch: pytest.MonkeyPatch) -> list[UUID]:
    seen: list[UUID] = []
    monkeypatch.setattr(ai_runs, "kick_batch", seen.append)
    return seen


async def _count(db: AsyncSession, sql: str, **params: Any) -> int:
    return (await db.execute(text(sql), {k: str(v) for k, v in params.items()})).scalar_one()


async def _batches(db: AsyncSession) -> int:
    return await _count(
        db,
        "SELECT count(*) FROM public.extraction_batches WHERE agent_plan_digest IS NOT NULL",
    )


async def _actions(db: AsyncSession, outcome: str, code: str | None = None) -> int:
    sql = "SELECT count(*) FROM public.agent_actions WHERE tool = 'start_ai_run' AND outcome = :o"
    if code is None:
        return await _count(db, sql, o=outcome)
    return await _count(db, sql + " AND error_code = :c", o=outcome, c=code)


async def _two_articles(db: AsyncSession) -> tuple[UUID, UUID]:
    await set_policy(db)
    return await ready_article(db, "start one"), await ready_article(db, "start two")


async def _start(mcp_client, pat, plan: dict, **override: Any):
    return await call_tool(mcp_client, pat, "start_ai_run", start_args(plan, **override))


async def test_a_fresh_plan_starts_its_batch_with_one_applied_row(
    mcp_client, pat_primary_rw_ai_run, db_session: AsyncSession, kicks: list[UUID]
) -> None:
    first, second = await _two_articles(db_session)
    plan = await ready_plan(mcp_client, pat_primary_rw_ai_run, first, second)

    started = structured(await _start(mcp_client, pat_primary_rw_ai_run, plan))

    assert started["replayed"] is False
    assert started["state"] == "active"
    assert started["counts"]["total"] == 2
    assert started["payer"] == "your_key"
    assert (
        f"{started['engine']['provider']}:{started['engine']['model']}" == plan["confirm"]["model"]
    )
    assert started["engine"]["mode"] == plan["engine"]["mode"]
    assert "do not poll" in started["note"]
    row = (
        await db_session.execute(
            text(
                "SELECT agent_token_id, agent_engine, agent_plan_digest, template_id "
                "FROM public.extraction_batches WHERE id = :id"
            ),
            {"id": started["batch_id"]},
        )
    ).one()
    assert row.agent_token_id == pat_primary_rw_ai_run.principal.token_id
    assert row.agent_engine["model"] == plan["engine"]["model"]
    _claims, digest = ai_run_plan_token.verify(plan["plan_token"], now=datetime.now(UTC))
    assert row.agent_plan_digest == digest
    assert row.template_id == SEED.primary_template
    assert await _actions(db_session, "applied") == 1
    applied = (
        await db_session.execute(
            text(
                "SELECT template_id, after FROM public.agent_actions "
                "WHERE tool = 'start_ai_run' AND outcome = 'applied'"
            )
        )
    ).one()
    assert applied.template_id == SEED.primary_template
    assert applied.after["batch_id"] == started["batch_id"]
    assert kicks == [UUID(started["batch_id"])]


async def test_the_kick_runs_after_the_commit(
    mcp_client, pat_primary_rw_ai_run, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    first, second = await _two_articles(db_session)
    plan = await ready_plan(mcp_client, pat_primary_rw_ai_run, first, second)
    events: list[str] = []
    real_commit = AsyncSession.commit

    async def commit(self: AsyncSession) -> None:
        await real_commit(self)
        events.append("commit")

    monkeypatch.setattr(AsyncSession, "commit", commit)
    monkeypatch.setattr(ai_runs, "kick_batch", lambda _batch_id: events.append("kick"))

    structured(await _start(mcp_client, pat_primary_rw_ai_run, plan))

    assert events == ["commit", "kick"]


async def test_a_failed_commit_leaves_neither_batch_nor_row(
    mcp_client,
    pat_primary_rw_ai_run,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
    kicks: list[UUID],
) -> None:
    first, second = await _two_articles(db_session)
    plan = await ready_plan(mcp_client, pat_primary_rw_ai_run, first, second)
    real_commit = AsyncSession.commit
    calls: list[int] = []

    async def commit_fails_once(self: AsyncSession) -> None:
        calls.append(1)
        if len(calls) == 1:
            raise RuntimeError("commit lost")
        await real_commit(self)

    monkeypatch.setattr(AsyncSession, "commit", commit_fails_once)

    err = error_payload(await _start(mcp_client, pat_primary_rw_ai_run, plan))

    assert err["code"] == "INTERNAL_ERROR"
    assert await _batches(db_session) == 0
    assert await _actions(db_session, "applied") == 0
    assert kicks == []


async def test_a_replay_returns_the_same_batch_without_a_second_row(
    mcp_client, pat_primary_rw_ai_run, db_session: AsyncSession, kicks: list[UUID]
) -> None:
    first, second = await _two_articles(db_session)
    plan = await ready_plan(mcp_client, pat_primary_rw_ai_run, first, second)
    started = structured(await _start(mcp_client, pat_primary_rw_ai_run, plan))

    again = structured(await _start(mcp_client, pat_primary_rw_ai_run, plan))

    assert again["batch_id"] == started["batch_id"]
    assert again["replayed"] is True
    assert await _batches(db_session) == 1
    assert await _actions(db_session, "applied") == 1
    assert len(kicks) == 1


@pytest.mark.parametrize(
    ("column", "value", "reason"),
    [
        ("agent_token_id", "other_token", "other_token"),
        (
            "agent_engine",
            '{"provider":"x","model":"y","mode":"fast","connection_id":null}',
            "changed",
        ),
    ],
    ids=["token", "engine"],
)
async def test_a_replay_refuses_a_batch_of_another_token_or_engine(
    mcp_client,
    pat_primary_rw_ai_run,
    pat_primary_read_ai_run,
    db_session: AsyncSession,
    kicks: list[UUID],
    column: str,
    value: str,
    reason: str,
) -> None:
    first, second = await _two_articles(db_session)
    plan = await ready_plan(mcp_client, pat_primary_rw_ai_run, first, second)
    started = structured(await _start(mcp_client, pat_primary_rw_ai_run, plan))
    if column == "agent_token_id":
        value = str(pat_primary_read_ai_run.principal.token_id)
    cast = "jsonb" if column == "agent_engine" else "uuid"
    await db_session.execute(
        text(f"UPDATE public.extraction_batches SET {column} = CAST(:v AS {cast}) WHERE id = :id"),
        {"v": value, "id": started["batch_id"]},
    )

    err = error_payload(await _start(mcp_client, pat_primary_rw_ai_run, plan))

    assert err["code"] == "PLAN_STALE"
    assert err["reason"] == reason
    assert len(kicks) == 1


async def test_a_payer_change_is_stale(
    mcp_client,
    pat_primary_rw_ai_run,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
    kicks: list[UUID],
) -> None:
    first, second = await _two_articles(db_session)
    plan = await ready_plan(mcp_client, pat_primary_rw_ai_run, first, second)
    set_rung(monkeypatch, "project")  # the user key is gone; the project key remains

    err = error_payload(await _start(mcp_client, pat_primary_rw_ai_run, plan))

    assert err["code"] == "PLAN_STALE"
    assert err["reason"] == "changed"
    assert err["changes"] == ["payer"]
    assert err["retryable"] is False
    assert await _batches(db_session) == 0
    assert await _actions(db_session, "refused", "PLAN_STALE") == 1
    assert kicks == []


async def test_a_deadlock_is_a_retry(
    mcp_client, pat_primary_rw_ai_run, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    first, second = await _two_articles(db_session)
    plan = await ready_plan(mcp_client, pat_primary_rw_ai_run, first, second)

    async def deadlock(*_a: Any, **_k: Any) -> None:
        raise DBAPIError("INSERT", {}, _Pg())

    monkeypatch.setattr(ExtractionBatchService, "start", deadlock)

    err = error_payload(await _start(mcp_client, pat_primary_rw_ai_run, plan))

    assert err["code"] == "RETRY"
    assert err["retryable"] is True
    assert await _batches(db_session) == 0


def _tampered(token: str) -> str:
    prefix, payload, mac = token.split(".")
    claims = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
    claims["will_run_count"] = 1
    edited = base64.urlsafe_b64encode(json.dumps(claims, separators=(",", ":")).encode())
    return f"{prefix}.{edited.rstrip(b'=').decode()}.{mac}"


async def test_a_tampered_token_is_stale(
    mcp_client, pat_primary_rw_ai_run, db_session: AsyncSession
) -> None:
    first, second = await _two_articles(db_session)
    plan = await ready_plan(mcp_client, pat_primary_rw_ai_run, first, second)

    err = error_payload(
        await _start(
            mcp_client,
            pat_primary_rw_ai_run,
            plan,
            plan_token=_tampered(plan["plan_token"]),
            expected_article_count=1,
        )
    )

    assert (err["code"], err["reason"]) == ("PLAN_STALE", "invalid")
    assert await _batches(db_session) == 0
    assert await _actions(db_session, "refused", "PLAN_STALE") == 1


async def test_an_expired_token_is_stale(
    mcp_client, pat_primary_rw_ai_run, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    first, second = await _two_articles(db_session)
    plan = await ready_plan(mcp_client, pat_primary_rw_ai_run, first, second)
    later = datetime.now(UTC) + timedelta(minutes=31)
    real_verify = ai_run_plan_token.verify
    monkeypatch.setattr(
        ai_run_plan_token, "verify", lambda token, *, now: real_verify(token, now=max(now, later))
    )

    err = error_payload(await _start(mcp_client, pat_primary_rw_ai_run, plan))

    assert (err["code"], err["reason"]) == ("PLAN_STALE", "expired")


async def test_a_plan_of_another_token_is_stale(
    mcp_client, pat_primary_rw_ai_run, pat_primary_read_ai_run, db_session: AsyncSession
) -> None:
    first, second = await _two_articles(db_session)
    plan = await ready_plan(mcp_client, pat_primary_read_ai_run, first, second)

    err = error_payload(await _start(mcp_client, pat_primary_rw_ai_run, plan))

    assert (err["code"], err["reason"]) == ("PLAN_STALE", "other_token")


async def test_a_foreign_project_template_in_the_plan_is_stale(
    mcp_client, pat_primary_rw_ai_run, db_session: AsyncSession
) -> None:
    """A plan minted for the primary project cannot start in the secondary one."""
    first, second = await _two_articles(db_session)
    plan = await ready_plan(mcp_client, pat_primary_rw_ai_run, first, second)

    err = error_payload(
        await _start(
            mcp_client, pat_primary_rw_ai_run, plan, project_id=str(SEED.secondary_project)
        )
    )

    assert (err["code"], err["reason"]) == ("PLAN_STALE", "invalid")
    assert await _batches(db_session) == 0


@pytest.mark.parametrize(
    "override",
    [
        {"expected_article_count": 1},
        {"expected_model": "other:model"},
        {"expected_payer": "project_key"},
    ],
    ids=["count", "model", "payer"],
)
async def test_an_echo_mismatch_is_stale(
    mcp_client, pat_primary_rw_ai_run, db_session: AsyncSession, override: dict
) -> None:
    first, second = await _two_articles(db_session)
    plan = await ready_plan(mcp_client, pat_primary_rw_ai_run, first, second)

    err = error_payload(await _start(mcp_client, pat_primary_rw_ai_run, plan, **override))

    assert (err["code"], err["reason"]) == ("PLAN_STALE", "echo_mismatch")
    assert err["plan"] == {
        "article_count": 2,
        "model": plan["confirm"]["model"],
        "payer": "your_key",
    }


async def test_an_ai_suggestion_added_after_the_plan_is_stale(
    mcp_client, pat_primary_rw_ai_run, db_session: AsyncSession
) -> None:
    first, second = await _two_articles(db_session)
    plan = await ready_plan(mcp_client, pat_primary_rw_ai_run, first, second)
    await _ai_proposal(db_session, await _extract_run(db_session, first), first)

    err = error_payload(await _start(mcp_client, pat_primary_rw_ai_run, plan))

    assert (err["code"], err["reason"]) == ("PLAN_STALE", "changed")
    assert err["changes"] == ["articles"]


async def test_a_republished_template_is_stale(
    mcp_client, pat_primary_rw_ai_run, db_session: AsyncSession
) -> None:
    first, second = await _two_articles(db_session)
    plan = await ready_plan(mcp_client, pat_primary_rw_ai_run, first, second)
    await TemplateVersionService(db_session).republish(
        project_id=SEED.primary_project,
        project_template_id=SEED.primary_template,
        user_id=SEED.primary_profile,
    )

    err = error_payload(await _start(mcp_client, pat_primary_rw_ai_run, plan))

    assert (err["code"], err["reason"]) == ("PLAN_STALE", "changed")
    assert err["changes"] == ["template_version"]


@pytest.mark.parametrize("agent_runs", ["off", "managers"])
async def test_a_withdrawn_policy_refuses_with_its_value(
    mcp_client, db_session: AsyncSession, agent_runs: str
) -> None:
    reviewer = await _seed_pat(db_session, SEED.reviewer_profile, "read_write", ai_run=True)
    first, second = await _two_articles(db_session)
    plan = await ready_plan(mcp_client, reviewer, first, second)
    await set_policy(db_session, agent_runs)

    err = error_payload(await _start(mcp_client, reviewer, plan))

    assert err["code"] == "AI_RUNS_NOT_ALLOWED"
    assert err["agent_runs"] == agent_runs
    assert await _batches(db_session) == 0
    assert await _actions(db_session, "refused", "AI_RUNS_NOT_ALLOWED") == 1


async def test_a_removed_key_is_not_configured(
    mcp_client,
    pat_primary_rw_ai_run,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    first, second = await _two_articles(db_session)
    plan = await ready_plan(mcp_client, pat_primary_rw_ai_run, first, second)
    set_rung(monkeypatch, None)

    err = error_payload(await _start(mcp_client, pat_primary_rw_ai_run, plan))

    assert err["code"] == "AI_NOT_CONFIGURED"
    assert err["reason_code"] == "MISSING_API_KEY"
    assert await _actions(db_session, "refused", "AI_NOT_CONFIGURED") == 1


async def test_an_active_batch_refuses_with_its_id(
    mcp_client, pat_primary_rw_ai_run, db_session: AsyncSession
) -> None:
    first, second = await _two_articles(db_session)
    plan = await ready_plan(mcp_client, pat_primary_rw_ai_run, first, second)
    batch_id = await make_batch(
        db_session,
        owner_id=SEED.primary_profile,
        project_id=SEED.primary_project,
        template_id=SEED.primary_template,
        article_ids=[await make_article(db_session, SEED.primary_project, "queued")],
    )

    err = error_payload(await _start(mcp_client, pat_primary_rw_ai_run, plan))

    assert err["code"] == "AI_RUN_ACTIVE"
    assert err["batch_id"] == str(batch_id)
    assert await _actions(db_session, "refused", "AI_RUN_ACTIVE") == 1


async def test_a_spent_daily_cap_is_a_limit(
    mcp_client, pat_primary_rw_ai_run, db_session: AsyncSession
) -> None:
    first, second = await _two_articles(db_session)
    plan = await ready_plan(mcp_client, pat_primary_rw_ai_run, first, second)
    await set_policy(db_session, per_run=10, daily=1)

    err = error_payload(await _start(mcp_client, pat_primary_rw_ai_run, plan))

    assert err["code"] == "AI_RUN_LIMIT"
    assert err["remaining_today"] == 1
    assert err["max_articles_per_run"] == 10
    assert await _actions(db_session, "refused", "AI_RUN_LIMIT") == 1


async def test_a_dead_queue_is_retryable_and_unaudited(
    mcp_client,
    pat_primary_rw_ai_run,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    first, second = await _two_articles(db_session)
    plan = await ready_plan(mcp_client, pat_primary_rw_ai_run, first, second)
    monkeypatch.setattr(queue_health, "is_queue_available", lambda: False)

    err = error_payload(await _start(mcp_client, pat_primary_rw_ai_run, plan))

    assert err["code"] == "SERVICE_UNAVAILABLE"
    assert err["retryable"] is True
    assert await _batches(db_session) == 0
    assert await _actions(db_session, "refused") == 0


async def test_a_foreign_article_in_the_plan_is_not_found(
    mcp_client, pat_primary_rw_ai_run, db_session: AsyncSession
) -> None:
    first, second = await _two_articles(db_session)
    plan = await ready_plan(mcp_client, pat_primary_rw_ai_run, first, second)
    await db_session.execute(
        text("UPDATE public.articles SET project_id = :p WHERE id = :a"),
        {"p": str(SEED.secondary_project), "a": str(first)},
    )

    err = error_payload(await _start(mcp_client, pat_primary_rw_ai_run, plan))

    assert err["code"] == "NOT_FOUND"
    assert await _actions(db_session, "refused") == 0


async def test_a_nul_is_an_audited_invalid_argument(
    mcp_client, pat_primary_rw_ai_run, db_session: AsyncSession
) -> None:
    first, second = await _two_articles(db_session)
    plan = await ready_plan(mcp_client, pat_primary_rw_ai_run, first, second)

    err = error_payload(
        await _start(mcp_client, pat_primary_rw_ai_run, plan, expected_model="a\x00b")
    )

    assert (err["code"], err["field"]) == ("INVALID_ARGUMENT", "expected_model")
    assert await _actions(db_session, "refused", "INVALID_ARGUMENT") == 1


async def test_hints_are_destructive_open_world_and_need_the_user(
    mcp_client, pat_primary_rw_ai_run
) -> None:
    async with mcp_client(pat_primary_rw_ai_run) as client:
        tool = next(t for t in (await client.list_tools()).tools if t.name == "start_ai_run")
    a = tool.annotations
    assert (a.read_only_hint, a.destructive_hint, a.idempotent_hint, a.open_world_hint) == (
        False,
        True,
        True,
        True,
    )
    assert tool.meta["anthropic/requiresUserInteraction"] is True
    assert tool.input_schema["properties"]["plan_token"]["maxLength"] == 4096


async def test_hidden_and_refused_without_the_grant(mcp_client, pat_primary_rw) -> None:
    async with mcp_client(pat_primary_rw) as client:
        names = {t.name for t in (await client.list_tools()).tools}

    err = error_payload(
        await call_tool(
            mcp_client,
            pat_primary_rw,
            "start_ai_run",
            {
                "project_id": str(SEED.primary_project),
                "plan_token": "aip1.x.y",
                "expected_article_count": 1,
                "expected_model": "a:b",
                "expected_payer": "your_key",
            },
        )
    )

    assert "start_ai_run" not in names
    assert (err["code"], err["required_scope"]) == ("SCOPE_INSUFFICIENT", "ai_run")
