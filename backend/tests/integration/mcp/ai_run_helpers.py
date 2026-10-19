"""Shared setup for the agent AI run tool suites (plan_ai_run, start_ai_run)."""

from __future__ import annotations

from typing import Any
from uuid import UUID

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.schemas.ai_policy import AiPolicyUpdateRequest
from app.services import ai_policy_service, engine_credentials, llm_connection_service
from app.worker import queue_health
from tests.integration.conftest import SEED
from tests.integration.helpers.batch_fixtures import make_article
from tests.integration.mcp.article_seed import insert_pdf
from tests.integration.mcp.tool_calls import call_tool, structured


def set_rung(monkeypatch: pytest.MonkeyPatch, rung: str | None) -> None:
    """Every provider resolves its key at ``rung`` (``None``: no key at all)."""

    async def availability(_db: Any, *, providers: list[str], **_kw: Any) -> dict:
        return dict.fromkeys(providers, rung)

    monkeypatch.setattr(engine_credentials, "availability_map", availability)
    monkeypatch.setattr(llm_connection_service, "availability_map", availability)


def ready_env(monkeypatch: pytest.MonkeyPatch) -> None:
    """A user key, a live queue and a non-placeholder signing key."""
    set_rung(monkeypatch, "user")
    monkeypatch.setattr(queue_health, "is_queue_available", lambda: True)
    monkeypatch.setattr(settings, "ENCRYPTION_KEY", "plan-suite-key")


async def set_policy(
    db: AsyncSession,
    agent_runs: str = "reviewers",
    *,
    per_run: int = 25,
    daily: int = 100,
    project_id: UUID | None = None,
) -> None:
    await ai_policy_service.set_for_project(
        db,
        project_id=project_id or SEED.primary_project,
        update=AiPolicyUpdateRequest(
            agent_runs=agent_runs,  # type: ignore[arg-type]
            max_articles_per_run=per_run,
            daily_agent_article_cap=daily,
        ),
        user_id=SEED.primary_profile,
    )


async def ready_article(
    db: AsyncSession,
    title: str = "plan article",
    *,
    pdf: bool = True,
    project_id: UUID | None = None,
) -> UUID:
    """An article with a parsed PDF (``pdf=False``: no PDF at all)."""
    project = project_id or SEED.primary_project
    article_id = await make_article(db, project, title)
    if pdf:
        file_id = await insert_pdf(db, project, article_id)
        await db.execute(
            text("UPDATE public.article_files SET content_markdown = 'body' WHERE id = :id"),
            {"id": str(file_id)},
        )
    return article_id


def plan_args(*article_ids: UUID, **extra: Any) -> dict[str, Any]:
    return {
        "project_id": str(SEED.primary_project),
        "article_ids": [str(a) for a in article_ids],
        **extra,
    }


async def ready_plan(mcp_client: Any, pat: Any, *article_ids: UUID, **extra: Any) -> dict:
    plan = structured(
        await call_tool(mcp_client, pat, "plan_ai_run", plan_args(*article_ids, **extra))
    )
    assert plan["can_start"] is True, plan["blockers"]
    return plan


def start_args(plan: dict, **override: Any) -> dict[str, Any]:
    """``start_ai_run`` arguments echoing ``plan`` unchanged."""
    return {
        "project_id": plan["project"]["id"],
        "plan_token": plan["plan_token"],
        "expected_article_count": plan["confirm"]["article_count"],
        "expected_model": plan["confirm"]["model"],
        "expected_payer": plan["confirm"]["payer"],
        **override,
    }
