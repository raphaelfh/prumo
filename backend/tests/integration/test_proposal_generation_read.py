"""Immutable proposal read contracts, including hostile stored JSON."""

import json
from copy import deepcopy
from uuid import uuid4

import pytest
from sqlalchemy import event, select, text

from app.models.extraction import ExtractionRun
from app.models.extraction_attempt import ExtractionAttempt
from app.models.extraction_workflow import ExtractionProposalRecord
from app.services.extraction_run_read_service import get_run_with_workflow_history
from app.services.extraction_suggestion_read_service import get_suggestion_history, load_suggestions
from tests.integration.conftest import SEED
from tests.integration.test_suggestion_read import (
    _build_suggestion_review_run,
    _seed_run_provenance,
)


async def _generation(db):
    built = await _build_suggestion_review_run(db)
    assert built is not None
    rid, iid, fid, reviewer, owner = built
    run = await db.get(ExtractionRun, rid)
    attempt = ExtractionAttempt(
        request_id=uuid4(),
        owner_id=owner,
        project_id=run.project_id,
        article_id=run.article_id,
        template_id=run.template_id,
        run_id=rid,
        request_payload={},
    )
    db.add(attempt)
    await db.flush()
    proposal = await db.scalar(
        select(ExtractionProposalRecord).where(
            ExtractionProposalRecord.run_id == rid, ExtractionProposalRecord.source == "ai"
        )
    )
    proposal.extraction_attempt_id = attempt.id
    proposal.provenance = {"model": "original-model", "mode_executed": "fast", "passes": 1}
    proposal.generation_snapshot = {
        "model": "original-model",
        "prompt_version": "v1",
        "tokens": {"total": 41},
        "prompt_composition": {
            "system_prompt": "Retained system prompt",
            "section_instruction": "Retained instructions",
            "fields_requested": ["sample_size"],
            "article_ref": {"file_id": str(uuid4()), "file_name": "input.pdf", "truncated": False},
        },
    }
    await db.flush()
    return built, proposal


@pytest.mark.parametrize("kind", ["extraction", "quality_assessment"])
async def test_immutable_generation_across_history_hot_and_run_detail(db_session, kind):
    if kind == "quality_assessment":
        await db_session.execute(
            text("UPDATE public.project_extraction_templates SET kind = :kind WHERE id = :tid"),
            {"kind": kind, "tid": SEED.primary_template},
        )
    (rid, iid, fid, reviewer, _), proposal = await _generation(db_session)
    before = await get_suggestion_history(
        db_session, iid, fid, article_id=SEED.primary_article, caller_id=reviewer
    )
    original = before[0].generation_snapshot
    assert original["tokens"] == {"total": 41}
    assert original["prompt_composition"]["system_prompt"] == "Retained system prompt"
    ref = original["prompt_composition"]["article_ref"]
    assert ref["file_id"] is None
    assert (
        ref["current_file_id"]
        == proposal.generation_snapshot["prompt_composition"]["article_ref"]["file_id"]
    )
    assert ref["historical_input_available"] is False
    await _seed_run_provenance(
        db_session, rid, {"model": "later-model", "prompt_version": "v99", "tokens": {"total": 999}}
    )
    second_attempt = ExtractionAttempt(
        request_id=uuid4(),
        owner_id=SEED.primary_profile,
        project_id=SEED.primary_project,
        article_id=SEED.primary_article,
        template_id=SEED.primary_template,
        run_id=rid,
        request_payload={},
    )
    db_session.add(second_attempt)
    await db_session.flush()
    second = ExtractionProposalRecord(
        run_id=rid,
        instance_id=iid,
        field_id=fid,
        source="ai",
        proposed_value=deepcopy(proposal.proposed_value),
        extraction_attempt_id=second_attempt.id,
        generation_snapshot={
            "model": "second-call",
            "prompt_version": "v2",
            "tokens": {"total": 72},
        },
    )
    db_session.add(second)
    legacy = ExtractionProposalRecord(
        run_id=rid,
        instance_id=iid,
        field_id=fid,
        source="ai",
        proposed_value={"value": "legacy"},
        provenance={"model": "legacy-engine"},
    )
    db_session.add(legacy)
    await db_session.flush()
    history = await get_suggestion_history(
        db_session, iid, fid, article_id=SEED.primary_article, caller_id=reviewer
    )
    by_id = {p.id: p for p in history}
    assert by_id[proposal.id].generation_snapshot == original
    assert by_id[second.id].generation_snapshot == {
        "model": "second-call",
        "prompt_version": "v2",
        "tokens": {"total": 72},
    }
    assert by_id[legacy.id].generation_snapshot is None
    assert by_id[legacy.id].provenance == {"model": "legacy-engine"}
    hot = await load_suggestions(
        db_session, [iid], article_id=SEED.primary_article, caller_id=reviewer, run_id=rid
    )
    assert (
        hot.suggestions[0].generation_snapshot == by_id[hot.suggestions[0].id].generation_snapshot
    )
    detail = await get_run_with_workflow_history(
        db_session, rid, caller_id=reviewer, can_see_peers=False
    )
    assert {p.id: p.generation_snapshot for p in detail.proposals} == {
        p.id: p.generation_snapshot for p in history
    }


