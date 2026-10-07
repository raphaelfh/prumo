"""``ProposalLanding`` — the one seam every AI candidate lands through.

One run lock, one stage gate, one coordinate bind for all candidates, then N
rows + evidence; the per-row rules (ADR-0019 source refusal, ADR-0016
disposition normalization, attempt idempotency, value dedupe + verdict heal)
and the post-model re-read of authorization and assessor exclusions.
"""

from __future__ import annotations

import json
from types import SimpleNamespace
from typing import Any
from uuid import UUID, uuid4

import pytest
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction import (
    ExtractionEntityType,
    ExtractionEvidence,
    ExtractionInstance,
    ExtractionRun,
    ExtractionRunStage,
)
from app.models.extraction_attempt import ExtractionAttempt
from app.models.extraction_workflow import ExtractionProposalRecord, ExtractionProposalSource
from app.schemas.llm_target import LlmTarget
from app.services.ai_extraction import (
    Generation,
    InvalidProposalError,
    ProposalCandidate,
    ProposalLanding,
    SingletonSlot,
)
from app.services.extraction_run_write import RunWriteError
from app.services.run_lifecycle_service import RunLifecycleService
from tests.factories.template_factory import TemplateFactory
from tests.integration.conftest import SEED, first_entity_type_id
from tests.integration.helpers.ai_extraction import run_in_extract
from tests.integration.helpers.template_fixtures import (
    add_field,
    add_instance,
    add_section,
    fresh_charms,
)

pytestmark = pytest.mark.asyncio

ENGINE = LlmTarget(provider="openai", model="gpt-5.6-luna")
SNAPSHOT = {
    "ran_by_user_id": "ffffffff-9999-0000-0000-000000000001",
    "provider": "openai",
    "model": "gpt-5.6-luna",
    "key_scope": "global_service",
    "mode_requested": "verified",
    "mode_executed": "fast",
    "passes": 1,
    "tokens": {"prompt": 10, "completion": 5, "total": 15},
    "prompt_composition": {"section_name": "participants", "system_prompt": "a long prompt"},
}


def _landing(db: AsyncSession) -> ProposalLanding:
    return ProposalLanding(db, user_id=str(SEED.primary_profile), trace_id="landing")


async def _section(db: AsyncSession, entity_type_id: UUID = SEED.primary_entity_type) -> Any:
    return await db.get(ExtractionEntityType, entity_type_id)


async def _instance(db: AsyncSession) -> ExtractionInstance:
    instance = await db.get(ExtractionInstance, SEED.primary_instance)
    assert instance is not None
    return instance


def _candidate(value: Any, **overrides: Any) -> ProposalCandidate:
    return ProposalCandidate(
        **{
            "field_id": SEED.primary_field,
            "field_name": "sample_size",
            "proposed_value": {"value": value},
            **overrides,
        }
    )


async def _rows(db: AsyncSession, run_id: UUID) -> list[ExtractionProposalRecord]:
    return list(
        (
            await db.scalars(
                select(ExtractionProposalRecord)
                .where(ExtractionProposalRecord.run_id == run_id)
                .order_by(ExtractionProposalRecord.created_at, ExtractionProposalRecord.id)
            )
        ).all()
    )


async def _evidence(db: AsyncSession, run_id: UUID) -> list[ExtractionEvidence]:
    return list(
        (
            await db.scalars(
                select(ExtractionEvidence)
                .where(ExtractionEvidence.run_id == run_id)
                .order_by(ExtractionEvidence.rank)
            )
        ).all()
    )


def _evidence_row(run: ExtractionRun, quote: str, rank: int = 0) -> ExtractionEvidence:
    return ExtractionEvidence(
        project_id=run.project_id,
        article_id=run.article_id,
        run_id=run.id,
        text_content=quote,
        position={},
        rank=rank,
        created_by=SEED.primary_profile,
    )


async def _attempt(db: AsyncSession, run: ExtractionRun) -> ExtractionAttempt:
    attempt = ExtractionAttempt(
        request_id=uuid4(),
        owner_id=SEED.primary_profile,
        project_id=run.project_id,
        article_id=run.article_id,
        template_id=run.template_id,
        run_id=run.id,
        request_payload={},
    )
    db.add(attempt)
    await db.flush()
    return attempt


