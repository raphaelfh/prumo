"""Durable attempt contracts against real PostgreSQL."""

import asyncio
from uuid import uuid4

import pytest
import pytest_asyncio
from sqlalchemy import delete, select, text
from sqlalchemy.exc import DBAPIError, IntegrityError
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.models.extraction_attempt import ExtractionAttempt
from app.models.extraction_workflow import ExtractionProposalRecord
from app.repositories.extraction_attempt_repository import ExtractionAttemptRepository
from app.schemas.extraction_attempt import AttemptScope
from tests.factories.template_factory import TemplateFactory
from tests.integration.conftest import SEED
from tests.integration.helpers.engine_setup import run_in_extract_at


@pytest_asyncio.fixture
async def graph(db_session_real):
    db = db_session_real
    pid, aid, fid = uuid4(), uuid4(), uuid4()
    await db.execute(
        text("INSERT INTO projects(id,name,created_by_id) VALUES (:id,'attempt test',:uid)"),
        {"id": pid, "uid": SEED.primary_profile},
    )
    await db.execute(
        text("INSERT INTO project_members(project_id,user_id,role) VALUES (:id,:uid,'manager')"),
        {"id": pid, "uid": SEED.primary_profile},
    )
    await db.execute(
        text(
            "INSERT INTO articles(id,project_id,title,row_version) VALUES (:id,:pid,'attempt article',1)"
        ),
        {"id": aid, "pid": pid},
    )
    factory = TemplateFactory(db, pid, SEED.primary_profile)
    tid = await factory.create()
    etid = await factory.add_study_section(tid, name="study")
    await db.execute(
        text(
            "INSERT INTO extraction_fields(id,entity_type_id,name,label,field_type) VALUES (:id,:et,'value','Value','text')"
        ),
        {"id": fid, "et": etid},
    )
    run = await run_in_extract_at(db, project_id=pid, article_id=aid, template_id=tid)
    iid = uuid4()
    await db.execute(
        text(
            "INSERT INTO extraction_instances(id,project_id,template_id,entity_type_id,article_id,label,created_by) VALUES (:id,:pid,:tid,:et,:aid,'Study',:uid)"
        ),
        {"id": iid, "pid": pid, "tid": tid, "et": etid, "aid": aid, "uid": SEED.primary_profile},
    )
    await db.commit()
    try:
        yield (
            db,
            AttemptScope(project_id=pid, article_id=aid, template_id=tid, run_id=run.id),
            iid,
            fid,
        )
    finally:
        await db.rollback()
        await db.execute(text("DELETE FROM projects WHERE id=:id"), {"id": pid})
        await db.commit()


async def create(db, scope, request_id=None):
    return await ExtractionAttemptRepository(db).get_or_create(
        request_id=request_id or uuid4(),
        owner_id=SEED.primary_profile,
        scope=scope,
        request_payload={"entity_type_id": "study"},
        job_id=None,
    )


def proposal(scope, iid, fid, attempt=None):
    return ExtractionProposalRecord(
        run_id=scope.run_id,
        instance_id=iid,
        field_id=fid,
        source="ai",
        proposed_value={"text": "same"},
        extraction_attempt_id=attempt,
    )


async def test_replay_fresh_and_legacy(graph):
    db, scope, iid, fid = graph
    rid = uuid4()
    first, inserted = await create(db, scope, rid)
    replay, replayed = await create(db, scope, rid)
    different, _ = await create(db, scope)
    assert first.id == replay.id and inserted and not replayed
    assert different.request_id != first.request_id
    assert first.engine is None
    legacy = proposal(scope, iid, fid)
    db.add(legacy)
    await db.commit()
    assert legacy.extraction_attempt_id is None and legacy.generation_snapshot is None
    repo = ExtractionAttemptRepository(db)
    assert (await repo.get_owned(rid, SEED.primary_profile)).id == first.id
    assert await repo.get_owned(rid, SEED.outsider_profile) is None
    assert (await repo.lock(first.id)).id == first.id
    assert await repo.lock(uuid4()) is None


async def test_concurrent_request_insert(graph, _engine):
    _, scope, _, _ = graph
    sessions = async_sessionmaker(_engine, expire_on_commit=False)
    rid = uuid4()

    async def insert():
        async with sessions() as session:
            row, created = await create(session, scope, rid)
            await session.commit()
            return row.id, created

    first, second = await asyncio.gather(insert(), insert())
    assert first[0] == second[0]
    assert sorted([first[1], second[1]]) == [False, True]


