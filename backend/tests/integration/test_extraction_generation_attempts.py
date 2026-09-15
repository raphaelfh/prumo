"""Attempt generations append, while technical replay preserves immutable facts."""

from uuid import uuid4

from sqlalchemy import select

from app.models.extraction import ExtractionEvidence
from app.models.extraction_attempt import ExtractionAttempt
from app.models.extraction_workflow import ExtractionProposalRecord
from tests.integration.conftest import SEED
from tests.integration.test_extraction_attempt_repository import create as create_attempt
from tests.integration.test_extraction_attempt_repository import graph as attempt_graph
from tests.integration.test_section_extraction_evidence import _build_run_in_extract, _make_service


async def test_fresh_equal_value_attempts_and_replay_preserve_evidence(db_session):
    run = await _build_run_in_extract(db_session)
    service = _make_service(db_session)
    attempts = []
    for _ in range(2):
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
        attempts.append(attempt)
    await db_session.flush()

    async def write(attempt, tokens, quote):
        return await service._create_suggestions(
            project_id=run.project_id,
            article_id=run.article_id,
            entity_type_id=SEED.primary_entity_type,
            parent_instance_id=None,
            run=run,
            attempt_id=attempt.id,
            generation_snapshot={"tokens": {"total": tokens}, "ran_by_user_id": "secret"},
            extracted_data={
                "sample_size": {
                    "value": 142,
                    "status": "found",
                    "reasoning": quote,
                    "evidence": [{"text": quote, "page_number": 1}],
                }
            },
        )

    assert await write(attempts[0], 10, "first citation") == 1
    assert await write(attempts[0], 999, "replay citation") == 0
    assert await write(attempts[1], 20, "second citation") == 1
    proposals = list(
        (
            await db_session.scalars(
                select(ExtractionProposalRecord).where(ExtractionProposalRecord.run_id == run.id)
            )
        ).all()
    )
    evidence = list(
        (
            await db_session.scalars(
                select(ExtractionEvidence).where(ExtractionEvidence.run_id == run.id)
            )
        ).all()
    )
    assert len(proposals) == len(evidence) == 2
    by_attempt = {p.extraction_attempt_id: p for p in proposals}
    first, second = (by_attempt[a.id] for a in attempts)
    assert first.id != second.id
    assert first.rationale == "first citation"
    assert first.generation_snapshot == {"tokens": {"total": 10}}
    assert second.generation_snapshot == {"tokens": {"total": 20}}
    assert {(e.proposal_record_id, e.text_content) for e in evidence} == {
        (first.id, "first citation"),
        (second.id, "second citation"),
    }


async def test_attempt_pin_survives_run_summary_repin(db_session):
    from app.repositories import ExtractionRunRepository
    from app.schemas.llm_target import LlmTarget
    from app.services.run_engine_freeze import freeze_attempt_engine, freeze_run_engine

    run = await _build_run_in_extract(db_session)
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


graph = attempt_graph


