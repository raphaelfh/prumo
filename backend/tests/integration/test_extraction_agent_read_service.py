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
from app.utils.compact_json import compact_json
from app.utils.opaque_cursor import InvalidCursorError, encode_cursor
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
    # B2 (fix round 1): the OFF default must actually withhold peer B's
    # value from the manager, not just flip the flag -- the flag alone
    # doesn't prove the blob is clean.
    assert "REVIEWER-B-SECRET" not in _blob(page)


async def test_manager_parity_managers_see_reviewers_on(db_session: AsyncSession) -> None:
    """B2 (fix round 1): with the project's live `managers_see_reviewers`
    setting ON for this template's kind, a manager sees BOTH reviewers'
    secrets even before consensus -- `caller_can_see_peers` is the ONLY
    thing that changed; `get_run_with_workflow_history` is still the sole
    filter, never re-implemented here."""
    run_id, _reviewer_a, _reviewer_b = await _built_or_skip(db_session)
    template_id = await _template_id_of_run(db_session, run_id)
    project_id = (
        await db_session.execute(
            text("SELECT project_id FROM public.extraction_runs WHERE id = :id"),
            {"id": str(run_id)},
        )
    ).scalar_one()
    # A direct overwrite, not `jsonb_set`: `jsonb_set` only ever creates the
    # FINAL path key, never a missing intermediate object -- the seeded
    # row's `settings` is `{}` (no `managers_see_reviewers` key at all), so
    # a 2-level `jsonb_set` path silently no-ops on it.
    await db_session.execute(
        text(
            "UPDATE public.projects SET settings = "
            '\'{"managers_see_reviewers": {"extraction": true, "quality_assessment": false}}\'::jsonb '
            "WHERE id = :pid"
        ),
        {"pid": str(project_id)},
    )
    await db_session.flush()
    db_session.expire_all()

    page = await _page(db_session, SEED.primary_profile, template_id=template_id)
    blob = _blob(page)
    assert "REVIEWER-A-SECRET" in blob
    assert "REVIEWER-B-SECRET" in blob
    assert page.articles[0].peer_values_hidden is False


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
    assert article.title == "Run-less article"
    assert article.title_truncated is False
    # Q-trunc (fix round 2): the OFF case -- a small questionnaire is never
    # flagged truncated, and carries no next_step hint.
    assert page.questions_truncated is False
    assert page.next_step is None


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