async def _setup_qa_run_with_instance_field(
    db: AsyncSession,
) -> tuple[UUID, UUID, UUID, UUID] | None:
    """Build a kind='quality_assessment' run + advance to EXTRACT.

    Used by tests that assert the QA-specific behaviour of the proposal
    service's kind gate. Since D8 unified the write path (QA forms POST
    /decisions), ``human`` proposals are rejected for QA runs too — the
    kind discriminator only changes the error's rationale, not the outcome.

    Builds a transient QA template under PRIMARY_PROJECT via ``TemplateFactory``
    so the test does not depend on a pre-cloned QA project template existing
    in the seed (the integration seed only ships extraction).
    """
    project_id = (
        await db.execute(
            text("SELECT id FROM public.projects WHERE id = :pid"),
            {"pid": str(SEED.primary_project)},
        )
    ).scalar()
    article_id = (
        await db.execute(
            text("SELECT id FROM public.articles WHERE project_id = :pid LIMIT 1"),
            {"pid": project_id},
        )
    ).scalar()
    profile_id = (
        await db.execute(
            text(
                "SELECT user_id FROM public.project_members "
                "WHERE project_id = :pid AND role = 'manager' LIMIT 1"
            ),
            {"pid": str(project_id)},
        )
    ).scalar()
    if not all((project_id, article_id, profile_id)):
        return None

    factory = TemplateFactory(db, UUID(str(project_id)), UUID(str(profile_id)))
    qa_template_id = await factory.create(
        name=f"qa-{uuid4().hex[:8]}",
        kind="quality_assessment",
        is_active=True,
    )
    et_id = await factory.add_study_section(
        qa_template_id,
        name=f"participants-{uuid4().hex[:8]}",
    )

    # Field + instance (the factory doesn't add these — match the shape
    # the proposal-service coords check expects).
    field_id = uuid4()
    await db.execute(
        text(
            "INSERT INTO public.extraction_fields "
            "(id, entity_type_id, name, label, field_type, is_required) "
            "VALUES (:id, :etid, 'qa_field', 'QA Field', 'select', false)"
        ),
        {"id": str(field_id), "etid": str(et_id)},
    )
    instance_id = uuid4()
    await db.execute(
        text(
            "INSERT INTO public.extraction_instances "
            "(id, project_id, template_id, entity_type_id, article_id, "
            " label, created_by) "
            "VALUES (:id, :pid, :tid, :etid, :aid, "
            " 'QA Test Instance', :uid)"
        ),
        {
            "id": str(instance_id),
            "pid": str(project_id),
            "tid": str(qa_template_id),
            "etid": str(et_id),
            "aid": str(article_id),
            "uid": str(profile_id),
        },
    )
    await db.flush()

    lifecycle = RunLifecycleService(db)
    run = await lifecycle.create_run(
        project_id=UUID(str(project_id)),
        article_id=UUID(str(article_id)),
        project_template_id=qa_template_id,
        user_id=UUID(str(profile_id)),
    )
    await lifecycle.advance_stage(
        run_id=run.id,
        target_stage=ExtractionRunStage.EXTRACT,
        user_id=UUID(str(profile_id)),
    )
    return run.id, instance_id, field_id, UUID(str(profile_id))


# --------------------------------------------------------------------------
# One gate: lock + stage, coordinate, source
# --------------------------------------------------------------------------


async def test_lands_one_row_per_candidate_with_its_evidence(db_session: AsyncSession) -> None:
    run = await run_in_extract(db_session)
    candidate = _candidate(142, confidence_score=0.92, rationale="page 4")
    candidate.evidence = [_evidence_row(run, "quote a", 0), _evidence_row(run, "quote b", 1)]

    written = await _landing(db_session).land(
        run,
        await _section(db_session),
        await _instance(db_session),
        [candidate],
        Generation(ENGINE, None, None),
    )

    assert written == 1
    (row,) = await _rows(db_session, run.id)
    assert row.source == "ai"
    assert row.proposed_value == {"value": 142}
    assert row.confidence_score == 0.92
    assert row.rationale == "page 4"
    evidence = await _evidence(db_session, run.id)
    assert [(e.text_content, e.rank, e.proposal_record_id) for e in evidence] == [
        ("quote a", 0, row.id),
        ("quote b", 1, row.id),
    ]


