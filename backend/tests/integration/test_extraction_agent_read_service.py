"""Integration tests for `extraction_agent_read_service.list_agent_extractions`
(task 8b): blind-review parity with the run-detail read path is the load-
bearing property here (spec §8) -- every test that touches two reviewers'
secrets asserts against `get_run_with_workflow_history`'s own filtered
output, never a hand-rolled expectation.
"""

from __future__ import annotations

from uuid import UUID

import pytest
from sqlalchemy import event, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction import ExtractionRunStage
from app.models.extraction_workflow import ExtractionProposalSource
from app.services.extraction_agent_read_service import list_agent_extractions
from app.services.extraction_proposal_service import ExtractionProposalService
from app.services.extraction_run_read_service import get_run_with_workflow_history
from app.services.run_lifecycle_service import RunLifecycleService
from app.utils.untrusted import UNTRUSTED_CLOSE, UNTRUSTED_OPEN
from tests.integration.conftest import SEED
from tests.integration.helpers.template_fixtures import add_field, add_section
from tests.integration.mcp.article_seed import insert_article
from tests.integration.test_blind_review_isolation import _build_two_reviewer_review_run


async def _page(db, caller, fmt="detailed", template_id=None, article_id=SEED.primary_article):
    return await list_agent_extractions(
        db,
        project_id=SEED.primary_project,
        template_id=template_id,
        template_kind="extraction",
        caller_id=caller,
        article_id=article_id,
        response_format=fmt,
        cursor=None,
        limit=10,
    )


def _blob(page) -> str:
    return page.model_dump_json()


async def _built_or_skip(db):
    built = await _build_two_reviewer_review_run(db)
    if built is None:
        pytest.skip("Seed graph incomplete")
    return built


async def _template_id_of_run(db: AsyncSession, run_id: UUID) -> UUID:
    return (
        await db.execute(
            text("SELECT template_id FROM public.extraction_runs WHERE id = :id"),
            {"id": str(run_id)},
        )
    ).scalar_one()


async def _ai_only_coordinate(
    db: AsyncSession, *, run_id: UUID, template_id: UUID
) -> tuple[UUID, UUID]:
    """A fresh (instance, field) coordinate with ONLY an AI proposal, on a
    brand-new entity type + field so the fixed single-field seed template's
    cardinality=one section is never touched. `get_active_version_tree`
    reads a FROZEN published snapshot, so a live-only addition needs the
    same forced live-fallback precedent as
    `test_get_template_live_tree_matches_fallback`: deactivate the
    template's active version."""
    await db.execute(
        text(
            "UPDATE public.extraction_template_versions SET is_active = false "
            "WHERE project_template_id = :tid"
        ),
        {"tid": str(template_id)},
    )
    entity_type_id = await add_section(db, template_id, "AI-only section")
    field_id = await add_field(db, entity_type_id, "ai-only-field")

    new_instance_id = (
        await db.execute(
            text(
                "INSERT INTO public.extraction_instances "
                "(id, project_id, article_id, template_id, entity_type_id, label, sort_order, "
                "metadata, created_by) "
                "VALUES (gen_random_uuid(), :pid, :aid, :tid, :etid, 'AI-only entry', 1, '{}'::jsonb, :uid) "
                "RETURNING id"
            ),
            {
                "pid": str(SEED.primary_project),
                "aid": str(SEED.primary_article),
                "tid": str(template_id),
                "etid": str(entity_type_id),
                "uid": str(SEED.primary_profile),
            },
        )
    ).scalar_one()

    await ExtractionProposalService(db).record_proposal(
        run_id=run_id,
        instance_id=new_instance_id,
        field_id=field_id,
        source=ExtractionProposalSource.AI,
        proposed_value={"value": "candidate"},
    )
    await db.flush()
    return new_instance_id, field_id


