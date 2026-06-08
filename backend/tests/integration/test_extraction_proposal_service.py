"""Integration tests for ExtractionProposalService."""

from uuid import UUID, uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction import ExtractionRunStage
from app.models.extraction_workflow import ExtractionProposalSource
from app.services.extraction_proposal_service import (
    ExtractionProposalService,
    InvalidProposalError,
)
from app.services.run_lifecycle_service import RunLifecycleService
from tests.factories.template_factory import TemplateFactory


async def _setup_qa_run_with_instance_field(
    db: AsyncSession,
) -> tuple[UUID, UUID, UUID, UUID] | None:
    """Build a kind='quality_assessment' run + advance to PROPOSAL.

    Used by tests that need the QA-specific recovery-from-interrupted-publish
    behaviour, where ``human`` proposals MUST keep being accepted at REVIEW
    stage (the QA publish flow advances to REVIEW unconditionally; a downstream
    failure leaves the run parked there, and the user must be able to keep
    typing). The kind discriminator in the proposal service exempts QA from
    the Layer 1b extraction-only gate.

    Builds a transient QA template under PRIMARY_PROJECT via ``TemplateFactory``
    so the test does not depend on a pre-cloned QA project template existing
    in the seed (the integration seed only ships extraction).
    """
    project_id = (await db.execute(text("SELECT id FROM public.projects LIMIT 1"))).scalar()
    article_id = (
        await db.execute(
            text("SELECT id FROM public.articles WHERE project_id = :pid LIMIT 1"),
            {"pid": project_id},
        )
    ).scalar()
    profile_id = (await db.execute(text("SELECT id FROM public.profiles LIMIT 1"))).scalar()
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
            " label, status, created_by) "
            "VALUES (:id, :pid, :tid, :etid, :aid, "
            " 'QA Test Instance', 'pending', :uid)"
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
        target_stage=ExtractionRunStage.PROPOSAL,
        user_id=UUID(str(profile_id)),
    )
    return run.id, instance_id, field_id, UUID(str(profile_id))


async def _setup_run_with_instance_field(
    db: AsyncSession,
    *,
    kind: str | None = None,
) -> tuple[UUID, UUID, UUID, UUID] | None:
    """Build a run + advance to proposal + return (run_id, instance_id, field_id, profile_id).

    When ``kind`` is provided the project template lookup filters by it
    (otherwise picks the lex-first id, which historically happened to be
    PROBAST/quality_assessment — caused silent kind drift; Layer 1b made
    that drift visible). Pass ``kind='extraction'`` when the test asserts
    extraction-specific behaviour.
    """
    project_id = (await db.execute(text("SELECT id FROM public.projects LIMIT 1"))).scalar()
    article_id = (
        await db.execute(
            text("SELECT id FROM public.articles WHERE project_id = :pid LIMIT 1"),
            {"pid": project_id},
        )
    ).scalar()
    # Only consider templates that already have at least one
    # ``(instance, entity_type, field)`` chain — the subsequent helper
    # logic requires those joins to succeed. Without the EXISTS guard
    # the LIMIT 1 pick can land on a structurally-empty template (e.g.
    # the E2E "Legacy" fixture) and silently make the whole test SKIP.
    kind_filter = "AND t.kind = :kind" if kind is not None else ""
    params = {"pid": project_id}
    if kind is not None:
        params["kind"] = kind
    template_id = (
        await db.execute(
            text(
                f"""
                SELECT t.id FROM public.project_extraction_templates t
                WHERE t.project_id = :pid {kind_filter}
                  AND EXISTS (
                    SELECT 1 FROM public.extraction_instances i
                    JOIN public.extraction_entity_types et ON et.id = i.entity_type_id
                    JOIN public.extraction_fields f ON f.entity_type_id = et.id
                    WHERE i.template_id = t.id
                  )
                LIMIT 1
                """
            ),
            params,
        )
    ).scalar()
    profile_id = (await db.execute(text("SELECT id FROM public.profiles LIMIT 1"))).scalar()
    if not all((project_id, article_id, template_id, profile_id)):
        return None
    # Pick instance and field that match the same template and entity_type.
    row = await db.execute(
        text(
            """
            SELECT i.id, f.id
            FROM public.extraction_instances i
            JOIN public.extraction_entity_types et ON et.id = i.entity_type_id
            JOIN public.extraction_fields f ON f.entity_type_id = et.id
            WHERE i.template_id = :tid
            LIMIT 1
            """
        ),
        {"tid": template_id},
    )
    pair = row.first()
    if pair is None:
        return None
    instance_id, field_id = pair
    lifecycle = RunLifecycleService(db)
    run = await lifecycle.create_run(
        project_id=project_id,
        article_id=article_id,
        project_template_id=template_id,
        user_id=profile_id,
    )
    await lifecycle.advance_stage(
        run_id=run.id,
        target_stage=ExtractionRunStage.PROPOSAL,
        user_id=profile_id,
    )
    return run.id, instance_id, field_id, profile_id


