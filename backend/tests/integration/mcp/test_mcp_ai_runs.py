"""plan_ai_run: a read-only, grant-gated preview of an AI extraction run."""

from __future__ import annotations

import base64
import hashlib
import json
import re
from typing import Any
from uuid import uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, settings
from app.utils.compact_json import RESULT_CAP, compact_json
from app.worker import queue_health
from tests.integration.conftest import SEED
from tests.integration.helpers.batch_fixtures import make_article, make_batch
from tests.integration.mcp.ai_run_helpers import plan_args as _args
from tests.integration.mcp.ai_run_helpers import ready_article as _article
from tests.integration.mcp.ai_run_helpers import ready_env
from tests.integration.mcp.ai_run_helpers import set_policy as _policy
from tests.integration.mcp.ai_run_helpers import set_rung as _rung
from tests.integration.mcp.article_seed import insert_pdf
from tests.integration.mcp.conftest import _seed_pat
from tests.integration.mcp.tool_calls import call_tool, error_payload, structured

_TOKEN = re.compile(r"^aip1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$")


@pytest.fixture(autouse=True)
def _ready_env(monkeypatch: pytest.MonkeyPatch) -> None:
    ready_env(monkeypatch)


def _payload(token: str) -> dict[str, Any]:
    segment = token.split(".")[1]
    return json.loads(base64.urlsafe_b64decode(segment + "=" * (-len(segment) % 4)))


def _blockers(plan: dict) -> list[tuple[str, str | None]]:
    return [(b["code"], b["reason_code"]) for b in plan["blockers"]]


async def test_ready_plan_defaults_the_template_and_mints_a_bound_token(
    mcp_client, pat_primary_rw_ai_run, db_session: AsyncSession
) -> None:
    await _policy(db_session)
    first, second = await _article(db_session, "ready one"), await _article(db_session, "ready two")
    await db_session.flush()
    actions = "SELECT count(*) FROM public.agent_actions"
    before = (await db_session.execute(text(actions))).scalar_one()

    plan = structured(
        await call_tool(mcp_client, pat_primary_rw_ai_run, "plan_ai_run", _args(first, second))
    )

    assert plan["template"]["id"] == str(SEED.primary_template)
    assert plan["can_start"] is True and plan["blockers"] == []
    assert plan["payer"] == "your_key"
    assert plan["counts"] == {
        "requested": 2,
        "will_run": 2,
        "skipped": 0,
        "remaining_beyond_cap": 0,
    }
    assert _TOKEN.match(plan["plan_token"])
    claims = _payload(plan["plan_token"])
    expected_digest = hashlib.sha256(
        "".join(sorted([str(first), str(second)])).encode()
    ).hexdigest()
    assert claims["will_run_digest"] == expected_digest
    assert claims["will_run_count"] == plan["counts"]["will_run"] == 2
    assert claims["token_id"] == str(pat_primary_rw_ai_run.principal.token_id)
    assert claims["project_id"] == str(SEED.primary_project)
    assert plan["confirm"]["article_count"] == 2
    assert plan["confirm"]["payer"] == "your_key"
    assert plan["confirm"]["model"] == f"{plan['engine']['provider']}:{plan['engine']['model']}"
    assert "AI only adds suggestions" in plan["confirmation"]
    assert plan["expires_at"] is not None
    assert "plan-suite-key" not in json.dumps(plan)
    assert not db_session.new and not db_session.dirty
    assert (await db_session.execute(text(actions))).scalar_one() == before


async def test_no_active_extraction_template_lists_the_templates(
    mcp_client, pat_primary_rw_ai_run, db_session: AsyncSession
) -> None:
    await _policy(db_session)
    await db_session.execute(
        text(
            "UPDATE public.project_extraction_templates SET is_active = false WHERE project_id = :p"
        ),
        {"p": str(SEED.primary_project)},
    )

    err = error_payload(
        await call_tool(mcp_client, pat_primary_rw_ai_run, "plan_ai_run", _args(uuid4()))
    )

    assert err["code"] == "INVALID_ARGUMENT"
    assert err["field"] == "template_id"
    assert isinstance(err["templates"], list)
    assert err["untrusted_fields"] == ["templates[].name"]


