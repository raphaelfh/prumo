"""``build_plan``: the read-only plan core shared by plan_ai_run and start_ai_run.

Called directly on ``db_session``; the credential ladder and the queue probe
are pinned, ``now`` is injected. One test per stated requirement.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any
from uuid import UUID, uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.llm.catalog import selectable_catalog
from app.models.extraction import ExtractionRunStage
from app.schemas.ai_policy import AiPolicyUpdateRequest
from app.schemas.llm_target import EngineIdentity
from app.services import ai_policy_service, engine_credentials, llm_connection_service
from app.services.ai_run_plan_service import PlanCore, build_plan
from app.services.llm_engine_service import resolve_engine
from app.services.template_versioning import TemplateVersionService
from app.worker import queue_health
from tests.integration.conftest import SEED
from tests.integration.helpers.batch_fixtures import make_article, make_batch
from tests.integration.helpers.engine_setup import set_project_engine
from tests.integration.helpers.template_fixtures import add_section
from tests.integration.mcp.article_seed import insert_pdf
from tests.integration.test_extraction_batch_guards import (
    _ai_proposal,
    _created_run,
    _extract_run,
    _park,
)


def _rung(monkeypatch: pytest.MonkeyPatch, rung: str | None) -> None:
    async def availability(_db: Any, *, providers: list[str], **_kw: Any) -> dict:
        return dict.fromkeys(providers, rung)

    monkeypatch.setattr(engine_credentials, "availability_map", availability)
    monkeypatch.setattr(llm_connection_service, "availability_map", availability)
    monkeypatch.setattr(queue_health, "is_queue_available", lambda: True)


@pytest.fixture(autouse=True)
def own_key(monkeypatch: pytest.MonkeyPatch) -> None:
    _rung(monkeypatch, "user")


async def _policy(
    db: AsyncSession, *, agent_runs: str = "reviewers", per_run: int = 25, daily: int = 100
) -> None:
    await ai_policy_service.set_for_project(
        db,
        project_id=SEED.primary_project,
        update=AiPolicyUpdateRequest(
            agent_runs=agent_runs,  # type: ignore[arg-type]
            max_articles_per_run=per_run,
            daily_agent_article_cap=daily,
        ),
        user_id=SEED.primary_profile,
    )


async def _plan(
    db: AsyncSession,
    article_ids: list[UUID] | None,
    *,
    rerun: bool = False,
    caller_is_manager: bool = True,
) -> PlanCore:
    return await build_plan(
        db,
        owner_id=SEED.primary_profile,
        project_id=SEED.primary_project,
        template_id=SEED.primary_template,
        article_ids=article_ids,
        rerun=rerun,
        caller_is_manager=caller_is_manager,
        now=datetime.now(UTC),
    )


async def _ready_article(db: AsyncSession, title: str, markdown: str | None = None) -> UUID:
    article_id = await make_article(db, SEED.primary_project, title)
    file_id = await insert_pdf(db, SEED.primary_project, article_id)
    if markdown is not None:
        await db.execute(
            text("UPDATE public.article_files SET content_markdown = :m WHERE id = :id"),
            {"m": markdown, "id": str(file_id)},
        )
    return article_id


def _blocker_codes(plan: PlanCore) -> list[tuple[str, str | None, UUID | None]]:
    return [(b.code, b.reason_code, b.batch_id) for b in plan.blockers]


async def test_explicit_ids_over_the_per_run_cap_block(db_session: AsyncSession) -> None:
    await _policy(db_session, per_run=3)
    ids = [await _ready_article(db_session, f"cap {i}") for i in range(4)]

    over = await _plan(db_session, ids)
    within = await _plan(db_session, ids[:3])

    assert ("AI_RUN_LIMIT", "MAX_ARTICLES_PER_RUN", None) in _blocker_codes(over)
    assert not any(b.code == "AI_RUN_LIMIT" for b in within.blockers)


async def test_explicit_ids_dedupe_keeps_order(db_session: AsyncSession) -> None:
    await _policy(db_session)
    a = await _ready_article(db_session, "dedupe a")
    b = await _ready_article(db_session, "dedupe b")

    plan = await _plan(db_session, [b, a, b])

    assert plan.requested == 2
    assert plan.will_run_ids == [b, a]
    assert plan.selection == [b, a]


async def test_remaining_orders_by_title_then_id_and_cuts_at_the_cap(
    db_session: AsyncSession,
) -> None:
    await _policy(db_session, per_run=3)
    before = await _plan(db_session, None)
    baseline = before.requested + before.remaining_beyond_cap

    c = await _ready_article(db_session, "C")
    a1 = await _ready_article(db_session, "A")
    b = await _ready_article(db_session, "B")
    a2 = await _ready_article(db_session, "A")
    await _ready_article(db_session, "D")
    finalized = await _ready_article(db_session, "A")
    await _park(db_session, await _created_run(db_session, finalized), ExtractionRunStage.FINALIZED)
    suggested = await _ready_article(db_session, "AA")
    await _ai_proposal(db_session, await _extract_run(db_session, suggested), suggested)
    low, high = sorted([a1, a2])

    plan = await _plan(db_session, None)
    rerun = await _plan(db_session, None, rerun=True)

    assert plan.selection == "remaining"
    assert plan.will_run_ids == [low, high, b]
    assert plan.remaining_beyond_cap == baseline + 5 - 3
    assert finalized not in plan.skipped and suggested not in plan.skipped
    assert c not in plan.will_run_ids
    assert rerun.will_run_ids == [low, high, suggested]


async def test_daily_remaining_counts_agent_items(db_session: AsyncSession) -> None:
    await _policy(db_session, daily=10)
    used = [await make_article(db_session, SEED.primary_project, f"used {i}") for i in range(7)]
    await make_batch(
        db_session,
        owner_id=SEED.primary_profile,
        project_id=SEED.primary_project,
        template_id=SEED.primary_template,
        article_ids=used,
        agent_engine=EngineIdentity(
            provider="openai", model="m", mode="fast", connection_id=None
        ).model_dump_json(),
        agent_plan_digest=f"daily-{uuid4().hex}",
        cancelled_at=datetime.now(UTC),
    )
    fresh = [await _ready_article(db_session, f"fresh {i}") for i in range(4)]

    plan = await _plan(db_session, fresh)
    fits = await _plan(db_session, fresh[:3])

    assert plan.daily_remaining == 3
    assert ("AI_RUN_LIMIT", "DAILY_CAP", None) in _blocker_codes(plan)
    assert not any(b.reason_code == "DAILY_CAP" for b in fits.blockers)


async def _estimate_seed(db: AsyncSession, monkeypatch: pytest.MonkeyPatch) -> list[UUID]:
    """Primary template republished with 2 top-level sections and 1 child;
    three will-run articles: 4,000 chars, 1,000 chars, unparsed."""
    monkeypatch.setattr(settings, "LLM_ASSEMBLY_BUDGET_TOKENS", 500)
    top = await add_section(db, SEED.primary_template, "estimate top")
    await add_section(db, SEED.primary_template, "estimate child", parent_id=top)
    await TemplateVersionService(db).republish(
        project_id=SEED.primary_project,
        project_template_id=SEED.primary_template,
        user_id=SEED.primary_profile,
    )
    top_level = (
        await db.execute(
            text(
                "SELECT count(*) FROM public.extraction_entity_types "
                "WHERE project_template_id = :t AND parent_entity_type_id IS NULL"
            ),
            {"t": str(SEED.primary_template)},
        )
    ).scalar_one()
    assert top_level == 2  # precondition: the seed ships one top-level section
    return [
        await _ready_article(db, "est long", "x" * 4000),
        await _ready_article(db, "est short", "y" * 1000),
        await _ready_article(db, "est unparsed"),
    ]


async def test_estimate_lower_bound_standard_mode(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    await _policy(db_session)
    ids = await _estimate_seed(db_session, monkeypatch)

    plan = await _plan(db_session, ids)

    assert plan.will_run_ids == ids
    assert plan.estimate.passes == 1
    assert plan.estimate.input_tokens_low == (500 + 250) * 2 * 1
    assert plan.estimate.llm_calls_low == 3 * 2 * 1
    assert "VERIFIED_MODE_TWO_PASSES" not in plan.warnings


async def test_estimate_doubles_in_verified_mode(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    await _policy(db_session)
    entry = selectable_catalog()[0]
    await set_project_engine(db_session, entry.provider, entry.model, mode="verified")
    ids = await _estimate_seed(db_session, monkeypatch)

    plan = await _plan(db_session, ids)

    assert plan.estimate.passes == 2
    assert plan.estimate.input_tokens_low == 3000
    assert plan.estimate.llm_calls_low == 12
    assert "VERIFIED_MODE_TWO_PASSES" in plan.warnings


async def _picots_off(db: AsyncSession) -> None:
    await db.execute(
        text(
            "UPDATE public.projects SET settings = coalesce(settings, '{}'::jsonb) "
            '|| \'{"ai_context": {"picots": false}}\'::jsonb WHERE id = :p'
        ),
        {"p": str(SEED.primary_project)},
    )


async def _placeholder_instruction(db: AsyncSession) -> None:
    await db.execute(
        text(
            "UPDATE public.project_extraction_templates "
            "SET llm_template_instruction = 'Focus on [customize: outcome]' WHERE id = :t"
        ),
        {"t": str(SEED.primary_template)},
    )


async def _clean_instruction(db: AsyncSession) -> None:
    await db.execute(
        text(
            "UPDATE public.project_extraction_templates "
            "SET llm_template_instruction = 'Focus on outcomes' WHERE id = :t"
        ),
        {"t": str(SEED.primary_template)},
    )


@pytest.mark.parametrize(
    "warning",
    ["PICOTS_OFF_OR_EMPTY", "TEMPLATE_INSTRUCTION_PLACEHOLDERS", "ARTICLES_UNPARSED"],
    ids=["picots", "placeholders", "unparsed"],
)
async def test_each_warning_has_its_trigger(db_session: AsyncSession, warning: str) -> None:
    await _policy(db_session)
    await _clean_instruction(db_session)
    parsed = await _ready_article(db_session, "warn parsed", "text")
    # PICOTS' absence needs a review question: its own test below.
    absent = await _plan(db_session, [parsed]) if warning != "PICOTS_OFF_OR_EMPTY" else None
    if warning == "PICOTS_OFF_OR_EMPTY":
        await _picots_off(db_session)
        ids = [parsed]
    elif warning == "TEMPLATE_INSTRUCTION_PLACEHOLDERS":
        await _placeholder_instruction(db_session)
        ids = [parsed]
    else:
        ids = [parsed, await _ready_article(db_session, "warn unparsed")]

    plan = await _plan(db_session, ids)

    assert warning in plan.warnings
    if absent is not None:
        assert warning not in absent.warnings
    assert len(plan.warnings) == len(set(plan.warnings))


async def test_picots_warning_absent_when_the_review_question_is_set(
    db_session: AsyncSession,
) -> None:
    await _policy(db_session)
    await db_session.execute(
        text(
            "UPDATE public.projects SET picots_config_ai_review = "
            '\'{"population": {"description": "Adults with asthma"}}\'::jsonb WHERE id = :p'
        ),
        {"p": str(SEED.primary_project)},
    )
    plan = await _plan(db_session, [await _ready_article(db_session, "picots on", "text")])

    assert "PICOTS_OFF_OR_EMPTY" not in plan.warnings


async def test_plan_carries_the_policy_and_engine_identity(db_session: AsyncSession) -> None:
    await _policy(db_session, agent_runs="managers", per_run=7, daily=42)

    plan = await _plan(db_session, [await _ready_article(db_session, "identity", "t")])

    assert (plan.agent_runs, plan.daily_cap, plan.max_articles_per_run) == ("managers", 42, 7)
    target = await resolve_engine(db_session, SEED.primary_project, SEED.primary_profile)
    assert plan.engine_identity == EngineIdentity.from_target(target)
    assert plan.payer == "your_key"


async def test_build_plan_writes_nothing(db_session: AsyncSession) -> None:
    await _policy(db_session)
    article = await _ready_article(db_session, "pure", "t")
    await db_session.flush()

    await _plan(db_session, [article])
    await _plan(db_session, None, rerun=True)

    assert not db_session.new and not db_session.dirty
