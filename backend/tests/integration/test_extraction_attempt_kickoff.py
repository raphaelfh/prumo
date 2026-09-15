"""Durable request replay and execution ownership against PostgreSQL."""

import asyncio
from uuid import uuid4

import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.core.error_handler import ConflictError
from app.schemas.extraction import SectionExtractionRequest
from app.services.extraction_attempt_service import ExtractionAttemptService
from tests.integration.conftest import SEED
from tests.integration.test_extraction_attempt_repository import graph as attempt_graph
from tests.integration.test_extraction_attempt_repository import proposal

graph = attempt_graph


def payload(scope, **changes):
    return SectionExtractionRequest(**(scope.model_dump() | changes))


async def test_same_request_replays_original_job(graph):
    db, scope, _, _ = graph
    service = ExtractionAttemptService(db)
    request = payload(scope, request_id=uuid4())
    first = await service.prepare_request(request, SEED.primary_profile, job_id=str(uuid4()))
    replay = await service.prepare_request(request, SEED.primary_profile, job_id=str(uuid4()))
    assert first.id == replay.id and first.job_id == replay.job_id
    fresh = await service.prepare_request(payload(scope), SEED.primary_profile, job_id=str(uuid4()))
    assert fresh.id != first.id


@pytest.mark.parametrize(
    "change",
    [{"pdf_text": "different"}, {"entity_type_id": uuid4()}, {"parent_instance_id": uuid4()}],
)
async def test_changed_request_conflicts(graph, change):
    db, scope, _, _ = graph
    service = ExtractionAttemptService(db)
    request = payload(scope, request_id=uuid4())
    await service.prepare_request(request, SEED.primary_profile, job_id="original")
    with pytest.raises(ConflictError):
        await service.prepare_request(
            request.model_copy(update=change), SEED.primary_profile, job_id="new"
        )


async def test_duplicate_ownership_waits_but_other_attempt_executes_and_fk_commits(graph, _engine):
    db, scope, iid, fid = graph
    service = ExtractionAttemptService(db)
    first = await service.prepare_request(payload(scope), SEED.primary_profile, job_id="one")
    other = await service.prepare_request(payload(scope), SEED.primary_profile, job_id="two")
    sessions = async_sessionmaker(_engine, expire_on_commit=False)
    entered, release, duplicate_started = asyncio.Event(), asyncio.Event(), asyncio.Event()
    calls = []

    async def operation(attempt):
        calls.append(attempt.id)
        async with sessions() as domain:
            domain.add(proposal(scope, iid, fid, attempt.id))
            await asyncio.wait_for(domain.commit(), 2)
        if attempt.id == first.id:
            entered.set()
            await release.wait()
        return {"user_id": str(attempt.owner_id), "mode": "single"}

    async def execute(aid, duplicate=False):
        async with sessions() as owner:
            if duplicate:
                duplicate_started.set()
            return await ExtractionAttemptService(owner).execute_attempt(aid, operation)

    task = asyncio.create_task(execute(first.id))
    await asyncio.wait_for(entered.wait(), 3)
    duplicate = asyncio.create_task(execute(first.id, True))
    await duplicate_started.wait()
    try:
        await asyncio.wait_for(execute(other.id), 3)
        assert not duplicate.done()
    finally:
        release.set()
    results = await asyncio.wait_for(asyncio.gather(task, duplicate), 3)
    assert results[0] == results[1]
    assert calls == [first.id, other.id]


async def test_http_replay_enqueue_failure_and_revoked_membership(graph, monkeypatch):
    from httpx import ASGITransport, AsyncClient
    from sqlalchemy import text

    from app.api.v1.endpoints import section_extraction as endpoint
    from app.core.deps import get_db
    from app.core.security import TokenPayload, get_current_user
    from app.main import app

    db, scope, _, _ = graph
    calls, owners = [], []
    unavailable = False

    def enqueue(**kwargs):
        calls.append(kwargs)
        if unavailable:
            raise ConnectionError("broker disconnected after accepting task")

    async def database():
        yield db

    async def user():
        return TokenPayload(
            sub=str(SEED.primary_profile),
            email="attempt@example.com",
            role="authenticated",
            aal="aal1",
        )

    monkeypatch.setattr(endpoint, "_is_queue_available", lambda: True)
    monkeypatch.setattr(endpoint, "_remember_job_owner", lambda *args: owners.append(args))
    monkeypatch.setattr(endpoint.run_section_extraction_task, "apply_async", enqueue)
    app.dependency_overrides[get_db] = database
    app.dependency_overrides[get_current_user] = user
    body = payload(scope, request_id=uuid4()).model_dump(mode="json", by_alias=True)
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            first = await client.post("/api/v1/extraction/sections", json=body)
            assert first.status_code == 202, first.text
            replay = await client.post("/api/v1/extraction/sections", json=body)
            assert replay.status_code == 202, replay.text
            assert first.json()["data"] == replay.json()["data"]
            unavailable = True
            failed = await client.post("/api/v1/extraction/sections", json=body)
            assert failed.status_code == 503
            unavailable = False
            recovered = await client.post("/api/v1/extraction/sections", json=body)
            assert recovered.json()["data"] == first.json()["data"]
            assert len({call["task_id"] for call in calls}) == 1
            assert len({call["kwargs"]["attempt_id"] for call in calls}) == 1
            assert len(owners) == 3
            conflict = await client.post(
                "/api/v1/extraction/sections", json=body | {"pdfText": "changed"}
            )
            assert conflict.status_code == 409, conflict.text
            await db.rollback()
            await db.execute(
                text(
                    "INSERT INTO project_members(project_id,user_id,role) VALUES (:pid,:uid,'manager')"
                ),
                {"pid": scope.project_id, "uid": SEED.outsider_profile},
            )
            await db.execute(
                text("DELETE FROM project_members WHERE project_id=:pid AND user_id=:uid"),
                {"pid": scope.project_id, "uid": SEED.primary_profile},
            )
            await db.commit()
            forbidden = await client.post("/api/v1/extraction/sections", json=body)
            assert forbidden.status_code == 403, forbidden.text
            assert len(calls) == 4
    finally:
        app.dependency_overrides.clear()