@pytest.mark.asyncio
async def test_record_ai_proposal(db_session: AsyncSession) -> None:
    fx = await _setup_run_with_instance_field(db_session)
    if fx is None:
        pytest.skip("Missing fixtures.")
    run_id, instance_id, field_id, _ = fx
    service = ExtractionProposalService(db_session)
    record = await service.record_proposal(
        run_id=run_id,
        instance_id=instance_id,
        field_id=field_id,
        source=ExtractionProposalSource.AI,
        proposed_value={"text": "from LLM"},
        confidence_score=0.92,
        rationale="page 4",
    )
    assert record.id is not None
    assert record.source == "ai"
    assert record.confidence_score == 0.92
    await db_session.rollback()


@pytest.mark.asyncio
async def test_record_human_proposal_requires_user_id(
    db_session: AsyncSession,
) -> None:
    fx = await _setup_run_with_instance_field(db_session)
    if fx is None:
        pytest.skip("Missing fixtures.")
    run_id, instance_id, field_id, _ = fx
    service = ExtractionProposalService(db_session)
    with pytest.raises(InvalidProposalError):
        await service.record_proposal(
            run_id=run_id,
            instance_id=instance_id,
            field_id=field_id,
            source=ExtractionProposalSource.HUMAN,
            proposed_value={"text": "manual"},
            source_user_id=None,
        )
    await db_session.rollback()


@pytest.mark.asyncio
async def test_record_proposal_blocked_outside_proposal_stage(
    db_session: AsyncSession,
) -> None:
    fx = await _setup_run_with_instance_field(db_session)
    if fx is None:
        pytest.skip("Missing fixtures.")
    run_id, instance_id, field_id, profile_id = fx
    # Move run forward past proposal stage
    lifecycle = RunLifecycleService(db_session)
    await lifecycle.advance_stage(
        run_id=run_id,
        target_stage=ExtractionRunStage.REVIEW,
        user_id=profile_id,
    )
    service = ExtractionProposalService(db_session)
    with pytest.raises(InvalidProposalError):
        await service.record_proposal(
            run_id=run_id,
            instance_id=instance_id,
            field_id=field_id,
            source=ExtractionProposalSource.AI,
            proposed_value={"text": "too late"},
        )
    await db_session.rollback()


@pytest.mark.asyncio
async def test_record_human_proposal_accepted_at_review_for_qa(
    db_session: AsyncSession,
) -> None:
    """Quality-Assessment / human flows must keep working when the run has
    already advanced to REVIEW (e.g. after an interrupted publish that
    succeeded the ``proposal -> review`` step but failed downstream).

    Layer 1b: The extraction-only gate added in this layer must NOT block
    QA's recovery write — QA's publish is a one-shot single-user flow that
    legitimately needs ``human`` proposals at REVIEW. Coverage of QA's
    permissiveness is therefore explicit and uses a kind='quality_assessment'
    template (the sibling extraction-kind rejection lives in
    ``test_record_human_proposal_rejected_at_review_for_extraction``).
    """
    fx = await _setup_qa_run_with_instance_field(db_session)
    if fx is None:
        pytest.skip("Missing fixtures.")
    run_id, instance_id, field_id, profile_id = fx
    lifecycle = RunLifecycleService(db_session)
    await lifecycle.advance_stage(
        run_id=run_id,
        target_stage=ExtractionRunStage.REVIEW,
        user_id=profile_id,
    )
    service = ExtractionProposalService(db_session)
    record = await service.record_proposal(
        run_id=run_id,
        instance_id=instance_id,
        field_id=field_id,
        source=ExtractionProposalSource.HUMAN,
        proposed_value={"value": "Y"},
        source_user_id=profile_id,
    )
    assert record.id is not None
    assert record.source == "human"
    await db_session.rollback()


@pytest.mark.asyncio
async def test_record_human_proposal_rejected_at_review_for_extraction(
    db_session: AsyncSession,
) -> None:
    """Layer 1b defense-in-depth: ``human`` proposals against an
    EXTRACTION-kind run in REVIEW stage must be rejected.

    During REVIEW the reviewer's writes must land as per-user
    ``ReviewerDecision`` rows so the blind-review contract holds
    (``loadValuesForUser`` filters by ``reviewer_id``). Allowing
    ``human`` proposals at this stage opened the leak that Layer 1 fixed
    on the read side; this gate closes the loophole on the write side so
    a future bypass of the frontend filter (curl, agent client) cannot
    resurrect the bug.

    QA's publish flow legitimately needs proposals at REVIEW and is
    therefore exempted (covered by the sibling QA test above).
    """
    fx = await _setup_run_with_instance_field(db_session, kind="extraction")
    if fx is None:
        pytest.skip("Missing extraction-kind template in test DB.")
    run_id, instance_id, field_id, profile_id = fx
    lifecycle = RunLifecycleService(db_session)
    await lifecycle.advance_stage(
        run_id=run_id,
        target_stage=ExtractionRunStage.REVIEW,
        user_id=profile_id,
    )
    service = ExtractionProposalService(db_session)
    with pytest.raises(InvalidProposalError, match="extraction.*review|review.*extraction"):
        await service.record_proposal(
            run_id=run_id,
            instance_id=instance_id,
            field_id=field_id,
            source=ExtractionProposalSource.HUMAN,
            proposed_value={"value": "leaked"},
            source_user_id=profile_id,
        )
    await db_session.rollback()