async def test_refused_outside_the_extract_stage(db_session: AsyncSession) -> None:
    run = await run_in_extract(db_session)
    await RunLifecycleService(db_session).advance_stage(
        run_id=run.id, target_stage=ExtractionRunStage.CONSENSUS, user_id=SEED.primary_profile
    )
    # Every stage but extract takes this one branch — consensus stands in for all.
    with pytest.raises(RunWriteError, match="not 'extract'") as refused:
        await _landing(db_session).land(
            run,
            await _section(db_session),
            await _instance(db_session),
            [_candidate(1)],
            Generation(ENGINE, None, None),
        )
    assert refused.value.reason == "stage"
    assert await _rows(db_session, run.id) == []


async def test_a_missing_run_is_refused(db_session: AsyncSession) -> None:
    ghost = SimpleNamespace(id=uuid4())
    with pytest.raises(RunWriteError) as refused:
        await _landing(db_session).land(
            ghost,
            await _section(db_session),
            await _instance(db_session),
            [_candidate(1)],  # type: ignore[arg-type]
            Generation(ENGINE, None, None),
        )
    assert refused.value.reason == "missing"


async def test_one_off_coordinate_field_refuses_the_whole_batch(db_session: AsyncSession) -> None:
    """The coordinate is bound once for every candidate: a field of another
    section on this instance refuses the batch — nothing lands, not even the
    coherent sibling."""
    run = await run_in_extract(db_session)
    other = await add_section(db_session, SEED.primary_template, f"other_{uuid4().hex[:6]}")
    foreign_field = await add_field(db_session, other, "foreign")

    with pytest.raises(RunWriteError, match="Coordinate mismatch") as refused:
        await _landing(db_session).land(
            run,
            await _section(db_session),
            await _instance(db_session),
            [_candidate(1), _candidate("x", field_id=foreign_field, field_name="foreign")],
            Generation(ENGINE, None, None),
        )
    assert refused.value.reason == "coordinate"
    assert await _rows(db_session, run.id) == []


async def test_an_instance_of_another_article_is_off_coordinate(db_session: AsyncSession) -> None:
    run = await run_in_extract(db_session)
    project, template, _ = await fresh_charms(db_session)
    stranger = await add_instance(
        db_session,
        project_id=project,
        template_id=template,
        entity_type_id=await first_entity_type_id(db_session, template),
    )
    with pytest.raises(RunWriteError, match="Coordinate mismatch"):
        await _landing(db_session).land(
            run,
            await _section(db_session),
            SimpleNamespace(id=stranger),
            [_candidate(1)],  # type: ignore[arg-type]
            Generation(ENGINE, None, None),
        )


async def test_human_source_is_refused_on_an_extraction_run(db_session: AsyncSession) -> None:
    """ADR-0019 / Layer 1b: a reviewer's value lands as a per-user decision
    via /decisions; a shared ``human`` proposal would leak across blind
    reviewers. The refusal is exhaustiveness over the source domain."""
    run = await run_in_extract(db_session)
    with pytest.raises(InvalidProposalError, match="/decisions"):
        await _landing(db_session).land(
            run,
            await _section(db_session),
            await _instance(db_session),
            [_candidate("leaked")],
            Generation(ENGINE, None, None),
            source=ExtractionProposalSource.HUMAN,
        )
    assert await _rows(db_session, run.id) == []


