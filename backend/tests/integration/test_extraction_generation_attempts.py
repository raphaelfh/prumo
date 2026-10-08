"""Attempt-owned generation against committed rows: the model runs outside the
run lock, and what changed while it ran decides whether its result lands.

Each test drives ``AiExtraction.run_from_request`` on a worker-owned session
(``owns_transactions``: commit before every external call, after every
landing) with the recorded model fake; ``during`` commits a change from a
second session while a call is in flight. The per-row attempt rules (replay
idempotency, sanitized snapshots, the post-model exclusion re-read, the
landing savepoint) are pinned on the seam itself in ``test_proposal_landing``.
"""

import asyncio
from typing import Any
from uuid import uuid4

import pytest
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.core.error_handler import AuthorizationError
from app.llm.prompts import entry_identification
from app.models.extraction import ExtractionEvidence, ExtractionInstance, ExtractionRun
from app.models.extraction_attempt import ExtractionAttempt
from app.models.extraction_workflow import ExtractionProposalRecord
from app.repositories import ExtractionRunRepository
from app.schemas.extraction import SectionExtractionRequest
from app.schemas.llm_target import LlmTarget
from app.services.extraction_attempt_service import ExtractionAttemptService
from app.services.extraction_run_write import RunWriteError
from app.services.llm_engine_service import LlmEngineService, resolve_engine
from app.services.run_engine_freeze import freeze_attempt_engine, freeze_run_engine
from tests.factories.template_factory import TemplateFactory
from tests.fakes.recorded_llm import Call, RecordedLlm
from tests.integration.conftest import SEED
from tests.integration.helpers.ai_extraction import (
    extraction,
    request,
    run_in_extract,
    seed_article_text,
)
from tests.integration.test_entry_group_extraction import _fake, _group
from tests.integration.test_extraction_attempt_repository import create as create_attempt
from tests.integration.test_extraction_attempt_repository import graph as attempt_graph

graph = attempt_graph

#: The graph template's one field answers this, with a cited quote.
LATE = {"value": {"value": "late", "evidence": [{"text": "late citation", "page_number": 1}]}}


def _section_request(scope: Any, entity_type_id: Any) -> SectionExtractionRequest:
    return SectionExtractionRequest(
        project_id=scope.project_id,
        article_id=scope.article_id,
        template_id=scope.template_id,
        entity_type_id=entity_type_id,
        run_id=scope.run_id,
    )


async def _seed_text(db: Any, scope: Any) -> None:
    await seed_article_text(
        db, "late citation", project_id=scope.project_id, article_id=scope.article_id
    )
    await db.commit()


async def _count(db: Any, model: Any, *where: Any) -> int:
    return await db.scalar(select(func.count()).select_from(model).where(*where))


async def test_attempt_pin_survives_run_summary_repin(db_session):
    run = await run_in_extract(db_session)
    attempt = ExtractionAttempt(
        request_id=uuid4(),
        owner_id=SEED.primary_profile,
        project_id=run.project_id,
        article_id=run.article_id,
        template_id=run.template_id,
        run_id=run.id,
        request_payload={},
    )
    db_session.add(attempt)
    await db_session.flush()
    first = LlmTarget(provider="openai", model="gpt-5.6-luna")
    other = LlmTarget(provider="anthropic", model="claude-sonnet-5")
    assert await freeze_attempt_engine(db_session, attempt.id, first) == first
    await freeze_run_engine(ExtractionRunRepository(db_session), run.id, other, repin=True)
    assert await freeze_attempt_engine(db_session, attempt.id, other) == first