@pytest.mark.asyncio
async def test_record_proposal_rejects_incoherent_coordinates(
    db_session: AsyncSession,
) -> None:
    fx = await _setup_run_with_instance_field(db_session)
    if fx is None:
        pytest.skip("Missing fixtures.")
    run_id, instance_id, _, _ = fx
    # Pick a field from a different entity_type
    other_field_row = await db_session.execute(
        text(
            """
            SELECT f.id FROM public.extraction_fields f
            WHERE f.entity_type_id <> (
                SELECT entity_type_id FROM public.extraction_instances WHERE id = :iid
            )
            LIMIT 1
            """
        ),
        {"iid": instance_id},
    )
    other_field_id = other_field_row.scalar()
    if other_field_id is None:
        pytest.skip("Need >=2 entity_types with fields.")

    from app.services.coordinate_coherence import CoordinateMismatchError

    service = ExtractionProposalService(db_session)
    with pytest.raises(CoordinateMismatchError):
        await service.record_proposal(
            run_id=run_id,
            instance_id=instance_id,
            field_id=other_field_id,
            source=ExtractionProposalSource.AI,
            proposed_value={"v": "x"},
        )
    await db_session.rollback()


@pytest.mark.asyncio
async def test_list_by_item_returns_chronological(
    db_session: AsyncSession,
) -> None:
    fx = await _setup_run_with_instance_field(db_session)
    if fx is None:
        pytest.skip("Missing fixtures.")
    run_id, instance_id, field_id, _ = fx
    service = ExtractionProposalService(db_session)
    p1 = await service.record_proposal(
        run_id=run_id,
        instance_id=instance_id,
        field_id=field_id,
        source=ExtractionProposalSource.AI,
        proposed_value={"v": "1"},
    )
    p2 = await service.record_proposal(
        run_id=run_id,
        instance_id=instance_id,
        field_id=field_id,
        source=ExtractionProposalSource.AI,
        proposed_value={"v": "2"},
    )
    # Same-transaction inserts tie on created_at (transaction_timestamp); force
    # a distinct order so the chronological assertion is deterministic.
    await db_session.execute(
        text(
            "UPDATE public.extraction_proposal_records "
            "SET created_at = created_at - interval '1 second' WHERE id = :id"
        ),
        {"id": str(p1.id)},
    )

    rows = await service.list_by_item(run_id, instance_id, field_id)
    ids = [r.id for r in rows]
    assert p1.id in ids and p2.id in ids
    assert ids.index(p1.id) < ids.index(p2.id)
    await db_session.rollback()


@pytest.mark.asyncio
async def test_list_by_run_returns_chronological_filtered_by_run_id(
    db_session: AsyncSession,
) -> None:
    """list_by_run returns every proposal for the given run, in insertion order,
    and does NOT leak proposals from a different run on the same coordinates."""
    fx1 = await _setup_run_with_instance_field(db_session)
    fx2 = await _setup_run_with_instance_field(db_session)
    if fx1 is None or fx2 is None:
        pytest.skip("Missing fixtures.")
    run_a, instance_id, field_id, _ = fx1
    run_b, _instance_b, _field_b, _ = fx2
    service = ExtractionProposalService(db_session)

    a1 = await service.record_proposal(
        run_id=run_a,
        instance_id=instance_id,
        field_id=field_id,
        source=ExtractionProposalSource.AI,
        proposed_value={"v": "a1"},
    )
    a2 = await service.record_proposal(
        run_id=run_a,
        instance_id=instance_id,
        field_id=field_id,
        source=ExtractionProposalSource.AI,
        proposed_value={"v": "a2"},
    )
    # Proposal on a DIFFERENT run with the same coordinates — must NOT appear.
    b1 = await service.record_proposal(
        run_id=run_b,
        instance_id=_instance_b,
        field_id=_field_b,
        source=ExtractionProposalSource.AI,
        proposed_value={"v": "b1"},
    )

    # Same-transaction inserts tie on created_at; force a distinct order so the
    # chronological assertion is deterministic.
    await db_session.execute(
        text(
            "UPDATE public.extraction_proposal_records "
            "SET created_at = created_at - interval '1 second' WHERE id = :id"
        ),
        {"id": str(a1.id)},
    )

    rows = await service.list_by_run(run_a)
    ids = [r.id for r in rows]
    assert a1.id in ids and a2.id in ids
    assert b1.id not in ids, "list_by_run leaked a proposal from another run"
    assert ids.index(a1.id) < ids.index(a2.id), "chronological order broken"
    await db_session.rollback()