@pytest.mark.parametrize(
    ("rung", "payer", "blocker"),
    [
        ("user", "your_key", None),
        ("project", "project_key", None),
        ("global", None, ("AI_NOT_CONFIGURED", "DEPLOYMENT_KEY_NOT_ALLOWED")),
        (None, None, ("AI_NOT_CONFIGURED", "MISSING_API_KEY")),
    ],
    ids=["user-key", "project-key", "deployment-only", "no-key"],
)
async def test_payer_follows_the_credential_rung(
    mcp_client,
    pat_primary_rw_ai_run,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
    rung: str | None,
    payer: str | None,
    blocker: tuple[str, str] | None,
) -> None:
    _rung(monkeypatch, rung)
    await _policy(db_session)
    article = await _article(db_session)

    plan = structured(
        await call_tool(mcp_client, pat_primary_rw_ai_run, "plan_ai_run", _args(article))
    )

    assert plan["payer"] == payer
    if blocker is None:
        assert plan["can_start"] is True
    else:
        assert blocker in _blockers(plan)
        assert plan["can_start"] is False and plan["plan_token"] is None
        assert plan["confirm"] is None and plan["confirmation"] is None


_BLOCKER_CASES = [
    "AGENT_RUNS_OFF",
    "MANAGERS_ONLY",
    "TEMPLATE_NOT_PUBLISHED",
    "AI_RUN_ACTIVE",
    "AI_RUN_LIMIT",
    "SERVICE_UNAVAILABLE",
    "NOTHING_TO_RUN",
]


@pytest.mark.parametrize("case", _BLOCKER_CASES, ids=_BLOCKER_CASES)
async def test_blocker_matrix(
    mcp_client,
    pat_primary_rw_ai_run,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
    case: str,
) -> None:
    pat = pat_primary_rw_ai_run
    await _policy(
        db_session,
        {"AGENT_RUNS_OFF": "off", "MANAGERS_ONLY": "managers"}.get(case, "reviewers"),
        daily=1 if case == "AI_RUN_LIMIT" else 100,
    )
    articles = [await _article(db_session, pdf=case != "NOTHING_TO_RUN")]
    batch_id = None
    if case == "MANAGERS_ONLY":
        pat = await _seed_pat(db_session, SEED.reviewer_profile, "read_write", ai_run=True)
    elif case == "TEMPLATE_NOT_PUBLISHED":
        await db_session.execute(
            text(
                "UPDATE public.extraction_template_versions SET is_active = false "
                "WHERE project_template_id = :t"
            ),
            {"t": str(SEED.primary_template)},
        )
    elif case == "AI_RUN_ACTIVE":
        batch_id = await make_batch(
            db_session,
            owner_id=SEED.primary_profile,
            project_id=SEED.primary_project,
            template_id=SEED.primary_template,
            article_ids=[await make_article(db_session, SEED.primary_project, "queued")],
        )
    elif case == "AI_RUN_LIMIT":
        articles.append(await _article(db_session, "second"))
    elif case == "SERVICE_UNAVAILABLE":
        monkeypatch.setattr(queue_health, "is_queue_available", lambda: False)

    plan = structured(await call_tool(mcp_client, pat, "plan_ai_run", _args(*articles)))

    codes = [b["code"] for b in plan["blockers"]]
    assert case in codes
    assert plan["can_start"] is False and plan["plan_token"] is None
    row = next(b for b in plan["blockers"] if b["code"] == case)
    assert row["message"] and row["fix"]
    if case == "AI_RUN_ACTIVE":
        assert row["batch_id"] == str(batch_id)
    if case == "AI_RUN_LIMIT":
        assert row["reason_code"] == "DAILY_CAP"
        assert plan["limits"]["daily_remaining"] == 1
    if case == "NOTHING_TO_RUN":
        assert plan["articles"] == [
            {
                "article_id": str(articles[0]),
                "title": "plan article",
                "will_run": False,
                "reason_code": "NO_PDF",
            }
        ]
        assert plan["skipped_by_reason"] == {"NO_PDF": 1}