async def test_independent_attempts_enter_llm_concurrently_and_retry_uses_pin(
    graph, _engine, monkeypatch
):
    import asyncio
    from unittest.mock import AsyncMock, MagicMock

    from sqlalchemy.ext.asyncio import async_sessionmaker

    from app.llm.extractor import LlmUsage
    from app.models.extraction import ExtractionInstance
    from app.schemas.extraction import SectionExtractionRequest
    from app.schemas.llm_target import LlmTarget
    from app.services import section_extraction_service as ses
    from app.services.extraction_attempt_service import ExtractionAttemptService
    from app.services.run_engine_freeze import freeze_attempt_engine, read_attempt_engine

    db, scope, iid, _ = graph
    entity_id = (await db.get(ExtractionInstance, iid)).entity_type_id
    from sqlalchemy import text

    from app.services.llm_engine_service import LlmEngineService, resolve_engine
    from tests.factories.template_factory import TemplateFactory

    second_entity = await TemplateFactory(
        db, scope.project_id, SEED.primary_profile
    ).add_study_section(scope.template_id, name="second_study")
    await db.execute(
        text(
            "INSERT INTO extraction_fields(id,entity_type_id,name,label,field_type) VALUES (:id,:et,'value','Value','text')"
        ),
        {"id": uuid4(), "et": second_entity},
    )
    payload = SectionExtractionRequest(**scope.model_dump(), entity_type_id=entity_id)
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
    sessions = async_sessionmaker(_engine, expire_on_commit=False)
    entered, both_entered = asyncio.Event(), asyncio.Event()
    calls = []
    active = 0

    async def extract(**kwargs):
        nonlocal active
        calls.append(kwargs["model"])
        active += 1
        if active == 1:
            entered.set()
            await asyncio.wait_for(both_entered.wait(), 3)
        else:
            both_entered.set()
        return MagicMock(), LlmUsage(prompt_tokens=len(calls), completion_tokens=1)

    monkeypatch.setattr(
        ses, "build_model", lambda provider, model_name, **_kwargs: (provider, model_name)
    )
    monkeypatch.setattr(ses, "extract_structured", extract)
    monkeypatch.setattr(
        ses,
        "dump_extraction",
        lambda _: {"value": {"value": "same", "status": "found", "evidence": []}},
    )
    monkeypatch.setattr(
        ses.SectionExtractionService, "_assemble_prompt_text", AsyncMock(return_value="article")
    )

    async def execute(aid, crash=False):
        async with sessions() as ownership:

            async def operation(_attempt):
                async with sessions() as domain:
                    target = await read_attempt_engine(domain, aid)
                    service = ses.SectionExtractionService(
                        domain,
                        str(SEED.primary_profile),
                        MagicMock(),
                        "concurrent",
                        attempt_id=aid,
                        owns_transactions=True,
                    )
                    result = await service.run_from_request(
                        second_payload if aid == second.id else payload, engine=target
                    )
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
    assert await execute(first.id) == {"suggestions_created": 0}
    assert calls == [
        (target_a.provider, target_a.model),
        (target_b.provider, target_b.model),
        (target_a.provider, target_a.model),
    ]
    assert await execute(first.id) == {"suggestions_created": 0}
    assert len(calls) == 3
    records = list(
        (
            await db.scalars(
                select(ExtractionProposalRecord).where(
                    ExtractionProposalRecord.run_id == scope.run_id
                )
            )
        ).all()
    )
    assert len(records) == 2


async def test_lifecycle_closure_during_llm_prevents_results(graph, _engine, monkeypatch):
    from unittest.mock import AsyncMock, MagicMock

    import pytest
    from sqlalchemy import text
    from sqlalchemy.ext.asyncio import async_sessionmaker

    from app.llm.extractor import LlmUsage
    from app.models.extraction import ExtractionInstance
    from app.services import section_extraction_service as ses
    from app.services.extraction_proposal_service import InvalidProposalError

    db, scope, iid, _ = graph
    entity_id = (await db.get(ExtractionInstance, iid)).entity_type_id
    sessions = async_sessionmaker(_engine, expire_on_commit=False)

    async def extract(**_kwargs):
        async with sessions() as other:
            await other.execute(
                text("UPDATE extraction_runs SET stage='cancelled' WHERE id=:id"),
                {"id": scope.run_id},
            )
            await other.commit()
        return MagicMock(), LlmUsage()

    monkeypatch.setattr(ses, "build_model", lambda *_a, **_kw: MagicMock())
    monkeypatch.setattr(ses, "extract_structured", extract)
    monkeypatch.setattr(
        ses, "dump_extraction", lambda _: {"value": {"value": "late", "status": "found"}}
    )
    monkeypatch.setattr(
        ses.SectionExtractionService, "_assemble_prompt_text", AsyncMock(return_value="article")
    )
    service = ses.SectionExtractionService(
        db, str(SEED.primary_profile), MagicMock(), "closure", owns_transactions=True
    )
    with pytest.raises(InvalidProposalError, match="extract stage"):
        await service.extract_section(
            project_id=scope.project_id,
            article_id=scope.article_id,
            template_id=scope.template_id,
            entity_type_id=entity_id,
            run_id=scope.run_id,
        )
    assert not list(
        (
            await db.scalars(
                select(ExtractionProposalRecord).where(
                    ExtractionProposalRecord.run_id == scope.run_id
                )
            )
        ).all()
    )