async def test_independent_attempts_enter_llm_concurrently_and_retry_uses_pin(graph, _engine):
    db, scope, iid, _ = graph
    entity_id = (await db.get(ExtractionInstance, iid)).entity_type_id
    second_entity = await TemplateFactory(
        db, scope.project_id, SEED.primary_profile
    ).add_study_section(scope.template_id, name="second_study")
    await db.execute(
        text(
            "INSERT INTO extraction_fields(id,entity_type_id,name,label,field_type) "
            "VALUES (:id,:et,'value','Value','text')"
        ),
        {"id": uuid4(), "et": second_entity},
    )
    payload = _section_request(scope, entity_id)
    second_payload = payload.model_copy(update={"entity_type_id": second_entity})
    attempt_service = ExtractionAttemptService(db)
    first = await attempt_service.prepare_request(payload, SEED.primary_profile, job_id="first")
    second = await attempt_service.prepare_request(
        second_payload, SEED.primary_profile, job_id="second"
    )
    target_a = LlmTarget(provider="openai", model="gpt-5.6-luna")
    target_b = LlmTarget(provider="anthropic", model="claude-sonnet-5")
    await LlmEngineService(db).set_for_project(
        project_id=scope.project_id,
        provider=target_a.provider,
        model=target_a.model,
        mode="fast",
        updated_by=SEED.primary_profile,
    )
    await freeze_attempt_engine(
        db, first.id, await resolve_engine(db, scope.project_id, SEED.primary_profile)
    )
    await db.commit()
    await _seed_text(db, scope)
    sessions = async_sessionmaker(_engine, expire_on_commit=False)
    entered, both_entered = asyncio.Event(), asyncio.Event()
    active = 0

    async def barrier(_call: Call) -> None:
        # Both attempts must be INSIDE their model call at once: neither holds
        # the run lock across it.
        nonlocal active
        active += 1
        if active == 1:
            entered.set()
            await asyncio.wait_for(both_entered.wait(), 3)
        else:
            both_entered.set()

    fake = RecordedLlm(fields={"value": {"value": "same"}}, during=barrier)

    async def execute(aid, crash=False):
        async with sessions() as ownership:

            async def operation(_attempt):
                async with sessions() as domain:
                    result = await extraction(
                        domain, fake, attempt_id=aid, owns_transactions=True
                    ).run_from_request(second_payload if aid == second.id else payload)
                    await domain.commit()
                    if crash:
                        raise RuntimeError("crash after proposal commit")
                    return {"suggestions_created": result.suggestions_created}

            return await ExtractionAttemptService(ownership).execute_attempt(
                aid, operation, retryable=lambda _: True
            )

    a = asyncio.create_task(execute(first.id, crash=True))
    await asyncio.wait_for(entered.wait(), 3)
    await LlmEngineService(db).set_for_project(
        project_id=scope.project_id,
        provider=target_b.provider,
        model=target_b.model,
        mode="fast",
        updated_by=SEED.primary_profile,
    )
    await freeze_attempt_engine(
        db, second.id, await resolve_engine(db, scope.project_id, SEED.primary_profile)
    )
    await db.commit()
    b = asyncio.create_task(execute(second.id))
    results = await asyncio.wait_for(asyncio.gather(a, b, return_exceptions=True), 8)
    assert isinstance(results[0], RuntimeError)
    assert results[1] == {"suggestions_created": 1}
    # The retry re-runs the model on the attempt's PINNED engine, and lands
    # nothing new: its rows were committed before the crash.
    assert await execute(first.id) == {"suggestions_created": 0}
    engines = [(c.model.system, c.model.model_name) for c in fake.field_calls()]
    assert engines == [
        (target_a.provider, target_a.model),
        (target_b.provider, target_b.model),
        (target_a.provider, target_a.model),
    ]
    assert await execute(first.id) == {"suggestions_created": 0}
    assert len(fake.field_calls()) == 3
    assert (
        await _count(db, ExtractionProposalRecord, ExtractionProposalRecord.run_id == scope.run_id)
        == 2
    )


async def test_lifecycle_closure_during_llm_prevents_results(graph, _engine):
    db, scope, iid, _ = graph
    entity_id = (await db.get(ExtractionInstance, iid)).entity_type_id
    await _seed_text(db, scope)
    sessions = async_sessionmaker(_engine, expire_on_commit=False)

    async def cancel(_call: Call) -> None:
        async with sessions() as other:
            await other.execute(
                text("UPDATE extraction_runs SET stage='cancelled' WHERE id=:id"),
                {"id": scope.run_id},
            )
            await other.commit()

    fake = RecordedLlm(fields={"value": {"value": "late"}}, during=cancel)
    with pytest.raises(RunWriteError, match="not 'extract'"):
        await extraction(db, fake, owns_transactions=True).run_from_request(
            _section_request(scope, entity_id)
        )
    assert (
        await _count(db, ExtractionProposalRecord, ExtractionProposalRecord.run_id == scope.run_id)
        == 0
    )


