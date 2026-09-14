"""Article progress read (spec R7-R12): service tests; Tasks 1b and 2 append. created_at is explicit (now() is fixed per transaction)."""

from __future__ import annotations

import re
from collections.abc import AsyncGenerator
from datetime import UTC, datetime, timedelta
from typing import Any, NamedTuple
from unittest.mock import AsyncMock, patch
from uuid import UUID, uuid4

import pytest
import pytest_asyncio
from fastapi import HTTPException
from httpx import ASGITransport, AsyncClient
from sqlalchemy import event, text
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.requests import Request

import app.api.v1.endpoints.project_templates as project_templates_endpoints
from app.core.deps import get_db
from app.core.security import TokenPayload, get_current_user
from app.main import app
from app.models.extraction import ExtractionRun
from app.models.extraction_workflow import (
    ExtractionProposalRecord,
    ExtractionReviewerDecision,
    ExtractionReviewerState,
)
from app.repositories.article_progress_repository import ArticleProgressRepository
from app.schemas.article_progress import ArticleProgressKind, ArticleProgressRead
from app.services.article_progress_service import get_article_progress
from app.services.extraction_run_read_service import resolve_form_runs
from tests.factories.template_factory import TemplateFactory
from tests.integration.conftest import SEED, make_proposal, open_session

PID, ME, OTHER = SEED.primary_project, SEED.primary_profile, SEED.reviewer_profile
T0 = datetime(2026, 1, 1, tzinfo=UTC)
MARKER = {"value": None, "absent_reason": "no_information"}
_FIELD = (
    "INSERT INTO public.extraction_fields (id, entity_type_id, name, label, field_type, is_required) "
    "VALUES (:id, :et, 'arm_name', 'Arm name', 'text', false)"
)
_ARTICLES = (
    "INSERT INTO public.articles (id, project_id, title, row_version) SELECT gen_random_uuid(), "
    ":pid, 'progress ' || g, 1 FROM generate_series(1, :n) g RETURNING id"
)
_INSTANCES = (
    "INSERT INTO public.extraction_instances (id, project_id, template_id, entity_type_id, article_id, label, "
    "created_by) SELECT gen_random_uuid(), :pid, :tid, :et, a.id, 'arm', :uid "
    "FROM unnest(CAST(:aids AS uuid[])) AS a(id), generate_series(1, :k) RETURNING id, article_id"
)
_VERSION = (
    "SELECT v.id FROM public.extraction_template_versions v JOIN public.project_extraction_templates t "
    "ON t.id = v.project_template_id WHERE t.project_id = :pid AND v.project_template_id = :t AND v.is_active"
)


class World(NamedTuple):
    kind: ArticleProgressKind
    tid: UUID
    fid: UUID
    aids: list[UUID]
    inst: dict[UUID, list[UUID]]  # article_id -> instance ids


async def _world(
    db: AsyncSession,
    *,
    kind: ArticleProgressKind = "extraction",
    articles: int = 1,
    per_article: int = 1,
) -> World:
    factory = TemplateFactory(db, PID, ME)
    tid = await factory.create(name=f"progress-{uuid4().hex[:8]}", kind=kind)
    etid = await factory.add_study_section(
        tid, name="arms", cardinality="many"
    )  # many: N instances per article
    fid = uuid4()
    await db.execute(text(_FIELD), {"id": str(fid), "et": str(etid)})
    aids = list((await db.execute(text(_ARTICLES), {"pid": str(PID), "n": articles})).scalars())
    params = {
        "pid": str(PID),
        "tid": str(tid),
        "et": str(etid),
        "uid": str(ME),
        "k": per_article,
        "aids": [str(a) for a in aids],
    }
    inst: dict[UUID, list[UUID]] = {a: [] for a in aids}
    for iid, aid in (await db.execute(text(_INSTANCES), params)).all():
        inst[aid].append(iid)
    return World(kind, tid, fid, aids, inst)


async def _add(db: AsyncSession, row: Any) -> UUID:
    db.add(row)
    await db.flush()
    return row.id