async def _attempt_extraction_with_llm_side_effect(graph, _engine, monkeypatch, side_effect):
    """Run one attempt-owned section extraction; ``side_effect`` commits in another
    session while the model call is in flight. Returns the outcome and the counts."""
    from unittest.mock import AsyncMock, MagicMock

    from sqlalchemy import func, text
    from sqlalchemy.ext.asyncio import async_sessionmaker

    from app.llm.extractor import LlmUsage
    from app.models.extraction import ExtractionInstance
    from app.schemas.llm_target import LlmTarget
    from app.services import section_extraction_service as ses
    from app.services.run_engine_freeze import freeze_attempt_engine

    db, scope, iid, _ = graph
    entity_id = (await db.get(ExtractionInstance, iid)).entity_type_id
    attempt, _ = await create_attempt(db, scope)
    await freeze_attempt_engine(db, attempt.id, LlmTarget(provider="openai", model="gpt-5.6-luna"))
    await db.commit()
    member_query = text("SELECT public.is_project_member(:pid, :uid)")
    member_args = {"pid": scope.project_id, "uid": SEED.primary_profile}
    assert await db.scalar(member_query, member_args)  # precondition: a member at kickoff
    sessions = async_sessionmaker(_engine, expire_on_commit=False)
    llm_calls = 0

    async def extract(**_kwargs):
        nonlocal llm_calls
        llm_calls += 1
        async with sessions() as other:
            await side_effect(other, scope)
            await other.commit()
        return MagicMock(), LlmUsage()

    monkeypatch.setattr(ses, "build_model", lambda *_a, **_kw: MagicMock())
    monkeypatch.setattr(ses, "extract_structured", extract)
    monkeypatch.setattr(
        ses,
        "dump_extraction",
        lambda _: {
            "value": {
                "value": "late",
                "status": "found",
                "evidence": [{"text": "late citation", "page_number": 1}],
            }
        },
    )
    monkeypatch.setattr(
        ses.SectionExtractionService, "_assemble_prompt_text", AsyncMock(return_value="article")
    )
    service = ses.SectionExtractionService(
        db,
        str(SEED.primary_profile),
        MagicMock(),
        "authority-recheck",
        attempt_id=attempt.id,
        owns_transactions=True,
    )
    try:
        outcome = await service.extract_section(
            project_id=scope.project_id,
            article_id=scope.article_id,
            template_id=scope.template_id,
            entity_type_id=entity_id,
            run_id=scope.run_id,
        )
    except Exception as exc:  # the caller asserts the exact error
        outcome = exc
    await db.rollback()
    assert llm_calls == 1  # the side effect really landed mid-call, after kickoff

    async def count(model, *where):
        return await db.scalar(select(func.count()).select_from(model).where(*where))

    return outcome, {
        "proposals": await count(
            ExtractionProposalRecord, ExtractionProposalRecord.run_id == scope.run_id
        ),
        "evidence": await count(ExtractionEvidence, ExtractionEvidence.run_id == scope.run_id),
        "instances": await count(
            ExtractionInstance, ExtractionInstance.entity_type_id == entity_id
        ),
    }


async def test_attempt_result_is_written_when_authority_holds(graph, _engine, monkeypatch):
    async def nothing(_other, _scope):
        return None

    outcome, counts = await _attempt_extraction_with_llm_side_effect(
        graph, _engine, monkeypatch, nothing
    )
    assert outcome.suggestions_created == 1
    assert counts == {"proposals": 1, "evidence": 1, "instances": 1}


async def test_membership_revoked_during_llm_prevents_results(graph, _engine, monkeypatch):
    from sqlalchemy import text

    from app.core.error_handler import AuthorizationError

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

    outcome, counts = await _attempt_extraction_with_llm_side_effect(
        graph, _engine, monkeypatch, revoke
    )
    assert isinstance(outcome, AuthorizationError), outcome
    assert "Project membership is required" in str(outcome)
    assert counts == {"proposals": 0, "evidence": 0, "instances": 1}


async def test_run_deleted_during_llm_prevents_results(graph, _engine, monkeypatch):
    from sqlalchemy import text

    from app.models.extraction import ExtractionRun
    from app.services.extraction_proposal_service import InvalidProposalError

    async def delete_run(other, scope):
        await other.execute(text("DELETE FROM extraction_runs WHERE id=:id"), {"id": scope.run_id})

    outcome, counts = await _attempt_extraction_with_llm_side_effect(
        graph, _engine, monkeypatch, delete_run
    )
    db, scope, _, _ = graph
    assert isinstance(outcome, InvalidProposalError), outcome
    assert f"Run {scope.run_id} not found" in str(outcome)
    assert await db.get(ExtractionRun, scope.run_id) is None
    assert counts == {"proposals": 0, "evidence": 0, "instances": 1}