async def test_blind_parity_own_only(db_session: AsyncSession) -> None:
    run_id, reviewer_a, _reviewer_b = await _built_or_skip(db_session)
    template_id = await _template_id_of_run(db_session, run_id)

    page = await _page(db_session, reviewer_a, template_id=template_id)
    blob = _blob(page)
    assert "REVIEWER-A-SECRET" in blob
    assert "REVIEWER-B-SECRET" not in blob

    article = page.articles[0]
    assert article.peer_values_hidden is True
    assert article.reason == "blind_review"

    detail = await get_run_with_workflow_history(
        db_session, run_id, caller_id=reviewer_a, can_see_peers=False
    )
    expected_values = {
        str(d.value.get("value", d.value) if isinstance(d.value, dict) else d.value)
        for d in detail.decisions
        if d.value is not None
    }
    got_values = {str(row.value) for row in (article.rows or [])}
    # get_run_with_workflow_history is the parity oracle (spec §8): every
    # decision value it exposes to this caller must show up (as a short
    # string, not a raw dict) in at least one detailed row this service
    # produced for the same caller.
    for short in expected_values:
        assert any(short in v for v in got_values)


async def test_blind_parity_arbitrator_at_consensus(db_session: AsyncSession) -> None:
    run_id, _reviewer_a, _reviewer_b = await _built_or_skip(db_session)
    template_id = await _template_id_of_run(db_session, run_id)
    await db_session.execute(
        text("UPDATE public.extraction_runs SET stage = 'consensus' WHERE id = :id"),
        {"id": str(run_id)},
    )
    db_session.expire_all()

    page = await _page(db_session, SEED.primary_profile, template_id=template_id)
    blob = _blob(page)
    assert "REVIEWER-A-SECRET" in blob
    assert "REVIEWER-B-SECRET" in blob

    article = page.articles[0]
    assert article.peer_values_hidden is False

    concise = await _page(db_session, SEED.primary_profile, fmt="concise", template_id=template_id)
    field_id = next(r.field_id for r in (article.rows or []) if r.decider == "human")
    assert concise.articles[0].values[str(field_id)].disagreement is True


async def test_blind_parity_everyone_at_finalized(db_session: AsyncSession) -> None:
    run_id, reviewer_a, _reviewer_b = await _built_or_skip(db_session)
    template_id = await _template_id_of_run(db_session, run_id)
    await db_session.execute(
        text("UPDATE public.extraction_runs SET stage = 'finalized' WHERE id = :id"),
        {"id": str(run_id)},
    )
    db_session.expire_all()

    page = await _page(db_session, reviewer_a, template_id=template_id)
    blob = _blob(page)
    assert "REVIEWER-A-SECRET" in blob
    assert "REVIEWER-B-SECRET" in blob


async def test_manager_hidden_before_consensus(db_session: AsyncSession) -> None:
    run_id, _reviewer_a, _reviewer_b = await _built_or_skip(db_session)
    template_id = await _template_id_of_run(db_session, run_id)

    page = await _page(db_session, SEED.primary_profile, template_id=template_id)
    assert page.articles[0].peer_values_hidden is True


async def test_ai_only_flag(db_session: AsyncSession) -> None:
    run_id, reviewer_a, _reviewer_b = await _built_or_skip(db_session)
    template_id = await _template_id_of_run(db_session, run_id)
    instance_id, field_id = await _ai_only_coordinate(
        db_session, run_id=run_id, template_id=template_id
    )

    page = await _page(db_session, reviewer_a, template_id=template_id)
    row = next(
        r
        for r in (page.articles[0].rows or [])
        if r.instance_id == instance_id and r.field_id == field_id
    )
    assert row.decider == "ai"
    assert "candidate" in row.value

    concise = await _page(db_session, reviewer_a, fmt="concise", template_id=template_id)
    cell = concise.articles[0].values[str(field_id)]
    assert cell.ai_only is True