async def _run(db: AsyncSession, w: World, aid: UUID, stage: str, minute: int) -> UUID:
    vid = (await db.execute(text(_VERSION), {"pid": str(PID), "t": str(w.tid)})).scalar_one()
    return await _add(
        db,
        ExtractionRun(
            project_id=PID,
            article_id=aid,
            template_id=w.tid,
            kind=w.kind,
            version_id=vid,
            stage=stage,
            status="pending",
            created_by=ME,
            created_at=T0 + timedelta(minutes=minute),
        ),
    )


async def _decide(
    db: AsyncSession,
    run: UUID,
    iid: UUID,
    fid: UUID,
    decision: str,
    value: Any = None,
    *,
    proposal: UUID | None = None,
    reviewer: UUID = ME,
    minute: int = 0,
) -> UUID:
    return await _add(
        db,
        ExtractionReviewerDecision(
            id=uuid4(),
            run_id=run,
            instance_id=iid,
            field_id=fid,
            reviewer_id=reviewer,
            decision=decision,
            value=value,
            proposal_record_id=proposal,
            created_at=T0 + timedelta(minutes=minute),
        ),
    )


async def _point(
    db: AsyncSession, run: UUID, iid: UUID, fid: UUID, decision_id: UUID, reviewer: UUID = ME
) -> None:
    await _add(
        db,
        ExtractionReviewerState(
            id=uuid4(),
            run_id=run,
            instance_id=iid,
            field_id=fid,
            reviewer_id=reviewer,
            current_decision_id=decision_id,
        ),
    )


async def _state(
    db: AsyncSession,
    run: UUID,
    iid: UUID,
    fid: UUID,
    decision: str,
    value: Any = None,
    *,
    proposal: UUID | None = None,
    reviewer: UUID = ME,
    minute: int = 0,
) -> None:
    await _point(
        db,
        run,
        iid,
        fid,
        await _decide(
            db, run, iid, fid, decision, value, proposal=proposal, reviewer=reviewer, minute=minute
        ),
        reviewer,
    )


async def _proposal(
    db: AsyncSession,
    run: UUID,
    iid: UUID,
    fid: UUID,
    raw: Any,
    *,
    minute: int = 0,
    user: UUID | None = ME,
    source: str = "human",
) -> UUID:
    return await _add(
        db,
        ExtractionProposalRecord(
            id=uuid4(),
            run_id=run,
            instance_id=iid,
            field_id=fid,
            source=source,
            source_user_id=user,
            proposed_value=raw,
            created_at=T0 + timedelta(minutes=minute),
        ),
    )


async def _read(db: AsyncSession, w: World) -> ArticleProgressRead:
    return await get_article_progress(
        db, project_id=PID, template_id=w.tid, user_id=ME, kind=w.kind
    )


async def _values(db: AsyncSession, w: World) -> dict[UUID, dict[tuple[UUID, UUID], Any]]:
    return {
        a.article_id: {(v.instance_id, v.field_id): v.value for v in a.values}
        for a in (await _read(db, w)).articles
    }


async def _one_coord(
    db: AsyncSession, kind: ArticleProgressKind = "extraction"
) -> tuple[World, UUID, UUID, UUID]:
    w = await _world(db, kind=kind)
    return w, w.aids[0], w.inst[w.aids[0]][0], await _run(db, w, w.aids[0], "extract", 0)


async def test_second_reviewer_rows_never_appear(db_session: AsyncSession) -> None:
    w, aid, iid, run = await _one_coord(db_session)
    await _proposal(db_session, run, iid, w.fid, {"value": "mine"}, minute=1)
    await _state(
        db_session, run, iid, w.fid, "edit", {"value": "theirs"}, reviewer=OTHER
    )  # a leaked state would beat my proposal
    await _proposal(db_session, run, iid, w.fid, {"value": "theirs, newer"}, minute=5, user=OTHER)
    assert (await _values(db_session, w))[aid] == {(iid, w.fid): {"value": "mine"}}