async def test_human_source_is_refused_on_a_qa_run(db_session: AsyncSession) -> None:
    """Post-D8 the QA form writes /decisions too: a bare human proposal would
    force ``materialize_qa_decisions`` to reconcile it at every advance."""
    fx = await _setup_qa_run_with_instance_field(db_session)
    assert fx is not None
    run_id, instance_id, field_id, _ = fx
    run = await db_session.get(ExtractionRun, run_id)
    instance = await db_session.get(ExtractionInstance, instance_id)
    section = await db_session.get(ExtractionEntityType, instance.entity_type_id)
    with pytest.raises(InvalidProposalError, match="/decisions"):
        await _landing(db_session).land(
            run,
            section,
            instance,
            [ProposalCandidate(field_id, "qa_field", {"value": "Y"})],
            Generation(ENGINE, None, None),
            source=ExtractionProposalSource.HUMAN,
        )


# --------------------------------------------------------------------------
# Re-read after the external work
# --------------------------------------------------------------------------


async def test_assessor_exclusions_are_reread_at_landing(db_session: AsyncSession) -> None:
    """A field the template made assessor-owned WHILE the model ran is dropped:
    the landing re-reads the live schema under the run lock."""
    run = await run_in_extract(db_session)
    section = await _section(db_session)
    await db_session.execute(
        text("UPDATE project_extraction_templates SET schema = CAST(:s AS jsonb) WHERE id = :id"),
        {
            "id": SEED.primary_template,
            "s": json.dumps(
                {
                    "derived_judgments": [
                        {
                            "id": "j",
                            "rule": "signaling_worst",
                            "target": {"section": section.name, "field": "sample_size"},
                            "inputs": [],
                        }
                    ]
                }
            ),
        },
    )
    written = await _landing(db_session).land(
        run, section, await _instance(db_session), [_candidate(1)], Generation(ENGINE, None, None)
    )
    assert written == 0
    assert await _rows(db_session, run.id) == []


# --------------------------------------------------------------------------
# Instances
# --------------------------------------------------------------------------


async def test_a_singleton_slot_creates_the_instance_once(db_session: AsyncSession) -> None:
    run = await run_in_extract(db_session)
    section_id = await add_section(db_session, SEED.primary_template, f"solo_{uuid4().hex[:6]}")
    field_id = await add_field(db_session, section_id, "note")
    section = await _section(db_session, section_id)
    landing = _landing(db_session)

    for value in ("first", "second"):
        await landing.land(
            run,
            section,
            SingletonSlot(None),
            [ProposalCandidate(field_id, "note", {"value": value})],
            Generation(ENGINE, None, None),
        )

    instances = list(
        (
            await db_session.scalars(
                select(ExtractionInstance).where(ExtractionInstance.entity_type_id == section_id)
            )
        ).all()
    )
    assert len(instances) == 1, "the second landing reused the singleton"
    (instance,) = instances
    assert instance.template_id == run.template_id
    assert instance.label == section.label
    assert instance.metadata_ == {"ai_created": True, "ai_run_id": str(run.id)}
    assert {r.proposed_value["value"] for r in await _rows(db_session, run.id)} == {
        "first",
        "second",
    }


async def test_a_singleton_under_a_foreign_parent_is_refused(db_session: AsyncSession) -> None:
    """The parent is re-verified at the write: the last line before a
    cross-tenant ``parent_instance_id`` foreign key."""
    run = await run_in_extract(db_session)
    project, template, _ = await fresh_charms(db_session)
    stranger = await add_instance(
        db_session,
        project_id=project,
        template_id=template,
        entity_type_id=await first_entity_type_id(db_session, template),
    )
    section_id = await add_section(db_session, SEED.primary_template, f"child_{uuid4().hex[:6]}")
    field_id = await add_field(db_session, section_id, "note")
    with pytest.raises(ValueError, match=f"Parent instance not found: {stranger}"):
        await _landing(db_session).land(
            run,
            await _section(db_session, section_id),
            SingletonSlot(stranger),
            [ProposalCandidate(field_id, "note", {"value": "x"})],
            Generation(ENGINE, None, None),
        )
    assert await _rows(db_session, run.id) == []


# --------------------------------------------------------------------------
# Provenance
# --------------------------------------------------------------------------