async def test_synchronous_generation_preserves_caller_rollback(graph, monkeypatch):
    from unittest.mock import AsyncMock, MagicMock

    from app.llm.extractor import LlmUsage
    from app.models.extraction import ExtractionInstance
    from app.services import section_extraction_service as ses

    db, scope, iid, _ = graph
    entity_id = (await db.get(ExtractionInstance, iid)).entity_type_id
    monkeypatch.setattr(ses, "build_model", lambda *_a, **_kw: MagicMock())
    monkeypatch.setattr(
        ses, "extract_structured", AsyncMock(return_value=(MagicMock(), LlmUsage()))
    )
    monkeypatch.setattr(
        ses, "dump_extraction", lambda _: {"value": {"value": "temporary", "status": "found"}}
    )
    monkeypatch.setattr(
        ses.SectionExtractionService, "_assemble_prompt_text", AsyncMock(return_value="article")
    )
    result = await _make_service(db).extract_section(
        project_id=scope.project_id,
        article_id=scope.article_id,
        template_id=scope.template_id,
        entity_type_id=entity_id,
        run_id=scope.run_id,
    )
    assert result.suggestions_created == 1
    await db.rollback()
    assert not list(
        (
            await db.scalars(
                select(ExtractionProposalRecord).where(
                    ExtractionProposalRecord.run_id == scope.run_id
                )
            )
        ).all()
    )


async def test_evidence_failure_rolls_back_proposal_savepoint(db_session, monkeypatch):
    import pytest

    run = await _build_run_in_extract(db_session)
    service = _make_service(db_session)
    original_add = db_session.add

    def fail_evidence(row, **kwargs):
        if isinstance(row, ExtractionEvidence):
            raise RuntimeError("evidence write failed")
        return original_add(row, **kwargs)

    monkeypatch.setattr(db_session, "add", fail_evidence)
    run_id = run.id
    with pytest.raises(RuntimeError, match="evidence write failed"):
        await service._create_suggestions(
            project_id=run.project_id,
            article_id=run.article_id,
            entity_type_id=SEED.primary_entity_type,
            parent_instance_id=None,
            run=run,
            extracted_data={
                "sample_size": {"value": 142, "status": "found", "evidence": [{"text": "citation"}]}
            },
        )
    assert not list(
        (
            await db_session.scalars(
                select(ExtractionProposalRecord).where(ExtractionProposalRecord.run_id == run_id)
            )
        ).all()
    )


async def test_repeating_entries_keep_distinct_call_snapshots(db_session, monkeypatch):
    from unittest.mock import AsyncMock, MagicMock

    from app.llm.extractor import LlmUsage
    from app.services import section_extraction_service as ses
    from tests.integration.test_entry_group_extraction import _coord, _fake_identification, _group

    entity_id, _, _ = await _group(db_session)
    run = await _build_run_in_extract(db_session)
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
    _fake_identification(monkeypatch, ["apparent", "internal"])
    prompts = []

    async def extract(**kwargs):
        prompts.append(kwargs["user_prompt"])
        return MagicMock(), LlmUsage(prompt_tokens=10 * len(prompts), completion_tokens=1)

    monkeypatch.setattr(ses, "extract_structured", extract)
    monkeypatch.setattr(
        ses,
        "dump_extraction",
        lambda _: {"c_statistic": {"value": 0.9, "status": "found", "evidence": []}},
    )
    monkeypatch.setattr(
        ses.SectionExtractionService, "_assemble_prompt_text", AsyncMock(return_value="article")
    )
    service = ses.SectionExtractionService(
        db_session, str(SEED.primary_profile), MagicMock(), "entries", attempt_id=attempt.id
    )
    result = await service.extract_section(**_coord(), entity_type_id=entity_id, run_id=run.id)
    assert result.suggestions_created == 2
    records = list(
        (
            await db_session.scalars(
                select(ExtractionProposalRecord).where(
                    ExtractionProposalRecord.extraction_attempt_id == attempt.id
                )
            )
        ).all()
    )
    assert len(records) == 2
    snapshots = sorted(
        (record.generation_snapshot for record in records), key=lambda s: s["tokens"]["prompt"]
    )
    assert [s["tokens"]["prompt"] for s in snapshots] == [10, 20]
    assert "apparent" in snapshots[0]["prompt_composition"]["section_instruction"]
    assert "internal" in snapshots[1]["prompt_composition"]["section_instruction"]
    assert prompts[0] != prompts[1]