async def test_rejected_decision_falls_back_to_human_proposal(db_session: AsyncSession) -> None:
    w, aid, iid, run = await _one_coord(db_session)
    await _state(db_session, run, iid, w.fid, "reject")
    await _proposal(db_session, run, iid, w.fid, {"value": "kept"})
    assert (await _values(db_session, w))[aid] == {(iid, w.fid): {"value": "kept"}}


async def test_newest_nonempty_human_proposal_wins(db_session: AsyncSession) -> None:
    w, aid, iid, run = await _one_coord(db_session)
    for minute, raw in enumerate(
        ({"value": "old"}, {"value": "new"}, {"value": ""}, {"value": None})
    ):
        await _proposal(db_session, run, iid, w.fid, raw, minute=minute)
    assert (await _values(db_session, w))[aid] == {(iid, w.fid): {"value": "new"}}


async def test_absent_reason_marker_counts_as_value(db_session: AsyncSession) -> None:
    w, aid, iid, run = await _one_coord(db_session)
    await _proposal(db_session, run, iid, w.fid, {"value": "old"}, minute=0)
    await _proposal(db_session, run, iid, w.fid, MARKER, minute=1)
    assert (await _values(db_session, w))[aid] == {(iid, w.fid): MARKER}


async def test_accepted_ai_proposal_counts_as_a_value(db_session: AsyncSession) -> None:
    w, aid, iid, run = await _one_coord(db_session)
    ai = await _proposal(db_session, run, iid, w.fid, {"value": "ai"}, user=None, source="ai")
    await _state(
        db_session, run, iid, w.fid, "accept_proposal", proposal=ai
    )  # value stays None, as accept_proposal stores it
    assert (await _values(db_session, w))[aid] == {(iid, w.fid): {"value": "ai"}}


async def test_accepted_absent_reason_marker_counts_as_filled(db_session: AsyncSession) -> None:
    w, aid, iid, run = await _one_coord(db_session)
    await _proposal(db_session, run, iid, w.fid, {"value": "older own"}, minute=0)
    ai = await _proposal(db_session, run, iid, w.fid, MARKER, minute=1, user=None, source="ai")
    await _state(db_session, run, iid, w.fid, "accept_proposal", proposal=ai, minute=2)
    assert (await _values(db_session, w))[aid] == {(iid, w.fid): MARKER}


async def test_own_edit_state_wins_over_own_newer_human_proposal(db_session: AsyncSession) -> None:
    w, aid, iid, run = await _one_coord(db_session)
    await _state(db_session, run, iid, w.fid, "edit", {"value": "state"}, minute=0)
    await _proposal(db_session, run, iid, w.fid, {"value": "newer proposal"}, minute=9)
    assert (await _values(db_session, w))[aid] == {(iid, w.fid): {"value": "state"}}


async def test_superseded_decision_is_ignored_for_the_current_decision(
    db_session: AsyncSession,
) -> None:
    w, aid, iid, run = await _one_coord(db_session)
    # The superseded row carries the LATER created_at, so only the current_decision_id join (not recency) picks the current one.
    await _decide(db_session, run, iid, w.fid, "edit", {"value": "superseded"}, minute=5)
    current = await _decide(db_session, run, iid, w.fid, "edit", {"value": "current"}, minute=1)
    await _point(db_session, run, iid, w.fid, current)
    assert (await _values(db_session, w))[aid] == {(iid, w.fid): {"value": "current"}}


async def test_quality_assessment_is_not_run_scoped(db_session: AsyncSession) -> None:
    w, aid, iid, _ = await _one_coord(db_session, kind="quality_assessment")
    await _proposal(
        db_session,
        await _run(db_session, w, aid, "cancelled", 1),
        iid,
        w.fid,
        {"value": "cancelled run"},
    )
    assert (await _values(db_session, w))[aid] == {(iid, w.fid): {"value": "cancelled run"}}


async def test_template_without_instances_returns_empty_list(db_session: AsyncSession) -> None:
    assert (await _read(db_session, await _world(db_session, per_article=0))).articles == []