async def test_warnings_carry_static_messages(
    mcp_client, pat_primary_rw_ai_run, db_session: AsyncSession
) -> None:
    await _policy(db_session)
    unparsed = await make_article(db_session, SEED.primary_project, "unparsed")
    await insert_pdf(db_session, SEED.primary_project, unparsed)

    plan = structured(
        await call_tool(mcp_client, pat_primary_rw_ai_run, "plan_ai_run", _args(unparsed))
    )

    warning = next(w for w in plan["warnings"] if w["code"] == "ARTICLES_UNPARSED")
    assert warning["message"]


async def test_one_hundred_articles_fit_the_result_cap(
    mcp_client, pat_primary_rw_ai_run, db_session: AsyncSession
) -> None:
    await _policy(db_session, per_run=100, daily=1000)
    ids = [await _article(db_session, f"{i:03d} " + "T" * 300) for i in range(100)]

    result = await call_tool(mcp_client, pat_primary_rw_ai_run, "plan_ai_run", _args(*ids))
    plan = structured(result)

    assert plan["can_start"] is True
    assert len(plan["articles"]) == 100
    assert all(len(row["title"]) <= 80 for row in plan["articles"])
    assert len(compact_json(plan)) <= RESULT_CAP
    assert len(plan["plan_token"]) <= 4096


async def test_placeholder_key_outside_local_mints_nothing(
    mcp_client, pat_primary_rw_ai_run, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "ENCRYPTION_KEY", Settings.model_fields["ENCRYPTION_KEY"].default)
    monkeypatch.setattr(settings, "SUPABASE_ENV", None)
    await _policy(db_session)
    article = await _article(db_session)

    plan = structured(
        await call_tool(mcp_client, pat_primary_rw_ai_run, "plan_ai_run", _args(article))
    )

    assert plan["blockers"] == []
    assert plan["can_start"] is False
    assert plan["plan_token"] is None and plan["expires_at"] is None


async def test_hints_are_read_only(mcp_client, pat_primary_rw_ai_run) -> None:
    async with mcp_client(pat_primary_rw_ai_run) as client:
        tool = next(t for t in (await client.list_tools()).tools if t.name == "plan_ai_run")
    a = tool.annotations
    assert (a.read_only_hint, a.destructive_hint, a.idempotent_hint, a.open_world_hint) == (
        True,
        False,
        True,
        False,
    )
    assert "anthropic/requiresUserInteraction" not in (tool.meta or {})


async def test_foreign_article_is_not_found(
    mcp_client, pat_primary_rw_ai_run, db_session: AsyncSession
) -> None:
    await _policy(db_session)
    foreign = await make_article(db_session, SEED.secondary_project, "foreign")

    err = error_payload(
        await call_tool(mcp_client, pat_primary_rw_ai_run, "plan_ai_run", _args(foreign))
    )

    assert err["code"] == "NOT_FOUND"


async def test_hidden_and_refused_without_the_grant(mcp_client, pat_primary_rw) -> None:
    async with mcp_client(pat_primary_rw) as client:
        names = {t.name for t in (await client.list_tools()).tools}

    err = error_payload(await call_tool(mcp_client, pat_primary_rw, "plan_ai_run", _args(uuid4())))

    assert "plan_ai_run" not in names
    assert err["code"] == "SCOPE_INSUFFICIENT"
    assert err["required_scope"] == "ai_run"


async def test_viewer_is_refused(mcp_client, pat_viewer_ai_run) -> None:
    err = error_payload(
        await call_tool(mcp_client, pat_viewer_ai_run, "plan_ai_run", _args(uuid4()))
    )

    assert err["code"] == "REVIEWER_REQUIRED"