async def _attempt_with_side_effect(graph, _engine, side_effect):
    """Run one attempt-owned section extraction; ``side_effect`` commits in
    another session while the model call is in flight. Returns the outcome
    and the row counts."""
    db, scope, iid, _ = graph
    entity_id = (await db.get(ExtractionInstance, iid)).entity_type_id
    attempt, _ = await create_attempt(db, scope)
    await freeze_attempt_engine(db, attempt.id, LlmTarget(provider="openai", model="gpt-5.6-luna"))
    await db.commit()
    await _seed_text(db, scope)
    member = text("SELECT public.is_project_member(:pid, :uid)")
    assert await db.scalar(member, {"pid": scope.project_id, "uid": SEED.primary_profile})
    sessions = async_sessionmaker(_engine, expire_on_commit=False)

    async def during(call: Call) -> None:
        if call.prompt_name == entry_identification.NAME:
            return
        async with sessions() as other:
            await side_effect(other, scope)
            await other.commit()

    fake = RecordedLlm(fields=LATE, during=during)
    try:
        outcome = await extraction(
            db, fake, attempt_id=attempt.id, owns_transactions=True
        ).run_from_request(_section_request(scope, entity_id))
    except Exception as exc:  # the caller asserts the exact error
        outcome = exc
    await db.rollback()
    assert len(fake.field_calls()) == 1  # the side effect really landed mid-call

    return outcome, {
        "proposals": await _count(
            db, ExtractionProposalRecord, ExtractionProposalRecord.run_id == scope.run_id
        ),
        "evidence": await _count(db, ExtractionEvidence, ExtractionEvidence.run_id == scope.run_id),
        "instances": await _count(
            db, ExtractionInstance, ExtractionInstance.entity_type_id == entity_id
        ),
    }


async def test_attempt_result_is_written_when_authority_holds(graph, _engine):
    async def nothing(_other, _scope):
        return None

    outcome, counts = await _attempt_with_side_effect(graph, _engine, nothing)
    assert outcome.suggestions_created == 1
    assert counts == {"proposals": 1, "evidence": 1, "instances": 1}


async def test_membership_revoked_during_llm_prevents_results(graph, _engine):
    async def revoke(other, scope):
        # A project must retain a manager, so another one takes over first.
        await other.execute(
            text(
                "INSERT INTO project_members(project_id,user_id,role) VALUES (:pid,:uid,'manager')"
            ),
            {"pid": scope.project_id, "uid": SEED.outsider_profile},
        )
        await other.execute(
            text("DELETE FROM project_members WHERE project_id=:pid AND user_id=:uid"),
            {"pid": scope.project_id, "uid": SEED.primary_profile},
        )

    outcome, counts = await _attempt_with_side_effect(graph, _engine, revoke)
    assert isinstance(outcome, AuthorizationError), outcome
    assert "Project membership is required" in str(outcome)
    assert counts == {"proposals": 0, "evidence": 0, "instances": 1}


async def test_run_deleted_during_llm_prevents_results(graph, _engine):
    async def delete_run(other, scope):
        await other.execute(text("DELETE FROM extraction_runs WHERE id=:id"), {"id": scope.run_id})

    outcome, counts = await _attempt_with_side_effect(graph, _engine, delete_run)
    db, scope, _, _ = graph
    assert isinstance(outcome, RunWriteError), outcome
    assert outcome.reason == "missing"
    assert f"Run {scope.run_id} not found" in str(outcome)
    assert await db.get(ExtractionRun, scope.run_id) is None
    assert counts == {"proposals": 0, "evidence": 0, "instances": 1}