async def test_template_without_instances_runs_no_value_query(db_session: AsyncSession) -> None:
    w = await _world(db_session, per_article=0)
    with patch.object(
        ArticleProgressRepository, "list_caller_values", new_callable=AsyncMock
    ) as values:
        assert (await _read(db_session, w)).articles == []
    values.assert_not_awaited()


async def _statements(db: AsyncSession, w: World) -> list[tuple[str, Any]]:
    """Every (SQL, bind params) the read executes, captured at the cursor."""
    conn = (await db.connection()).sync_connection
    seen: list[tuple[str, Any]] = []

    def capture(_c: Any, _cur: Any, statement: str, params: Any, _ctx: Any, _many: bool) -> None:
        seen.append((statement, params))

    event.listen(conn, "before_cursor_execute", capture)
    try:
        await _read(db, w)
    finally:
        event.remove(conn, "before_cursor_execute", capture)
    return seen


async def test_more_than_1000_instances_returned_in_full(db_session: AsyncSession) -> None:
    w = await _world(db_session, per_article=1001)
    ids = [i.id for i in (await _read(db_session, w)).articles[0].instances]
    assert len(ids) == 1001 and set(ids) == set(w.inst[w.aids[0]]) and ids == sorted(ids)


async def test_extraction_ignores_values_from_a_stale_run(db_session: AsyncSession) -> None:
    w = await _world(db_session)
    aid, iid = w.aids[0], w.inst[w.aids[0]][0]
    await _state(
        db_session,
        await _run(db_session, w, aid, "finalized", 0),
        iid,
        w.fid,
        "edit",
        {"value": "stale"},
    )
    await _proposal(
        db_session, await _run(db_session, w, aid, "extract", 1), iid, w.fid, {"value": "fresh"}
    )
    assert (await _values(db_session, w))[aid] == {(iid, w.fid): {"value": "fresh"}}


async def test_article_without_form_run_is_listed_with_no_values(db_session: AsyncSession) -> None:
    w = await _world(db_session, articles=2)
    with_run, without = w.aids
    await _proposal(
        db_session,
        await _run(db_session, w, with_run, "extract", 0),
        w.inst[with_run][0],
        w.fid,
        {"value": "x"},
    )
    await _proposal(
        db_session,
        await _run(db_session, w, without, "cancelled", 0),
        w.inst[without][0],
        w.fid,
        {"value": "y"},
    )
    read = {a.article_id: a for a in (await _read(db_session, w)).articles}
    assert read[with_run].values and read[without].values == []
    assert [i.id for i in read[without].instances] == w.inst[
        without
    ]  # listed with its instances: renders 0 %


async def test_bind_parameter_count_is_independent_of_article_count(
    db_session: AsyncSession,
) -> None:
    small = [len(p) for _, p in await _statements(db_session, await _world(db_session, articles=3))]
    large = [
        len(p) for _, p in await _statements(db_session, await _world(db_session, articles=1500))
    ]
    assert len(small) == 3  # owned_template, list_instances, list_caller_values
    assert small == large


async def test_form_run_scoping_agrees_with_resolve_form_runs(db_session: AsyncSession) -> None:
    w = await _world(db_session, articles=5)
    mixed, extract_live, pending_only, finalized_only, no_run = w.aids
    # Every live stage (pending/extract/consensus) is exercised: a stage dropped from either copy of the live
    # tuple changes one side's choice. One live run per coordinate (uq_one_live_extraction_run_per_coord), so
    # each live stage gets its own article.
    plan = {
        mixed: [("cancelled", 2), ("finalized", 0), ("consensus", 1)],
        extract_live: [("finalized", 0), ("extract", 1)],
        pending_only: [("pending", 0)],
        finalized_only: [("finalized", 0), ("finalized", 1)],
        no_run: [],
    }
    for aid, runs in plan.items():
        for (
            stage,
            minute,
        ) in runs:  # older runs get NEWER proposals: a leaked non-chosen run would win the merge
            run = await _run(db_session, w, aid, stage, minute)
            await _proposal(
                db_session, run, w.inst[aid][0], w.fid, {"value": str(run)}, minute=10 - minute
            )
    refs = await resolve_form_runs(db_session, w.aids, project_id=PID, template_id=w.tid)
    values = await _values(db_session, w)
    assert [r.run_id is None for r in refs] == [False, False, False, False, True]
    for ref in refs:
        want = (
            {}
            if ref.run_id is None
            else {(w.inst[ref.article_id][0], w.fid): {"value": str(ref.run_id)}}
        )
        assert values[ref.article_id] == want


