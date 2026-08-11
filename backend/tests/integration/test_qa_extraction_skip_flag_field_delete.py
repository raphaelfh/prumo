"""Regression: QA AI re-extraction must not DELETE human-settled fields.

Reproduces the production ``ForeignKeyViolationError`` seen when firing AI
extraction over a whole Quality-Assessment article that already has human
answers:

    update or delete on table "extraction_fields" violates foreign key
    constraint "extraction_proposal_records_field_id_fkey" ...
    Key (id)=(...) is still referenced from table
    "extraction_proposal_records".

Root cause: ``_extract_one_entity_type_for_run`` filtered the fields sent to
the LLM by *reassigning* the ORM-managed ``entity_type.fields`` collection,
which has ``cascade="all, delete-orphan"``. The removed fields (precisely the
ones with a human proposal, hence skipped) were treated as orphans, so the
flush inside ``_create_suggestions`` emitted ``DELETE FROM extraction_fields``
for them — blocked by the ``ondelete=RESTRICT`` FK from the very proposal that
made them "human-settled".

This is invisible to mocks (no real cascade, no real FK), so it lives here as
an integration test against the local Postgres. The reproduction requires
NON-EMPTY LLM output for a kept field so ``_create_suggestions`` actually
flushes while the skipped field is orphaned.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock
from uuid import UUID

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.llm.extractor import LlmUsage
from app.models.extraction import (
    ExtractionField,
    ExtractionFieldType,
    ExtractionRun,
    ExtractionRunStage,
    TemplateKind,
)
from app.models.extraction_workflow import (
    ExtractionProposalRecord,
    ExtractionProposalSource,
)
from app.services.hitl_session_service import HITLSessionService
from app.services.section_extraction_service import SectionExtractionService
from tests.integration.test_extraction_manual_only_flow import _coords


@pytest.mark.asyncio
async def test_skip_flag_does_not_delete_human_settled_field(
    db_session: AsyncSession,
) -> None:
    fx = await _coords(db_session)
    if fx is None:
        pytest.skip("Missing fixtures.")
    project_id, article_id, template_id, profile_id, instance_id, field_a_id = fx

    # The entity type that owns field_A (the seed's single field).
    entity_type_id = (
        await db_session.execute(
            text("SELECT entity_type_id FROM public.extraction_fields WHERE id = :fid"),
            {"fid": str(field_a_id)},
        )
    ).scalar()
    assert entity_type_id is not None
    entity_type_id = UUID(str(entity_type_id))

    # Add a SECOND field the AI is allowed to fill (kept, not human-settled).
    # Two fields are required: one kept so the LLM runs and _create_suggestions
    # flushes, one skipped so it becomes the orphan-delete target.
    field_b = ExtractionField(
        entity_type_id=entity_type_id,
        name="ai_fillable_field",
        label="AI fillable field",
        field_type=ExtractionFieldType.TEXT.value,
    )
    db_session.add(field_b)
    await db_session.flush()

    # The Configuration UI republishes after every edit; without it the new
    # field would (correctly, B-2) be invisible to the pinned prompt tree.
    from app.services.template_version_service import TemplateVersionService

    await TemplateVersionService(db_session).republish(
        project_id=project_id,
        project_template_id=template_id,
        user_id=profile_id,
    )

    # Fresh EXTRACT run for this coord (surrounding suite leaks runs).
    await db_session.execute(
        text(
            "DELETE FROM public.extraction_runs WHERE project_id = :pid "
            "AND article_id = :aid AND template_id = :tid"
        ),
        {"pid": str(project_id), "aid": str(article_id), "tid": str(template_id)},
    )
    session = await HITLSessionService(db_session).open_or_resume(
        kind=TemplateKind.EXTRACTION,
        project_id=project_id,
        article_id=article_id,
        user_id=profile_id,
        project_template_id=template_id,
    )
    run = await db_session.get(ExtractionRun, session.run_id)
    assert run is not None
    assert run.stage == ExtractionRunStage.EXTRACT.value

    # A human has already answered field_A → a ``human`` proposal references it.
    # This both (a) makes the skip flag exclude field_A and (b) is the exact FK
    # (``extraction_proposal_records_field_id_fkey``) that RESTRICTs its delete.
    db_session.add(
        ExtractionProposalRecord(
            run_id=run.id,
            instance_id=instance_id,
            field_id=field_a_id,
            source=ExtractionProposalSource.HUMAN.value,
            source_user_id=profile_id,
            proposed_value={"value": "human answer"},
        )
    )
    await db_session.flush()

    service = SectionExtractionService(
        db=db_session,
        user_id=str(profile_id),
        storage=MagicMock(),
        trace_id="test-qa-skip-flag",
    )
    # Only the LLM is faked; the DB write path (_create_suggestions + flush) is real.
    service._extract_with_llm = AsyncMock(  # type: ignore[method-assign]
        return_value=(
            {
                field_b.name: {
                    "value": "ai answer",
                    "confidence": 0.9,
                    "reasoning": "r",
                    "evidence": [],
                }
            },
            LlmUsage(prompt_tokens=1, completion_tokens=1),
        )
    )

    # Before the fix this raises ForeignKeyViolationError on flush; after the
    # fix it completes and field_A survives untouched.
    pinned_tree = await service._pinned_entity_types(run)
    pinned_entity = next(et for et in pinned_tree if et.id == entity_type_id)
    result = await service._extract_one_entity_type_for_run(
        run=run,
        entity_type=pinned_entity,
        pdf_text="irrelevant — LLM is mocked",
        framework=None,
        kind="quality_assessment",
        skip_fields_with_human_proposals=True,
    )

    # The kept field got an AI proposal ...
    assert result["suggestions_created"] == 1
    # ... and the human-settled field was NOT deleted.
    survived = (
        await db_session.execute(
            text("SELECT 1 FROM public.extraction_fields WHERE id = :fid"),
            {"fid": str(field_a_id)},
        )
    ).scalar()
    assert survived == 1


@pytest.mark.asyncio
async def test_call_site_passes_pinned_not_live_instruction(
    db_session: AsyncSession,
) -> None:
    """Spec §9-A: prompts read the run-PINNED snapshot's general
    instruction, never the live column — a reopened/old run keeps the
    instruction it was assessed under. Guards the call-site wiring (an
    implementation reading the live column or the active version would
    leave every helper-level test green)."""
    from uuid import uuid4

    fx = await _coords(db_session)
    if fx is None:
        pytest.skip("Missing fixtures.")
    project_id, article_id, template_id, profile_id, _instance_id, field_a_id = fx

    entity_type_id = (
        await db_session.execute(
            text("SELECT entity_type_id FROM public.extraction_fields WHERE id = :fid"),
            {"fid": str(field_a_id)},
        )
    ).scalar()
    assert entity_type_id is not None
    entity_type_id = UUID(str(entity_type_id))

    await db_session.execute(
        text(
            "DELETE FROM public.extraction_runs WHERE project_id = :pid "
            "AND article_id = :aid AND template_id = :tid"
        ),
        {"pid": str(project_id), "aid": str(article_id), "tid": str(template_id)},
    )
    session = await HITLSessionService(db_session).open_or_resume(
        kind=TemplateKind.EXTRACTION,
        project_id=project_id,
        article_id=article_id,
        user_id=profile_id,
        project_template_id=template_id,
    )
    run = await db_session.get(ExtractionRun, session.run_id)
    assert run is not None

    # Pin the run to an OLD version whose snapshot carries "PINNED",
    # while the live column says "LIVE".
    old_version_id = uuid4()
    await db_session.execute(
        text(
            "INSERT INTO public.extraction_template_versions "
            "(id, project_template_id, version, schema, published_by, is_active) "
            "VALUES (:id, :tid, 998, "
            ' \'{"entity_types": [], "llm_template_instruction": "PINNED"}\'::jsonb, '
            " :pub, false)"
        ),
        {"id": str(old_version_id), "tid": str(template_id), "pub": str(profile_id)},
    )
    await db_session.execute(
        text("UPDATE public.extraction_runs SET version_id = :vid WHERE id = :rid"),
        {"vid": str(old_version_id), "rid": str(run.id)},
    )
    await db_session.execute(
        text(
            "UPDATE public.project_extraction_templates "
            "SET llm_template_instruction = 'LIVE' WHERE id = :tid"
        ),
        {"tid": str(template_id)},
    )
    await db_session.refresh(run)

    service = SectionExtractionService(
        db=db_session,
        user_id=str(profile_id),
        storage=MagicMock(),
        trace_id="test-pinned-instruction",
    )
    # Only IO seams are faked; the pinned-instruction fetch inside
    # extract_section runs against the real rows above.
    service._assemble_prompt_text = AsyncMock(  # type: ignore[method-assign]
        return_value="irrelevant — LLM is mocked"
    )
    service._extract_with_llm = AsyncMock(  # type: ignore[method-assign]
        return_value=({}, LlmUsage())
    )

    await service.extract_section(
        project_id=project_id,
        article_id=article_id,
        template_id=template_id,
        entity_type_id=entity_type_id,
        run_id=run.id,
    )

    assert service._extract_with_llm.call_args.kwargs["general_instructions"] == "PINNED"


@pytest.mark.asyncio
async def test_batch_call_site_passes_pinned_not_live_instruction(
    db_session: AsyncSession,
) -> None:
    """Same §9-A guard for the QA/batch surface: ``extract_for_run``'s
    hoisted fetch must read the run-PINNED snapshot, never the live
    column (a live-column or active-version read would leave the
    helper-level tests green)."""
    from uuid import uuid4

    fx = await _coords(db_session)
    if fx is None:
        pytest.skip("Missing fixtures.")
    project_id, article_id, template_id, profile_id, _instance_id, _field_a_id = fx

    await db_session.execute(
        text(
            "DELETE FROM public.extraction_runs WHERE project_id = :pid "
            "AND article_id = :aid AND template_id = :tid"
        ),
        {"pid": str(project_id), "aid": str(article_id), "tid": str(template_id)},
    )
    session = await HITLSessionService(db_session).open_or_resume(
        kind=TemplateKind.EXTRACTION,
        project_id=project_id,
        article_id=article_id,
        user_id=profile_id,
        project_template_id=template_id,
    )
    run = await db_session.get(ExtractionRun, session.run_id)
    assert run is not None

    old_version_id = uuid4()
    await db_session.execute(
        text(
            "INSERT INTO public.extraction_template_versions "
            "(id, project_template_id, version, schema, published_by, is_active) "
            "VALUES (:id, :tid, 997, "
            ' \'{"entity_types": [], "llm_template_instruction": "PINNED"}\'::jsonb, '
            " :pub, false)"
        ),
        {"id": str(old_version_id), "tid": str(template_id), "pub": str(profile_id)},
    )
    await db_session.execute(
        text("UPDATE public.extraction_runs SET version_id = :vid WHERE id = :rid"),
        {"vid": str(old_version_id), "rid": str(run.id)},
    )
    await db_session.execute(
        text(
            "UPDATE public.project_extraction_templates "
            "SET llm_template_instruction = 'LIVE' WHERE id = :tid"
        ),
        {"tid": str(template_id)},
    )
    await db_session.refresh(run)

    service = SectionExtractionService(
        db=db_session,
        user_id=str(profile_id),
        storage=MagicMock(),
        trace_id="test-pinned-instruction-batch",
    )
    service._assemble_prompt_text = AsyncMock(  # type: ignore[method-assign]
        return_value="irrelevant — LLM is mocked"
    )
    service._extract_with_llm = AsyncMock(  # type: ignore[method-assign]
        return_value=({}, LlmUsage())
    )

    await service.extract_for_run(run_id=run.id, auto_advance_to_review=False)

    assert service._extract_with_llm.call_count > 0
    assert all(
        call.kwargs["general_instructions"] == "PINNED"
        for call in service._extract_with_llm.call_args_list
    )