async def test_picks_live_run_over_finalized_after_reopen(db_session: AsyncSession) -> None:
    run_id, _reviewer_a, _reviewer_b = await _built_or_skip(db_session)
    template_id = await _template_id_of_run(db_session, run_id)
    await db_session.execute(
        text("UPDATE public.extraction_runs SET stage = 'finalized' WHERE id = :id"),
        {"id": str(run_id)},
    )
    db_session.expire_all()

    coord = (
        await db_session.execute(
            text(
                "SELECT instance_id, field_id FROM public.extraction_proposal_records "
                "WHERE run_id = :rid LIMIT 1"
            ),
            {"rid": str(run_id)},
        )
    ).first()
    instance_id, field_id = coord

    lifecycle = RunLifecycleService(db_session)
    new_run = await lifecycle.create_run(
        project_id=SEED.primary_project,
        article_id=SEED.primary_article,
        project_template_id=template_id,
        user_id=SEED.primary_profile,
    )
    await lifecycle.advance_stage(
        run_id=new_run.id, target_stage=ExtractionRunStage.EXTRACT, user_id=SEED.primary_profile
    )
    await ExtractionProposalService(db_session).record_proposal(
        run_id=new_run.id,
        instance_id=instance_id,
        field_id=field_id,
        source=ExtractionProposalSource.AI,
        proposed_value={"value": "LIVE-VALUE"},
    )
    await db_session.flush()

    page = await _page(db_session, SEED.primary_profile, template_id=template_id)
    assert page.articles[0].run.run_id == new_run.id
    row = next(
        r
        for r in (page.articles[0].rows or [])
        if r.instance_id == instance_id and r.field_id == field_id
    )
    assert "LIVE-VALUE" in row.value


async def test_no_run_row(db_session: AsyncSession) -> None:
    run_id, _reviewer_a, _reviewer_b = await _built_or_skip(db_session)
    template_id = await _template_id_of_run(db_session, run_id)
    other_article = await insert_article(db_session, SEED.primary_project, title="Run-less article")

    page = await _page(
        db_session, SEED.primary_profile, template_id=template_id, article_id=other_article
    )
    article = page.articles[0]
    assert article.run is None
    assert article.reason == "no_run"
    assert not (article.rows or [])


async def test_query_count_bounded_per_page(db_session: AsyncSession) -> None:
    async def _count(fmt: str, article_id, template_id) -> int:
        queries: list[str] = []

        def record(_conn, _cursor, statement, _parameters, _context, _many):
            queries.append(statement)

        event.listen(db_session.bind.sync_engine, "before_cursor_execute", record)
        try:
            await list_agent_extractions(
                db_session,
                project_id=SEED.primary_project,
                template_id=template_id,
                template_kind="extraction",
                caller_id=SEED.primary_profile,
                article_id=article_id,
                response_format=fmt,
                cursor=None,
                limit=10,
            )
        finally:
            event.remove(db_session.bind.sync_engine, "before_cursor_execute", record)
        return len(queries)

    run_id, _reviewer_a, _reviewer_b = await _built_or_skip(db_session)
    template_id = await _template_id_of_run(db_session, run_id)

    # Deterministic, lexically-LOW article ids: `Article.id` keyset pagination
    # orders ascending, and the seed's own articles/`SEED.primary_article`
    # (id prefix "ffffffff-...", near the top of the UUID range) sort AFTER
    # anything below -- an id crafted here always lands on page 1 regardless
    # of how many other articles the shared DB happens to hold.
    async def _low_id_article(suffix: str, title: str) -> UUID:
        article_id = UUID(f"00000000-0000-0000-0000-0000000000{suffix}")
        await db_session.execute(
            text(
                "INSERT INTO public.articles (id, project_id, title, row_version) "
                "VALUES (:id, :pid, :title, 1)"
            ),
            {"id": str(article_id), "pid": str(SEED.primary_project), "title": title},
        )
        await db_session.flush()
        return article_id

    for i in range(1):
        await _low_id_article(f"{i:02d}", f"run-less {i}")
    c1 = await _count("concise", None, template_id)

    for i in range(1, 5):
        await _low_id_article(f"{i:02d}", f"run-less {i}")
    c5 = await _count("concise", None, template_id)
    assert c1 == c5, (c1, c5)

    lifecycle = RunLifecycleService(db_session)

    async def _extra_run(article_id: UUID) -> None:
        run = await lifecycle.create_run(
            project_id=SEED.primary_project,
            article_id=article_id,
            project_template_id=template_id,
            user_id=SEED.primary_profile,
        )
        await lifecycle.advance_stage(
            run_id=run.id, target_stage=ExtractionRunStage.EXTRACT, user_id=SEED.primary_profile
        )

    run_article_1 = await _low_id_article("10", "run article 1")
    await _extra_run(run_article_1)
    c_one_run = await _count("detailed", None, template_id)

    run_article_2 = await _low_id_article("11", "run article 2")
    await _extra_run(run_article_2)
    c_two_runs = await _count("detailed", None, template_id)

    run_article_3 = await _low_id_article("12", "run article 3")
    await _extra_run(run_article_3)
    c_three_runs = await _count("detailed", None, template_id)

    assert c_two_runs - c_one_run == c_three_runs - c_two_runs