async def test_values_are_read_in_one_statement_with_one_form_run_choice(
    db_session: AsyncSession,
) -> None:
    w, _, iid, run = await _one_coord(db_session)
    await _state(db_session, run, iid, w.fid, "edit", {"value": "x"})
    value_reads = [
        sql
        for sql, _ in await _statements(db_session, w)
        if "extraction_reviewer_states" in sql or "extraction_proposal_records" in sql
    ]
    assert len(value_reads) == 1
    assert (
        "extraction_reviewer_states" in value_reads[0]
        and "extraction_proposal_records" in value_reads[0]
    )
    assert (
        len(re.findall(r"\bform_runs AS\s*\(", value_reads[0])) == 1
    )  # SQLAlchemy renders "WITH form_runs AS \n("


# =================== HTTP: endpoint + guards + rate limit (Task 2) ===================
_ART_HI, _ART_LO = (
    UUID("ffffffff-9999-00f2-0000-000000000002"),
    UUID("ffffffff-9999-00f2-0000-000000000001"),
)
_PROBE_ET = UUID("ffffffff-9999-00f4-0000-000000000001")


def _progress_url(project_id: UUID, template_id: UUID, kind: str | None = "extraction") -> str:
    url = f"/api/v1/projects/{project_id}/templates/{template_id}/article-progress"
    return url if kind is None else f"{url}?kind={kind}"


async def _call_handler(db: AsyncSession, project_id: UUID, template_id: UUID, kind: str):
    # A real starlette Request: slowapi's wrapper rejects anything else while the limiter is live.
    scope = {
        "type": "http",
        "method": "GET",
        "path": _progress_url(project_id, template_id, None),
        "headers": [],
        "query_string": b"",
        "client": ("127.0.0.1", 1),
        "app": app,
    }
    request = Request(scope)
    request.state.trace_id = "trace-article-progress"
    return await project_templates_endpoints.get_template_article_progress(
        project_id=project_id,
        template_id=template_id,
        request=request,
        db=db,
        kind=kind,
        user_sub=SEED.primary_profile,
    )


def _pin_token_subject(user_id: UUID) -> None:
    async def override_get_current_user() -> TokenPayload:
        return TokenPayload(sub=str(user_id), email=None, role="authenticated", aal="aal1")

    app.dependency_overrides[get_current_user] = override_get_current_user


@pytest_asyncio.fixture
async def progress_member_client(db_client: AsyncClient) -> AsyncClient:
    _pin_token_subject(SEED.primary_profile)  # db_client clears overrides at teardown
    return db_client


@pytest_asyncio.fixture
async def progress_outsider_client(db_client: AsyncClient) -> AsyncClient:
    _pin_token_subject(SEED.outsider_profile)
    return db_client