async def test_nested_identity_is_rejected_without_mutation_or_owner_lookup(db_session):
    (rid, iid, fid, reviewer, _), proposal = await _generation(db_session)
    malicious = deepcopy(proposal.generation_snapshot)
    malicious.update(
        {
            "ran_by_user_id": "secret",
            "unknown": {"ran_by_name": "secret"},
            "params": {"temperature": {"ran_by_name": "secret"}},
            "passes": [{"ran_by_user_id": "secret"}],
        }
    )
    malicious["prompt_composition"]["fields_requested"].append({"ran_by_name": "secret"})
    malicious["prompt_composition"]["article_ref"]["ran_by_name"] = "secret"
    proposal.generation_snapshot = malicious
    proposal.provenance = {"model": {"ran_by_name": "secret"}, "provider": "openai"}
    await db_session.flush()
    queries = []

    def record(_conn, _cursor, statement, _parameters, _context, _many):
        queries.append(statement)

    event.listen(db_session.bind.sync_engine, "before_cursor_execute", record)
    try:
        history = await get_suggestion_history(
            db_session, iid, fid, article_id=SEED.primary_article, caller_id=reviewer
        )
        detail = await get_run_with_workflow_history(
            db_session, rid, caller_id=reviewer, can_see_peers=False
        )
        hot = await load_suggestions(
            db_session, [iid], article_id=SEED.primary_article, caller_id=reviewer, run_id=rid
        )
    finally:
        event.remove(db_session.bind.sync_engine, "before_cursor_execute", record)
    for payload in [history[0].model_dump_json(), detail.model_dump_json(), hot.model_dump_json()]:
        assert "ran_by_user_id" not in payload
        assert "ran_by_name" not in payload
    assert not any("extraction_attempts" in sql for sql in queries)
    await db_session.refresh(proposal)
    assert proposal.generation_snapshot == malicious


@pytest.mark.parametrize(
    "stage,arbitrator,revealed",
    [
        ("extract", False, False),
        ("consensus", False, False),
        ("consensus", True, True),
        ("finalized", False, True),
    ],
)
async def test_identity_comes_from_authorized_attempt_owner(
    db_session, stage, arbitrator, revealed
):
    (rid, iid, fid, reviewer, owner), _ = await _generation(db_session)
    await db_session.execute(
        text("UPDATE public.profiles SET full_name = :name WHERE id = :id"),
        {"name": "Correct attempt owner", "id": owner},
    )
    await _seed_run_provenance(
        db_session, rid, {"ran_by_user_id": str(reviewer), "model": "wrong-run-model"}
    )
    await db_session.execute(
        text("UPDATE public.extraction_runs SET stage = :stage WHERE id = :id"),
        {"stage": stage, "id": rid},
    )
    detail = await get_run_with_workflow_history(
        db_session, rid, caller_id=reviewer, can_see_peers=False, caller_is_arbitrator=arbitrator
    )
    snapshot = detail.proposals[0].generation_snapshot
    if revealed:
        assert snapshot["ran_by_user_id"] == str(owner)
        assert snapshot["ran_by_name"] == "Correct attempt owner"
    else:
        assert "ran_by_user_id" not in json.dumps(snapshot)
    assert (
        await get_suggestion_history(db_session, iid, fid, article_id=uuid4(), caller_id=reviewer)
        == []
    )


async def test_export_projects_original_proposal_model(db_session):
    from tests.integration.test_extraction_export_ai_outcome import _ai_metadata_rows

    (rid, iid, fid, _, _), proposal = await _generation(db_session)
    run = await db_session.get(ExtractionRun, rid)
    await _seed_run_provenance(db_session, rid, {"model": "later-run-model"})
    rows = await _ai_metadata_rows(
        db_session,
        run=run,
        profile_id=SEED.primary_profile,
        article_id=SEED.primary_article,
        entity_type_id=SEED.primary_entity_type,
        instance_id=iid,
        field_id=fid,
    )
    assert rows[0].model_used == "original-model"
    proposal.generation_snapshot = None
    proposal.provenance = {"model": "legacy-row-model"}
    await db_session.flush()
    rows = await _ai_metadata_rows(
        db_session,
        run=run,
        profile_id=SEED.primary_profile,
        article_id=SEED.primary_article,
        entity_type_id=SEED.primary_entity_type,
        instance_id=iid,
        field_id=fid,
    )
    assert rows[0].model_used == "legacy-row-model"


async def test_history_authorizes_each_run_before_owner_names(db_session):
    from tests.integration.test_suggestion_read import _reveal_managers

    (rid, iid, fid, reviewer, owner), _ = await _generation(db_session)
    await db_session.execute(
        text("UPDATE public.profiles SET full_name = :name WHERE id = :id"),
        {"name": "Original owner", "id": owner},
    )
    await db_session.execute(
        text("UPDATE public.extraction_runs SET stage = 'finalized' WHERE id = :id"), {"id": rid}
    )
    (_, _, _, _, _), current = await _generation(db_session)
    history = await get_suggestion_history(
        db_session, iid, fid, article_id=SEED.primary_article, caller_id=reviewer
    )
    by_run = {p.run_id: p.generation_snapshot for p in history}
    assert by_run[rid]["ran_by_name"] == "Original owner"
    assert "ran_by_user_id" not in by_run[current.run_id]
    await _reveal_managers(db_session)
    hot = await load_suggestions(
        db_session,
        [iid],
        article_id=SEED.primary_article,
        caller_id=SEED.primary_profile,
        run_id=current.run_id,
    )
    assert hot.suggestions[0].generation_snapshot["ran_by_user_id"] == str(owner)
    assert hot.suggestions[0].generation_snapshot["ran_by_name"] == "Original owner"


@pytest.mark.parametrize("malformed", ["not-a-snapshot", [{"ran_by_user_id": "secret"}], 17])
async def test_malformed_stored_generation_is_unavailable_in_run_detail(db_session, malformed):
    (rid, _, _, reviewer, _), proposal = await _generation(db_session)
    proposal.generation_snapshot = malformed
    proposal.provenance = malformed
    await db_session.flush()
    detail = await get_run_with_workflow_history(
        db_session, rid, caller_id=reviewer, can_see_peers=False
    )
    assert detail.proposals[0].generation_snapshot is None
    assert detail.proposals[0].provenance is None