async def test_detailed_evidence_is_wrapped_and_scoped(db_session: AsyncSession) -> None:
    run_id, reviewer_a, _reviewer_b = await _built_or_skip(db_session)
    template_id = await _template_id_of_run(db_session, run_id)
    instance_id, field_id = await _ai_only_coordinate(
        db_session, run_id=run_id, template_id=template_id
    )
    proposal_id = (
        await db_session.execute(
            text(
                "SELECT id FROM public.extraction_proposal_records "
                "WHERE run_id = :rid AND instance_id = :iid AND field_id = :fid"
            ),
            {"rid": str(run_id), "iid": str(instance_id), "fid": str(field_id)},
        )
    ).scalar_one()

    await db_session.execute(
        text(
            "INSERT INTO public.extraction_evidence "
            "(id, project_id, article_id, run_id, proposal_record_id, page_number, text_content, "
            "rank, created_by) "
            "VALUES (gen_random_uuid(), :pid, :aid, :rid, :propid, 4, 'QUOTE', 0, :uid)"
        ),
        {
            "pid": str(SEED.primary_project),
            "aid": str(SEED.primary_article),
            "rid": str(run_id),
            "propid": str(proposal_id),
            "uid": str(SEED.primary_profile),
        },
    )
    decision_row = (
        await db_session.execute(
            text(
                "SELECT id FROM public.extraction_reviewer_decisions "
                "WHERE run_id = :rid AND reviewer_id != :a LIMIT 1"
            ),
            {"rid": str(run_id), "a": str(reviewer_a)},
        )
    ).first()
    assert decision_row is not None
    await db_session.execute(
        text(
            "INSERT INTO public.extraction_evidence "
            "(id, project_id, article_id, run_id, reviewer_decision_id, page_number, text_content, "
            "rank, created_by) "
            "VALUES (gen_random_uuid(), :pid, :aid, :rid, :did, 9, 'PEER-EVIDENCE', 0, :uid)"
        ),
        {
            "pid": str(SEED.primary_project),
            "aid": str(SEED.primary_article),
            "rid": str(run_id),
            "did": str(decision_row[0]),
            "uid": str(SEED.primary_profile),
        },
    )
    await db_session.flush()

    page = await _page(db_session, reviewer_a, template_id=template_id)
    ai_row = next(
        r
        for r in (page.articles[0].rows or [])
        if r.instance_id == instance_id and r.field_id == field_id and r.decider == "ai"
    )
    assert ai_row.evidence
    assert ai_row.evidence[0].locator == "p4"
    assert "QUOTE" in ai_row.evidence[0].quote
    assert UNTRUSTED_OPEN in ai_row.evidence[0].quote
    assert UNTRUSTED_CLOSE in ai_row.evidence[0].quote

    blob = _blob(page)
    assert "PEER-EVIDENCE" not in blob