async def test_the_row_carries_engine_identity_never_the_runner(db_session: AsyncSession) -> None:
    """The proposal row records HOW the value was produced; identity stays
    run-level (the blind-review scrub never visits proposal rows) and the
    prompt is not duplicated per row. The section snapshot is merged under
    the run, attributed to the landing's user."""
    run = await run_in_extract(db_session)
    await _landing(db_session).land(
        run,
        await _section(db_session),
        await _instance(db_session),
        [_candidate(1)],
        Generation(ENGINE, SNAPSHOT, None),
    )
    (row,) = await _rows(db_session, run.id)
    assert row.provenance == {
        "provider": "openai",
        "model": "gpt-5.6-luna",
        "connection_id": None,
        "deviation": False,
        "key_scope": "global_service",
        "mode_requested": "verified",
        "mode_executed": "fast",
        "passes": 1,
    }
    assert row.generation_snapshot is None, "only attempts store the call snapshot"
    await db_session.refresh(run)
    merged = run.results["provenance"]["sections"][str(SEED.primary_entity_type)]
    assert merged["ran_by_user_id"] == str(SEED.primary_profile)
    assert merged["tokens"] == {"prompt": 10, "completion": 5, "total": 15}


async def test_without_a_snapshot_the_row_is_unattributed(db_session: AsyncSession) -> None:
    run = await run_in_extract(db_session)
    await _landing(db_session).land(
        run,
        await _section(db_session),
        await _instance(db_session),
        [_candidate(1)],
        Generation(ENGINE, None, None),
    )
    (row,) = await _rows(db_session, run.id)
    assert row.provenance is None
    await db_session.refresh(run)
    assert "provenance" not in (run.results or {})


# --------------------------------------------------------------------------
# Per-row rules without an attempt: dedupe + verdict heal
# --------------------------------------------------------------------------


async def test_an_identical_replay_keeps_the_original_row_and_engine(
    db_session: AsyncSession,
) -> None:
    """Corroboration under another engine is a separate fact (a new row with
    a link), never a mutation of the stored one (§IX)."""
    run = await run_in_extract(db_session)
    landing, section, instance = (
        _landing(db_session),
        await _section(db_session),
        await _instance(db_session),
    )
    other = LlmTarget(provider="anthropic", model="claude-sonnet-5")

    await landing.land(
        run, section, instance, [_candidate("same")], Generation(ENGINE, SNAPSHOT, None)
    )
    again = await landing.land(
        run,
        section,
        instance,
        [_candidate("same")],
        Generation(other, {**SNAPSHOT, "provider": "anthropic"}, None),
    )

    assert again == 1, "a write without an attempt still counts its replay"
    (row,) = await _rows(db_session, run.id)
    assert row.provenance["model"] == "gpt-5.6-luna"


async def test_a_changed_value_appends_a_row_with_its_own_engine(db_session: AsyncSession) -> None:
    run = await run_in_extract(db_session)
    landing, section, instance = (
        _landing(db_session),
        await _section(db_session),
        await _instance(db_session),
    )
    other = LlmTarget(provider="anthropic", model="claude-sonnet-5")

    await landing.land(
        run, section, instance, [_candidate("v1")], Generation(ENGINE, SNAPSHOT, None)
    )
    await landing.land(
        run, section, instance, [_candidate("v2")], Generation(other, SNAPSHOT, None)
    )

    rows = await _rows(db_session, run.id)
    assert sorted((r.proposed_value["value"], r.provenance["model"]) for r in rows) == [
        ("v1", "gpt-5.6-luna"),
        ("v2", "claude-sonnet-5"),
    ]


async def test_a_moved_verdict_heals_in_place_with_its_execution_record(
    db_session: AsyncSession,
) -> None:
    """Same value, new verify verdict: the ANNOTATION and the execution facts
    of that pass move together on the existing row; a later value WITHOUT a
    verdict (fast re-run, flaked verify) never clears it."""
    run = await run_in_extract(db_session)
    landing, section, instance = (
        _landing(db_session),
        await _section(db_session),
        await _instance(db_session),
    )
    fast = {**SNAPSHOT, "mode_executed": "fast", "passes": 1}
    verified = {**SNAPSHOT, "mode_executed": "verified", "passes": 2}

    await landing.land(run, section, instance, [_candidate(142)], Generation(ENGINE, fast, None))
    annotated = _candidate(142)
    annotated.proposed_value = {"value": 142, "verification": {"verdict": "confirmed"}}
    await landing.land(run, section, instance, [annotated], Generation(ENGINE, verified, None))
    await landing.land(run, section, instance, [_candidate(142)], Generation(ENGINE, fast, None))

    (row,) = await _rows(db_session, run.id)
    await db_session.refresh(row)
    assert row.proposed_value == {"value": 142, "verification": {"verdict": "confirmed"}}
    assert (row.provenance["mode_executed"], row.provenance["passes"]) == ("verified", 2)


