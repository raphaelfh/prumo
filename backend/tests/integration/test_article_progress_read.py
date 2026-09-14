"""Article progress read (spec R7-R12): service tests; Tasks 1b and 2 append. created_at is explicit (now() is fixed per transaction)."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any, NamedTuple
from unittest.mock import AsyncMock, patch
from uuid import UUID, uuid4

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction import ExtractionRun
from app.models.extraction_workflow import (
    ExtractionProposalRecord,
    ExtractionReviewerDecision,
    ExtractionReviewerState,
)
from app.repositories.article_progress_repository import ArticleProgressRepository
from app.schemas.article_progress import ArticleProgressKind, ArticleProgressRead
from app.services.article_progress_service import get_article_progress
from tests.factories.template_factory import TemplateFactory
from tests.integration.conftest import SEED

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