async def test_omitted_run_is_bound_once(graph):
    from sqlalchemy import select

    from app.models.extraction import ExtractionInstance

    db, scope, iid, _ = graph
    instance = (
        await db.execute(select(ExtractionInstance).where(ExtractionInstance.id == iid))
    ).scalar_one()
    request = payload(
        scope, run_id=None, entity_type_id=instance.entity_type_id, request_id=uuid4()
    )
    service = ExtractionAttemptService(db)
    first = await service.prepare_request(request, SEED.primary_profile, job_id="original")
    replay = await service.prepare_request(request, SEED.primary_profile, job_id="new")
    assert first.id == replay.id
    assert replay.request_payload["run_id"] == str(scope.run_id)


async def test_foreign_owner_cannot_retrieve_job(graph):
    from app.core.error_handler import NotFoundError

    db, scope, _, _ = graph
    service = ExtractionAttemptService(db)
    request = payload(scope, request_id=uuid4())
    await service.prepare_request(request, SEED.primary_profile, job_id="secret")
    with pytest.raises(NotFoundError) as error:
        await service.prepare_request(request, SEED.outsider_profile, job_id="new")
    assert "secret" not in str(error.value)


async def test_execution_retry_rolls_back_claim_and_terminal_failure_replays(graph):
    from app.services.extraction_errors import ExtractionTaskError

    db, scope, _, _ = graph
    service = ExtractionAttemptService(db)
    attempt = await service.prepare_request(payload(scope), SEED.primary_profile, job_id="job")
    aid = attempt.id
    calls = 0

    async def failure(_):
        nonlocal calls
        calls += 1
        raise FileNotFoundError("missing PDF")

    with pytest.raises(FileNotFoundError):
        await service.execute_attempt(aid, failure, retryable=lambda _: True)
    with pytest.raises(FileNotFoundError):
        await service.execute_attempt(aid, failure)
    with pytest.raises(ExtractionTaskError) as error:
        await service.execute_attempt(aid, failure)
    assert error.value.error_code == "PDF_NOT_FOUND"
    assert calls == 2


async def test_cancelled_execution_releases_ownership_for_retry(graph):
    db, scope, _, _ = graph
    service = ExtractionAttemptService(db)
    attempt = await service.prepare_request(payload(scope), SEED.primary_profile, job_id="job")
    aid = attempt.id

    async def interrupted(_):
        raise asyncio.CancelledError()

    async def success(_):
        return {"mode": "single"}

    with pytest.raises(asyncio.CancelledError):
        await service.execute_attempt(aid, interrupted)
    assert await service.execute_attempt(aid, success) == {"mode": "single"}


async def test_execution_emits_no_key_update_and_keeps_identity(graph, _engine):
    from sqlalchemy import event

    db, scope, _, _ = graph
    service = ExtractionAttemptService(db)
    attempt = await service.prepare_request(payload(scope), SEED.primary_profile, job_id="job")
    identity = (attempt.id, attempt.run_id, attempt.request_id, attempt.owner_id)
    statements = []

    def capture(_conn, _cursor, statement, _parameters, _context, _many):
        statements.append(statement)

    async def operation(row):
        assert (row.id, row.run_id, row.request_id, row.owner_id) == identity
        return {"mode": "single"}

    event.listen(_engine.sync_engine, "before_cursor_execute", capture)
    try:
        await service.execute_attempt(attempt.id, operation)
    finally:
        event.remove(_engine.sync_engine, "before_cursor_execute", capture)
    assert any("FOR NO KEY UPDATE" in sql for sql in statements)
    assert not any("FOR UPDATE" in sql or "FOR SHARE" in sql for sql in statements)