@pytest_asyncio.fixture
async def progress_anonymous_client(db_session: AsyncSession) -> AsyncGenerator[AsyncClient, None]:
    async def override_get_db() -> AsyncGenerator[AsyncSession, None]:
        yield db_session

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides.pop(get_current_user, None)  # no test auth override: real bearer check
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            yield ac
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
async def test_member_reads_own_progress_per_article(db_session, progress_member_client) -> None:
    session = await open_session(
        db_session,
        project_id=SEED.primary_project,
        article_id=SEED.primary_article,
        template_id=SEED.primary_template,
        user_id=SEED.primary_profile,
    )
    await make_proposal(
        db_session,
        run_id=session.run_id,
        instance_id=SEED.primary_instance,
        field_id=SEED.primary_field,
        user_id=SEED.primary_profile,
        value=42,
    )
    resp = await progress_member_client.get(
        _progress_url(SEED.primary_project, SEED.primary_template)
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["ok"] is True
    item = next(a for a in body["data"]["articles"] if a["article_id"] == str(SEED.primary_article))
    assert set(item) == {"article_id", "instances", "values"}
    instance = {"id": str(SEED.primary_instance), "entity_type_id": str(SEED.primary_entity_type)}
    assert instance in item["instances"]
    key = (str(SEED.primary_instance), str(SEED.primary_field))
    assert len([v for v in item["values"] if (v["instance_id"], v["field_id"]) == key]) == 1
    expected = await get_article_progress(
        db_session,
        project_id=SEED.primary_project,
        template_id=SEED.primary_template,
        user_id=SEED.primary_profile,
        kind="extraction",
    )
    assert body["data"] == expected.model_dump(mode="json")
    direct = await _call_handler(
        db_session, SEED.primary_project, SEED.primary_template, "extraction"
    )
    assert direct.ok is True and direct.trace_id == "trace-article-progress"
    assert direct.data.model_dump(mode="json") == body["data"]


@pytest.mark.asyncio
async def test_response_is_ordered_by_article_then_instance_id(
    db_session, progress_member_client
) -> None:
    # Every row is inserted in DESCENDING id order, so an unordered scan cannot pass by accident.
    params = {
        "pid": str(SEED.primary_project),
        "tid": str(SEED.primary_template),
        "uid": str(SEED.primary_profile),
        "et1": str(SEED.primary_entity_type),
        "et2": str(_PROBE_ET),
        "hi": str(_ART_HI),
        "lo": str(_ART_LO),
    }
    await db_session.execute(
        text(
            "INSERT INTO public.extraction_entity_types (id, project_template_id, name, label, cardinality, "
            "parent_entity_type_id, sort_order, is_required) VALUES (:et2, :tid, 'ordering_probe', 'Ordering probe', 'one', NULL, 1, false)"
        ),
        params,
    )
    await db_session.execute(
        text(
            "INSERT INTO public.articles (id, project_id, title, row_version) "
            "VALUES (:hi, :pid, 'ordering probe', 1), (:lo, :pid, 'ordering probe', 1)"
        ),
        params,
    )
    await db_session.execute(
        text(
            "INSERT INTO public.extraction_instances (id, project_id, template_id, entity_type_id, "
            "article_id, label, created_by) VALUES "
            "('ffffffff-9999-00f6-0000-000000000004', :pid, :tid, :et2, :hi, 'p', :uid), "
            "('ffffffff-9999-00f6-0000-000000000003', :pid, :tid, :et1, :hi, 'p', :uid), "
            "('ffffffff-9999-00f6-0000-000000000002', :pid, :tid, :et2, :lo, 'p', :uid), "
            "('ffffffff-9999-00f6-0000-000000000001', :pid, :tid, :et1, :lo, 'p', :uid)"
        ),
        params,
    )
    await db_session.flush()
    resp = await progress_member_client.get(
        _progress_url(SEED.primary_project, SEED.primary_template)
    )
    assert resp.status_code == 200, resp.text
    articles = resp.json()["data"]["articles"]
    article_ids = [a["article_id"] for a in articles]
    assert {str(_ART_HI), str(_ART_LO)} <= set(article_ids)
    assert article_ids == sorted(article_ids, key=UUID)
    hi = next(a for a in articles if a["article_id"] == str(_ART_HI))
    assert len(hi["instances"]) == 2  # precondition: per-article order is observable
    for item in articles:
        instance_ids = [i["id"] for i in item["instances"]]
        assert instance_ids == sorted(instance_ids, key=UUID)


@pytest.mark.asyncio
async def test_missing_kind_is_422(progress_member_client) -> None:
    resp = await progress_member_client.get(
        _progress_url(SEED.primary_project, SEED.primary_template, kind=None)
    )
    assert resp.status_code == 422, resp.text


@pytest.mark.asyncio
async def test_unknown_kind_is_422(progress_member_client) -> None:
    resp = await progress_member_client.get(
        _progress_url(SEED.primary_project, SEED.primary_template, kind="qa")
    )
    assert resp.status_code == 422, resp.text


@pytest.mark.asyncio
async def test_non_member_gets_403_for_real_and_unknown_template(progress_outsider_client) -> None:
    real = await progress_outsider_client.get(
        _progress_url(SEED.primary_project, SEED.primary_template)
    )
    unknown = await progress_outsider_client.get(_progress_url(SEED.primary_project, uuid4()))
    assert real.status_code == 403, real.text
    assert unknown.status_code == 403, unknown.text
    assert real.json()["error"] == unknown.json()["error"]  # no existence oracle


@pytest.mark.asyncio
async def test_missing_or_invalid_token_gets_401(progress_anonymous_client) -> None:
    assert get_current_user not in app.dependency_overrides  # precondition: real auth runs
    url = _progress_url(SEED.primary_project, SEED.primary_template)
    missing = await progress_anonymous_client.get(url)
    invalid = await progress_anonymous_client.get(
        url, headers={"Authorization": "Bearer not-a-jwt"}
    )
    assert missing.status_code == 401, missing.text
    assert invalid.status_code == 401, invalid.text


@pytest.mark.asyncio
async def test_template_from_other_project_is_not_found(db_session, progress_member_client) -> None:
    # The caller manages BOTH projects, so a 404 (not a 403) is the template guard speaking.
    foreign = await progress_member_client.get(
        _progress_url(SEED.secondary_project, SEED.primary_template)
    )
    unknown = await progress_member_client.get(_progress_url(SEED.primary_project, uuid4()))
    assert foreign.status_code == 404, foreign.text
    assert unknown.status_code == 404, unknown.text
    with pytest.raises(HTTPException) as exc:
        await _call_handler(db_session, SEED.secondary_project, SEED.primary_template, "extraction")
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_kind_mismatch_is_not_found(db_session, progress_member_client) -> None:
    kind = (
        await db_session.execute(
            text(
                "SELECT kind FROM public.project_extraction_templates WHERE id = :id AND project_id = :pid"
            ),
            {"id": str(SEED.primary_template), "pid": str(SEED.primary_project)},
        )
    ).scalar_one()
    assert kind == "extraction"  # precondition
    resp = await progress_member_client.get(
        _progress_url(SEED.primary_project, SEED.primary_template, kind="quality_assessment")
    )
    assert resp.status_code == 404, resp.text
    with pytest.raises(HTTPException) as exc:
        await _call_handler(
            db_session, SEED.primary_project, SEED.primary_template, "quality_assessment"
        )
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_article_progress_is_rate_limited_at_60_per_minute(
    db_session, progress_member_client
) -> None:
    # The autouse _isolated_rate_limits fixture reset the limiter before this test.
    template_id = await TemplateFactory(
        db_session, SEED.primary_project, SEED.primary_profile
    ).create(name="rate-limit-probe", kind="extraction")
    count = (
        await db_session.execute(
            text(
                "SELECT count(*) FROM public.extraction_instances WHERE template_id = :t "
                "AND project_id = :pid"
            ),
            {"t": str(template_id), "pid": str(SEED.primary_project)},
        )
    ).scalar_one()
    assert count == 0  # precondition: no instances, so each request is three cheap statements
    url = _progress_url(SEED.primary_project, template_id)
    for attempt in range(60):
        resp = await progress_member_client.get(url)
        assert resp.status_code == 200, f"request {attempt + 1}: {resp.text}"
        assert resp.json()["data"] == {"articles": []}
    limited = await progress_member_client.get(url)
    assert limited.status_code == 429, limited.text
    assert "Rate limit exceeded" in limited.text
