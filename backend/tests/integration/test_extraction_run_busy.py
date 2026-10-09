"""AI extraction against a run in CONSENSUS is a typed RUN_BUSY refusal."""

from types import SimpleNamespace
from uuid import uuid4

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.models.extraction import ExtractionInstance, ExtractionRunStage
from app.models.extraction_attempt import ExtractionAttempt
from app.schemas.extraction import SectionExtractionRequest
from app.services.extraction_attempt_service import ExtractionAttemptService
from app.services.extraction_batch_dispatcher import ExtractionBatchDispatcher
from app.services.extraction_errors import ExtractionTaskError
from app.services.extraction_run_write import RunWriteError, open_run_for_write
from app.services.run_lifecycle_service import RunLifecycleService
from tests.integration.conftest import SEED
from tests.integration.test_extraction_attempt_repository import graph as attempt_graph

graph = attempt_graph


def payload(scope, **changes):
    return SectionExtractionRequest(**(scope.model_dump() | changes))


async def to_consensus(db, run_id):
    await RunLifecycleService(db).advance_stage(
        run_id=run_id, target_stage=ExtractionRunStage.CONSENSUS, user_id=SEED.primary_profile
    )
    await db.commit()


@pytest.mark.parametrize("with_run_id", [True, False])
async def test_kickoff_on_consensus_run_is_409_run_busy(graph, monkeypatch, with_run_id):
    from app.api.v1.endpoints import section_extraction as endpoint
    from app.core.deps import get_db
    from app.core.security import TokenPayload, get_current_user
    from app.main import app

    db, scope, iid, _ = graph
    instance = await db.get(ExtractionInstance, iid)
    await to_consensus(db, scope.run_id)
    calls = []

    async def database():
        yield db

    async def user():
        return TokenPayload(
            sub=str(SEED.primary_profile),
            email="busy@example.com",
            role="authenticated",
            aal="aal1",
        )

    monkeypatch.setattr(endpoint, "_is_queue_available", lambda: True)
    monkeypatch.setattr(endpoint, "_remember_job_owner", lambda *_: None)
    monkeypatch.setattr(
        endpoint.run_section_extraction_task, "apply_async", lambda **kw: calls.append(kw)
    )
    app.dependency_overrides[get_db] = database
    app.dependency_overrides[get_current_user] = user
    target = {} if with_run_id else {"run_id": None, "entity_type_id": instance.entity_type_id}
    request = payload(scope, request_id=uuid4(), **target)
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            response = await client.post(
                "/api/v1/extraction/sections",
                json=request.model_dump(mode="json", by_alias=True),
            )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 409, response.text
    error = response.json()["error"]
    assert error["code"] == "RUN_BUSY"
    assert error["details"] == {"run_id": str(scope.run_id)}
    assert str(scope.run_id) not in error["message"]
    assert calls == []


async def test_queued_attempt_whose_run_reached_consensus_fails_run_busy(graph, _engine):
    db, scope, _, _ = graph
    attempt = await ExtractionAttemptService(db).prepare_request(
        payload(scope), SEED.primary_profile, job_id="job"
    )
    await db.commit()
    await to_consensus(db, scope.run_id)
    sessions = async_sessionmaker(_engine, expire_on_commit=False)

    async def operation(row):
        # The worker's first domain step: the run-write oracle gates EXTRACT.
        async with sessions() as domain:
            await open_run_for_write(domain, row.run_id, expect=ExtractionRunStage.EXTRACT.only())
        return {}

    async with sessions() as owner:
        with pytest.raises(RunWriteError):
            await ExtractionAttemptService(owner).execute_attempt(attempt.id, operation)
    async with sessions() as owner:
        with pytest.raises(ExtractionTaskError) as replay:
            await ExtractionAttemptService(owner).execute_attempt(attempt.id, operation)
        row = await owner.get(ExtractionAttempt, attempt.id)
    assert replay.value.error_code == "RUN_BUSY"
    assert (row.status, row.error_code) == ("failed", "RUN_BUSY")
    assert str(scope.run_id) not in row.error


async def test_batch_dispatcher_still_skips_consensus_as_run_not_editable(graph):
    db, scope, _, _ = graph
    await to_consensus(db, scope.run_id)
    dispatcher = ExtractionBatchDispatcher(db, enqueue=lambda *_: None)
    batch = SimpleNamespace(owner_id=SEED.primary_profile, skip_articles_with_ai_suggestions=False)
    assert await dispatcher._run_reason(batch, uuid4(), scope.run_id) == "RUN_NOT_EDITABLE"