async def test_unique_coordinate_and_deferred_attempt_delete(graph):
    db, scope, iid, fid = graph
    attempt, _ = await create(db, scope)
    aid = attempt.id
    db.add(proposal(scope, iid, fid, aid))
    await db.commit()
    db.add(proposal(scope, iid, fid, aid))
    with pytest.raises(IntegrityError):
        await db.commit()
    await db.rollback()
    await db.execute(delete(ExtractionAttempt).where(ExtractionAttempt.id == aid))
    with pytest.raises(IntegrityError):
        await db.commit()
    await db.rollback()
    assert (
        await db.execute(select(ExtractionAttempt.id).where(ExtractionAttempt.id == aid))
    ).scalar_one() == aid


@pytest.mark.parametrize("coordinate", ["project_id", "article_id", "template_id"])
async def test_attempt_scope_coherence(graph, coordinate):
    db, scope, _, _ = graph
    bad = scope.model_copy(update={coordinate: uuid4()})
    with pytest.raises(IntegrityError):
        await create(db, bad)
        await db.commit()


@pytest.mark.parametrize("table", ["articles", "projects"])
async def test_whole_graph_cascade(graph, table):
    db, scope, iid, fid = graph
    attempt, _ = await create(db, scope)
    aid = attempt.id
    db.add_all([proposal(scope, iid, fid, aid), proposal(scope, iid, fid)])
    await db.commit()
    await db.execute(
        text(f"DELETE FROM {table} WHERE id=:id"),
        {"id": scope.article_id if table == "articles" else scope.project_id},
    )
    await db.commit()
    assert (
        await db.execute(select(ExtractionAttempt.id).where(ExtractionAttempt.id == aid))
    ).scalar_one_or_none() is None


@pytest.mark.parametrize("role", ["anon", "authenticated"])
@pytest.mark.parametrize("uid", [SEED.primary_profile, SEED.outsider_profile])
@pytest.mark.parametrize(
    "statement",
    [
        "SELECT * FROM extraction_attempts",
        "INSERT INTO extraction_attempts DEFAULT VALUES",
        "UPDATE extraction_attempts SET status='failed'",
        "DELETE FROM extraction_attempts",
    ],
)
async def test_direct_client_denied(graph, role, uid, statement):
    db, scope, _, _ = graph
    await create(db, scope)
    await db.commit()
    await db.execute(
        text("SELECT set_config('request.jwt.claim.sub',:uid,true)"), {"uid": str(uid)}
    )
    await db.execute(text(f"SET LOCAL ROLE {role}"))
    with pytest.raises(DBAPIError, match="permission denied"):
        await db.execute(text(statement))


@pytest.mark.parametrize("coordinate", ["project_id", "article_id", "template_id"])
async def test_existing_foreign_scope_rejected(graph, coordinate):
    db, scope, _, _ = graph
    foreign = {
        "project_id": SEED.primary_project,
        "article_id": SEED.primary_article,
        "template_id": SEED.primary_template,
    }[coordinate]
    with pytest.raises(IntegrityError, match="attempt scope"):
        await create(db, scope.model_copy(update={coordinate: foreign}))
        await db.commit()


@pytest.mark.parametrize("coordinate", ["run_id", "instance_id", "field_id"])
async def test_proposal_foreign_coordinates_rejected(graph, coordinate):
    db, scope, iid, fid = graph
    attempt, _ = await create(db, scope)
    row = proposal(scope, iid, fid, attempt.id)
    if coordinate == "run_id":
        foreign_run = await run_in_extract_at(
            db,
            project_id=SEED.primary_project,
            article_id=SEED.primary_article,
            template_id=SEED.primary_template,
        )
        foreign = foreign_run.id
    else:
        foreign = {"instance_id": SEED.primary_instance, "field_id": SEED.primary_field}[coordinate]
    setattr(row, coordinate, foreign)
    db.add(row)
    with pytest.raises(IntegrityError, match="attempt proposal coordinates"):
        await db.flush()
    await db.rollback()


async def test_attempt_identity_is_immutable(graph):
    db, scope, _, _ = graph
    attempt, _ = await create(db, scope)
    await db.commit()
    attempt.request_id = uuid4()
    with pytest.raises(IntegrityError, match="immutable"):
        await db.commit()


async def test_proposal_commit_during_execution_lock(graph, _engine):
    db, scope, iid, fid = graph
    attempt, _ = await create(db, scope)
    aid = attempt.id
    await db.commit()
    sessions = async_sessionmaker(_engine, expire_on_commit=False)
    async with sessions() as owner:
        await ExtractionAttemptRepository(owner).lock(aid)
        await db.execute(text("SET LOCAL lock_timeout='1s'"))
        db.add(proposal(scope, iid, fid, aid))
        await db.commit()
        await owner.rollback()