async def test_synchronous_generation_preserves_caller_rollback(graph):
    """Without ``owns_transactions`` nothing commits: the caller's rollback
    discards the landed rows."""
    db, scope, iid, _ = graph
    entity_id = (await db.get(ExtractionInstance, iid)).entity_type_id
    await _seed_text(db, scope)
    result = await extraction(
        db, RecordedLlm(fields={"value": {"value": "temporary"}})
    ).run_from_request(_section_request(scope, entity_id))
    assert result.suggestions_created == 1
    await db.rollback()
    assert (
        await _count(db, ExtractionProposalRecord, ExtractionProposalRecord.run_id == scope.run_id)
        == 0
    )


async def test_repeating_entries_keep_distinct_call_snapshots(db_session):
    """Each entry's call lands with ITS OWN snapshot (tokens, scoped prompt),
    never its sibling's."""
    entity_id, _, _ = await _group(db_session)
    run = await run_in_extract(db_session)
    attempt = ExtractionAttempt(
        request_id=uuid4(),
        owner_id=SEED.primary_profile,
        project_id=run.project_id,
        article_id=run.article_id,
        template_id=run.template_id,
        run_id=run.id,
        request_payload={},
        engine={"provider": "openai", "model": "gpt-5.6-luna"},
    )
    db_session.add(attempt)
    await db_session.flush()
    fake = _fake(["apparent", "internal"])

    async def grow_usage(call: Call) -> None:
        if call.prompt_name != entry_identification.NAME:
            fake.usage = fake.usage + fake.usage

    fake.during = grow_usage
    await seed_article_text(db_session)
    result = await extraction(db_session, fake, attempt_id=attempt.id).run_from_request(
        request(entity_type_id=entity_id, run_id=run.id)
    )
    assert result.suggestions_created == 4  # key + value, per entry
    records = list(
        (
            await db_session.scalars(
                select(ExtractionProposalRecord).where(
                    ExtractionProposalRecord.extraction_attempt_id == attempt.id
                )
            )
        ).all()
    )
    by_entry: dict[str, dict[str, Any]] = {}
    for record in records:
        by_entry[record.generation_snapshot["prompt_composition"]["section_instruction"]] = (
            record.generation_snapshot
        )
    snapshots = sorted(by_entry.values(), key=lambda s: s["tokens"]["prompt"])
    assert [s["tokens"]["prompt"] for s in snapshots] == [20, 40]
    assert '"apparent"' in snapshots[0]["prompt_composition"]["section_instruction"]
    assert '"internal"' in snapshots[1]["prompt_composition"]["section_instruction"]


async def test_cancel_during_identification_does_not_commit_instance(graph, _engine):
    """The run closes while entries are being identified: the entry gate
    refuses, no entry instance is committed, no field call is spent."""
    db, scope, iid, fid = graph
    etid = (await db.get(ExtractionInstance, iid)).entity_type_id
    await db.execute(
        text(
            "UPDATE extraction_entity_types SET cardinality='many', entry_label='entry' "
            "WHERE id=:id"
        ),
        {"id": etid},
    )
    await db.execute(
        text("UPDATE extraction_fields SET is_entity_key=true WHERE id=:id"), {"id": fid}
    )
    await db.commit()
    await _seed_text(db, scope)
    sessions = async_sessionmaker(_engine, expire_on_commit=False)

    async def cancel(call: Call) -> None:
        if call.prompt_name != entry_identification.NAME:
            return
        async with sessions() as other:
            await other.execute(
                text("UPDATE extraction_runs SET stage='cancelled' WHERE id=:id"),
                {"id": scope.run_id},
            )
            await other.commit()

    fake = RecordedLlm(entries=["late-entry"], during=cancel)
    with pytest.raises(RunWriteError, match="not 'extract'"):
        await extraction(db, fake, owns_transactions=True).run_from_request(
            _section_request(scope, etid)
        )
    await db.rollback()
    async with sessions() as other:
        count = await other.scalar(
            text(
                "SELECT count(*) FROM extraction_instances "
                "WHERE entity_type_id=:id AND label='late-entry'"
            ),
            {"id": etid},
        )
        assert count == 0
    assert fake.field_calls() == []