async def test_result_rechecks_current_assessor_exclusions(graph):
    import json

    from sqlalchemy import text

    from app.models.extraction import ExtractionRun, ProjectExtractionTemplate

    db, scope, iid, _ = graph
    run = await db.get(ExtractionRun, scope.run_id)
    template = await db.get(ProjectExtractionTemplate, scope.template_id)
    original_schema = template.schema_
    await db.execute(
        text("UPDATE project_extraction_templates SET schema=:schema WHERE id=:id"),
        {
            "id": scope.template_id,
            "schema": json.dumps(
                {
                    "derived_judgments": [
                        {
                            "id": "judgment",
                            "rule": "signaling_worst",
                            "target": {"section": "study", "field": "value"},
                            "inputs": [],
                        }
                    ]
                }
            ),
        },
    )
    assert template.schema_ == original_schema  # identity map still has pre-call settings
    from app.models.extraction import ExtractionInstance

    instance = await db.get(ExtractionInstance, iid)
    assert (
        await _make_service(db)._create_suggestions(
            project_id=scope.project_id,
            article_id=scope.article_id,
            entity_type_id=instance.entity_type_id,
            parent_instance_id=None,
            run=run,
            extracted_data={"value": {"value": "must remain assessor-owned", "status": "found"}},
        )
        == 0
    )


async def test_cancel_during_identification_does_not_commit_instance(graph, _engine, monkeypatch):
    from types import SimpleNamespace
    from unittest.mock import AsyncMock, MagicMock

    import pytest
    from sqlalchemy import text
    from sqlalchemy.ext.asyncio import async_sessionmaker

    from app.llm.extractor import LlmUsage
    from app.llm.prompts.entry_identification import EntryIdentificationOutput, IdentifiedEntry
    from app.models.extraction import ExtractionInstance, ExtractionRun
    from app.services import entry_group_extraction as pipeline
    from app.services.extraction_proposal_service import InvalidProposalError
    from app.services.section_extraction_service import SectionExtractionService

    db, scope, iid, fid = graph
    etid = (await db.get(ExtractionInstance, iid)).entity_type_id
    await db.execute(
        text(
            "UPDATE extraction_entity_types SET cardinality='many', entry_label='entry' WHERE id=:id"
        ),
        {"id": etid},
    )
    await db.execute(
        text("UPDATE extraction_fields SET is_entity_key=true WHERE id=:id"), {"id": fid}
    )
    await db.commit()
    sessions = async_sessionmaker(_engine, expire_on_commit=False)

    async def identify(**_kwargs):
        async with sessions() as other:
            await other.execute(
                text("UPDATE extraction_runs SET stage='cancelled' WHERE id=:id"),
                {"id": scope.run_id},
            )
            await other.commit()
        return EntryIdentificationOutput(entries=[IdentifiedEntry(name="late-entry")]), LlmUsage()

    monkeypatch.setattr(pipeline, "extract_structured", identify)
    service = SectionExtractionService(
        db, str(SEED.primary_profile), MagicMock(), "late-entry", owns_transactions=True
    )
    monkeypatch.setattr(service, "_wire_model", lambda: MagicMock())
    field_call = AsyncMock(
        return_value=({"value": {"value": "late", "status": "found"}}, LlmUsage())
    )
    monkeypatch.setattr(service, "_extract_with_llm", field_call)
    monkeypatch.setattr(service, "_maybe_verify", AsyncMock(return_value=(None, LlmUsage())))
    run = await db.get(ExtractionRun, scope.run_id)
    field = SimpleNamespace(
        id=fid, name="value", label="Value", is_entity_key=True, allowed_values=None
    )
    entity = SimpleNamespace(
        id=etid, name="study", label="Study", entry_label="entry", description=None, fields=[field]
    )
    with pytest.raises(InvalidProposalError, match="extract stage"):
        await pipeline._extract_entry_group(
            service,
            run=run,
            entity_type=entity,
            key_field=field,
            fields=[field],
            parent_instance_id=None,
            pdf_text="article",
            kind="extraction",
            framework=None,
            memory_context=None,
            prompt_context=None,
            skip_fields_with_human_proposals=False,
        )
    await db.rollback()
    async with sessions() as other:
        count = await other.scalar(
            text(
                "SELECT count(*) FROM extraction_instances WHERE entity_type_id=:id AND label='late-entry'"
            ),
            {"id": etid},
        )
        assert count == 0
    field_call.assert_not_awaited()