async def test_a_legacy_disposition_string_lands_as_the_coded_marker(
    db_session: AsyncSession,
) -> None:
    """ADR-0016: an in-band disposition the field's domain lists becomes the
    ``absent_reason`` marker at the write; a coincidental value elsewhere is
    untouched."""
    run = await run_in_extract(db_session)
    section_id = await add_section(db_session, SEED.primary_template, f"disp_{uuid4().hex[:6]}")
    field_id = await add_field(db_session, section_id, "status")
    await db_session.execute(
        text(
            "UPDATE extraction_fields SET field_type='select', allowed_values=CAST(:av AS jsonb) WHERE id=:id"
        ),
        {"id": field_id, "av": json.dumps(["Yes", "No", "No information"])},
    )
    await _landing(db_session).land(
        run,
        await _section(db_session, section_id),
        SingletonSlot(None),
        [ProposalCandidate(field_id, "status", {"value": "No information"})],
        Generation(ENGINE, None, None),
    )
    (row,) = await _rows(db_session, run.id)
    assert row.proposed_value == {"value": None, "absent_reason": "no_information"}


# --------------------------------------------------------------------------
# Attempts: replay-safe, immutable call facts
# --------------------------------------------------------------------------


async def test_an_attempt_replay_lands_nothing_new(db_session: AsyncSession) -> None:
    """A technical replay of one attempt finds its own rows (not counted, no
    evidence re-attached); a fresh attempt with the same value appends, each
    row carrying its own sanitized call snapshot."""
    run = await run_in_extract(db_session)
    first, second = await _attempt(db_session, run), await _attempt(db_session, run)
    landing, section, instance = (
        _landing(db_session),
        await _section(db_session),
        await _instance(db_session),
    )

    async def land(attempt: ExtractionAttempt, tokens: int, quote: str) -> int:
        candidate = _candidate(142, rationale=quote)
        candidate.evidence = [_evidence_row(run, quote)]
        snapshot = {"tokens": {"total": tokens}, "ran_by_user_id": "secret"}
        return await landing.land(
            run, section, instance, [candidate], Generation(ENGINE, snapshot, attempt.id)
        )

    assert await land(first, 10, "first citation") == 1
    assert await land(first, 999, "replay citation") == 0
    assert await land(second, 20, "second citation") == 1

    rows = {r.extraction_attempt_id: r for r in await _rows(db_session, run.id)}
    assert len(rows) == 2
    assert rows[first.id].rationale == "first citation"
    assert rows[first.id].generation_snapshot == {"tokens": {"total": 10}}
    assert rows[second.id].generation_snapshot == {"tokens": {"total": 20}}
    assert {
        (e.proposal_record_id, e.text_content) for e in await _evidence(db_session, run.id)
    } == {
        (rows[first.id].id, "first citation"),
        (rows[second.id].id, "second citation"),
    }


async def test_a_failed_evidence_write_rolls_the_landing_back(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    run = await run_in_extract(db_session)
    candidate = _candidate(142)
    candidate.evidence = [_evidence_row(run, "citation")]
    original_add = db_session.add

    def fail_evidence(row: Any, **kwargs: Any) -> None:
        if isinstance(row, ExtractionEvidence):
            raise RuntimeError("evidence write failed")
        original_add(row, **kwargs)

    monkeypatch.setattr(db_session, "add", fail_evidence)
    with pytest.raises(RuntimeError, match="evidence write failed"):
        await _landing(db_session).land(
            run,
            await _section(db_session),
            await _instance(db_session),
            [candidate],
            Generation(ENGINE, None, None),
        )
    assert await _rows(db_session, run.id) == []