async def test_evidence_hidden_when_decision_id_belongs_to_hidden_peer(
    db_session: AsyncSession,
) -> None:
    """M1 (fix round 1): a row can carry BOTH a proposal_record_id and a
    reviewer_decision_id (the model's CHECK constraint allows it). Even when
    its proposal_record_id points at a VISIBLE (AI) proposal, a
    reviewer_decision_id that belongs to a HIDDEN peer's decision must
    still hide the row -- never surfaced through the proposal side alone.
    Constructs that row directly, as the finding asks."""
    run_id, reviewer_a, _reviewer_b = await _built_or_skip(db_session)
    template_id = await _template_id_of_run(db_session, run_id)
    instance_id, field_id = await _ai_only_coordinate(
        db_session, run_id=run_id, template_id=template_id
    )
    ai_proposal_id = (
        await db_session.execute(
            text(
                "SELECT id FROM public.extraction_proposal_records "
                "WHERE run_id = :rid AND instance_id = :iid AND field_id = :fid"
            ),
            {"rid": str(run_id), "iid": str(instance_id), "fid": str(field_id)},
        )
    ).scalar_one()
    hidden_decision_row = (
        await db_session.execute(
            text(
                "SELECT id FROM public.extraction_reviewer_decisions "
                "WHERE run_id = :rid AND reviewer_id != :a LIMIT 1"
            ),
            {"rid": str(run_id), "a": str(reviewer_a)},
        )
    ).first()
    assert hidden_decision_row is not None

    await db_session.execute(
        text(
            "INSERT INTO public.extraction_evidence "
            "(id, project_id, article_id, run_id, proposal_record_id, reviewer_decision_id, "
            "page_number, text_content, rank, created_by) "
            "VALUES (gen_random_uuid(), :pid, :aid, :rid, :propid, :did, 5, "
            "'LEAKED-VIA-DUAL-FK', 0, :uid)"
        ),
        {
            "pid": str(SEED.primary_project),
            "aid": str(SEED.primary_article),
            "rid": str(run_id),
            "propid": str(ai_proposal_id),
            "did": str(hidden_decision_row[0]),
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
    assert ai_row.evidence == []
    assert "LEAKED-VIA-DUAL-FK" not in _blob(page)


async def test_cursor_article_deleted_resumes_at_next_article(db_session: AsyncSession) -> None:
    """M2 (fix round 1): a cursor naming an article deleted since the page
    that issued it must resume at the next surviving article -- not lose
    the whole rest of the listing."""
    run_id, _reviewer_a, _reviewer_b = await _built_or_skip(db_session)
    template_id = await _template_id_of_run(db_session, run_id)

    async def _low_id_article(suffix: str, title: str) -> UUID:
        article_id = UUID(f"00000000-0000-0000-0000-0000000001{suffix}")
        await db_session.execute(
            text(
                "INSERT INTO public.articles (id, project_id, title, row_version) "
                "VALUES (:id, :pid, :title, 1)"
            ),
            {"id": str(article_id), "pid": str(SEED.primary_project), "title": title},
        )
        await db_session.flush()
        return article_id

    a1 = await _low_id_article("01", "cursor-victim-1")
    a2 = await _low_id_article("02", "cursor-victim-2")

    page1 = await list_agent_extractions(
        db_session,
        project_id=SEED.primary_project,
        template_id=template_id,
        template_kind="extraction",
        caller_id=SEED.primary_profile,
        article_id=None,
        response_format="concise",
        cursor=None,
        limit=1,
    )
    assert [a.article_id for a in page1.articles] == [a1]
    assert page1.next_cursor is not None

    await db_session.execute(text("DELETE FROM public.articles WHERE id = :id"), {"id": str(a1)})
    await db_session.flush()

    page2 = await list_agent_extractions(
        db_session,
        project_id=SEED.primary_project,
        template_id=template_id,
        template_kind="extraction",
        caller_id=SEED.primary_profile,
        article_id=None,
        response_format="concise",
        cursor=page1.next_cursor,
        limit=1,
    )
    assert [a.article_id for a in page2.articles] == [a2]


async def test_cursor_rejects_mismatched_response_format(db_session: AsyncSession) -> None:
    """M4 (fix round 1): a cursor issued under one `response_format` must
    not be honored under a different one -- item lists page differently
    per format, so resuming with a mismatched format would replay a
    position that means something else."""
    run_id, _reviewer_a, _reviewer_b = await _built_or_skip(db_session)
    template_id = await _template_id_of_run(db_session, run_id)

    # A well-formed cursor, issued for concise + no article filter, replayed
    # against detailed -- never a real page's `next_cursor` (which article
    # the shared seed DB happens to land on page 1 is not this test's
    # concern; only the format/article binding is).
    forged = encode_cursor([str(SEED.primary_article), 0, "concise", ""])
    with pytest.raises(InvalidCursorError):
        await list_agent_extractions(
            db_session,
            project_id=SEED.primary_project,
            template_id=template_id,
            template_kind="extraction",
            caller_id=SEED.primary_profile,
            article_id=None,
            response_format="detailed",
            cursor=forged,
            limit=10,
        )


async def test_cursor_rejects_mismatched_article_filter(db_session: AsyncSession) -> None:
    """M4 (fix round 1): a cursor issued for a project-wide listing must not
    be honored when replayed with an `article_id` filter (or a different
    one), which pages a completely different article set."""
    run_id, _reviewer_a, _reviewer_b = await _built_or_skip(db_session)
    template_id = await _template_id_of_run(db_session, run_id)

    forged = encode_cursor([str(SEED.primary_article), 0, "detailed", ""])
    with pytest.raises(InvalidCursorError):
        await list_agent_extractions(
            db_session,
            project_id=SEED.primary_project,
            template_id=template_id,
            template_kind="extraction",
            caller_id=SEED.primary_profile,
            article_id=SEED.primary_article,
            response_format="detailed",
            cursor=forged,
            limit=10,
        )


async def test_worst_case_page_size_stays_under_cap(db_session: AsyncSession) -> None:
    """B1 (fix round 1) + B1-r (fix round 2): the reviewer's probes measured
    34,506 and 32,728-37,328 chars on pt-BR/no-run-heavy pages -- long
    non-ASCII values plus evidence (round 1), then unbounded no-run-article
    titles never charged against the budget at all (round 2). This is the
    combined worst case round 2 asked for: page 1 carries a question list
    forced past `_QUESTIONS_CAP` (so it truncates), several run-less
    articles with long (300-600 char) titles, AND ten articles with three
    long non-ASCII detailed rows plus evidence each (heavy enough to force
    at least one article to resume mid-way on a later page). Every page
    must stay <= 32,000 chars of `compact_json`, and paging must cover
    every row -- and every no-run article -- exactly once."""
    run_id, _reviewer_a, _reviewer_b = await _built_or_skip(db_session)
    template_id = await _template_id_of_run(db_session, run_id)

    # Create every article + run FIRST, while the template's published
    # version is still active (`RunLifecycleService.create_run` requires
    # exactly one). Only THEN deactivate it and add the section/fields this
    # test needs, the same forced live-fallback precedent `_ai_only_coordinate`
    # uses -- `get_active_version_tree` reads a FROZEN published snapshot, so
    # a live-only addition needs the version inactive to be seen at all.
    lifecycle = RunLifecycleService(db_session)
    runs: list[tuple[UUID, UUID]] = []  # (article_id, run_id)
    for i in range(10):
        article_id = await insert_article(
            db_session, SEED.primary_project, title=f"worst-case-article-{i}"
        )
        run = await lifecycle.create_run(
            project_id=SEED.primary_project,
            article_id=article_id,
            project_template_id=template_id,
            user_id=SEED.primary_profile,
        )
        await lifecycle.advance_stage(
            run_id=run.id, target_stage=ExtractionRunStage.EXTRACT, user_id=SEED.primary_profile
        )
        runs.append((article_id, run.id))

    await db_session.execute(
        text(
            "UPDATE public.extraction_template_versions SET is_active = false "
            "WHERE project_template_id = :tid"
        ),
        {"tid": str(template_id)},
    )
    entity_type_id = await add_section(db_session, template_id, "Worst-case section")
    field_ids = [
        await add_field(db_session, entity_type_id, f"worst-case-field-{i}") for i in range(3)
    ]
    # Question-only fields (fix round 2, B1-r + Q-trunc): a second section
    # with no instances at all -- these inflate `questions` past
    # `_QUESTIONS_CAP` without producing any rows to page, isolating the
    # question-list truncation from the row-packing worst case above.
    questions_only_et = await add_section(db_session, template_id, "Question-only section")
    for i in range(220):
        await add_field(db_session, questions_only_et, f"question-only-field-{i}")

    # Several run-less articles with long (unbounded-Text) titles, mixed in
    # by project-wide listing order alongside the ten run articles.
    long_title = "Associação entre exposição ambiental e função pulmonar em coortes " * 10
    no_run_article_ids: set[UUID] = set()
    for i in range(9):
        aid = await insert_article(
            db_session, SEED.primary_project, title=f"[{i}] {long_title[: 300 + i * 30]}"
        )
        no_run_article_ids.add(aid)

    long_value = (
        "Pacientes com insuficiencia cardiaca cronica e fracao de ejecao reduzida foram "
        "randomizados; a mortalidade por causa cardiovascular nao diferiu entre os grupos. "
        "Ensaio clinico randomizado com desfecho composto e intervalo de confianca de 95%. "
    ) * 6  # >1000 non-ASCII-adjacent chars once truncation/escaping is accounted for
    long_value = long_value.replace("a", "ã").replace("o", "õ")  # force real non-ASCII
    quote_text = long_value[:400]

    expected_rows: set[tuple[UUID, UUID, UUID]] = set()
    for article_id, run_pk in runs:
        instance_id = (
            await db_session.execute(
                text(
                    "INSERT INTO public.extraction_instances "
                    "(id, project_id, article_id, template_id, entity_type_id, label, sort_order, "
                    "metadata, created_by) "
                    "VALUES (gen_random_uuid(), :pid, :aid, :tid, :etid, 'entry', 1, '{}'::jsonb, :uid) "
                    "RETURNING id"
                ),
                {
                    "pid": str(SEED.primary_project),
                    "aid": str(article_id),
                    "tid": str(template_id),
                    "etid": str(entity_type_id),
                    "uid": str(SEED.primary_profile),
                },
            )
        ).scalar_one()
        for fld in field_ids:
            expected_rows.add((article_id, instance_id, fld))
            await ExtractionProposalService(db_session).record_proposal(
                run_id=run_pk,
                instance_id=instance_id,
                field_id=fld,
                source=ExtractionProposalSource.AI,
                proposed_value={"value": long_value},
            )
            proposal_id = (
                await db_session.execute(
                    text(
                        "SELECT id FROM public.extraction_proposal_records "
                        "WHERE run_id = :rid AND instance_id = :iid AND field_id = :fid"
                    ),
                    {"rid": str(run_pk), "iid": str(instance_id), "fid": str(fld)},
                )
            ).scalar_one()
            for rank in range(3):
                await db_session.execute(
                    text(
                        "INSERT INTO public.extraction_evidence "
                        "(id, project_id, article_id, run_id, proposal_record_id, page_number, "
                        "text_content, rank, created_by) "
                        "VALUES (gen_random_uuid(), :pid, :aid, :rid, :propid, :pg, :txt, :rank, :uid)"
                    ),
                    {
                        "pid": str(SEED.primary_project),
                        "aid": str(article_id),
                        "rid": str(run_pk),
                        "propid": str(proposal_id),
                        "pg": rank + 1,
                        "txt": quote_text,
                        "rank": rank,
                        "uid": str(SEED.primary_profile),
                    },
                )
        await db_session.flush()

    seen_rows: set[tuple[UUID, UUID, UUID]] = set()
    seen_no_run_articles: set[UUID] = set()
    cursor: str | None = None
    pages = 0
    while True:
        page = await list_agent_extractions(
            db_session,
            project_id=SEED.primary_project,
            template_id=template_id,
            template_kind="extraction",
            caller_id=SEED.primary_profile,
            article_id=None,
            response_format="detailed",
            cursor=cursor,
            limit=10,
        )
        pages += 1
        assert len(compact_json(page.model_dump(mode="json"))) <= 32_000
        if pages == 1:
            # Q-trunc (fix round 2): the 220 question-only fields plus the 3
            # real ones push `questions` well past `_QUESTIONS_CAP` -- page 1
            # must say so and point the agent at the full list.
            assert page.questions_truncated is True
            assert page.next_step is not None
        for article in page.articles:
            if article.article_id in no_run_article_ids:
                seen_no_run_articles.add(article.article_id)
                assert article.reason == "no_run"
                assert len(article.title) <= 200
                assert article.title_truncated is True  # every seeded title is > 200 chars
            for row in article.rows or []:
                key = (article.article_id, row.instance_id, row.field_id)
                assert key not in seen_rows, "row paged twice"
                seen_rows.add(key)
        cursor = page.next_cursor
        if cursor is None:
            break
        assert pages < 200  # runaway-loop guard, not a real expectation

    assert expected_rows <= seen_rows
    assert no_run_article_ids <= seen_no_run_articles
    assert pages > 1  # 19 articles at limit=10 alone forces multiple pages
