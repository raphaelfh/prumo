"""Integration: number+unit and 'other' envelopes reach the value_map typed.

Regression for the §6 dict-leak: real persisted envelopes ({value,unit},
double-wrapped, single 'other') must reach ``ExportLayout.value_map`` as
``ExportValue`` machine columns under the consensus ``value_key``.
"""

from __future__ import annotations

from uuid import UUID, uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction import ExtractionRun, ExtractionRunStage, TemplateKind
from app.models.extraction_workflow import (
    ExtractionConsensusMode,
)
from app.services.exports.descriptors import value_key
from app.services.extraction_consensus_service import ExtractionConsensusService
from app.services.extraction_export_service import ExportMode, ExtractionExportService
from app.services.hitl_session_service import HITLSessionService
from app.services.run_lifecycle_service import RunLifecycleService
from tests.integration.conftest import SEED

pytestmark = pytest.mark.asyncio


async def _publish_field(
    db: AsyncSession,
    *,
    run_id: UUID,
    instance_id: UUID,
    field_id: UUID,
    profile_id: UUID,
    value: object,
) -> None:
    """Drive one (instance, field) coord through proposal → review →
    consensus(manual_override) so a published_state row carries ``value``
    verbatim. The run must already be in CONSENSUS stage."""
    consensus_record, published = await ExtractionConsensusService(db).record_consensus(
        run_id=run_id,
        instance_id=instance_id,
        field_id=field_id,
        consensus_user_id=profile_id,
        mode=ExtractionConsensusMode.MANUAL_OVERRIDE,
        value=value,
        rationale="value-resolution regression fixture",
        # Plants a stored legacy envelope verbatim (the shape exports must
        # read), as a system write: a person's override would be canonicalized.
        enforce_contract=False,
    )
    assert consensus_record.run_id == run_id
    assert published.value == value


async def test_consensus_value_map_carries_machine_values(db_session: AsyncSession) -> None:
    """value_map carries 5 + 'mg' (double-wrapped number+unit) and the free
    text (single 'other') as typed columns."""
    if (
        await db_session.execute(
            text("SELECT 1 FROM public.profiles WHERE id = :id"),
            {"id": str(SEED.primary_profile)},
        )
    ).scalar() is None:
        pytest.skip("Missing fixtures.")

    project_id = SEED.primary_project
    article_id = SEED.primary_article
    template_id = SEED.primary_template
    profile_id = SEED.primary_profile
    entity_type_id = SEED.primary_entity_type
    instance_id = SEED.primary_instance
    number_field_id = SEED.primary_field  # seeded 'number' field

    # A second field under the same entity_type for the 'other' shape.
    # Inserted inside this transaction; the closing rollback drops it.
    select_field_id = uuid4()
    await db_session.execute(
        text(
            "INSERT INTO public.extraction_fields "
            "(id, entity_type_id, name, label, field_type, is_required) "
            "VALUES (:id, :etid, 'design', 'Study Design', 'select', false)"
        ),
        {"id": str(select_field_id), "etid": str(entity_type_id)},
    )

    # Fresh run so this test owns the FINALIZED state (the surrounding
    # suite leaks runs in other stages via committed HTTP calls).
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
    run_id = session.run_id

    # The run is already in EXTRACT (session open parks it there); advance
    # straight to CONSENSUS where each field is published via manual_override.
    lifecycle = RunLifecycleService(db_session)
    await lifecycle.advance_stage(
        run_id=run_id,
        target_stage=ExtractionRunStage.CONSENSUS,
        user_id=profile_id,
    )

    # Publish the two envelope shapes the §6 bug corrupts:
    #   * double-wrapped number+unit -> "5 mg"
    #   * single 'other'             -> free text
    expected_other_text = "Retrospective cohort"
    await _publish_field(
        db_session,
        run_id=run_id,
        instance_id=instance_id,
        field_id=number_field_id,
        profile_id=profile_id,
        value={"value": {"value": 5, "unit": "mg"}},
    )
    await _publish_field(
        db_session,
        run_id=run_id,
        instance_id=instance_id,
        field_id=select_field_id,
        profile_id=profile_id,
        value={"selected": "other", "other_text": expected_other_text},
    )

    await lifecycle.advance_stage(
        run_id=run_id,
        target_stage=ExtractionRunStage.FINALIZED,
        user_id=profile_id,
    )
    run = await db_session.get(ExtractionRun, run_id)
    assert run is not None
    assert run.stage == ExtractionRunStage.FINALIZED.value

    service = ExtractionExportService(
        db=db_session,
        user_id=str(profile_id),
    )
    layout = await service.resolve_layout(
        project_id=project_id,
        template_id=template_id,
        mode=ExportMode.CONSENSUS,
        article_ids=[article_id],
        include_ai_metadata=False,
        anonymize_reviewer_names=False,
    )

    # Precondition: the primary version's snapshot is empty (conftest.py:410-417), so
    # entity_types_for_version falls back to live rows and serves the inserted field.
    assert select_field_id in {f.field_id for s in layout.sections for f in s.fields}
    number = layout.value_map[value_key(run_id, instance_id, number_field_id)]
    assert (number.status, number.value_num, number.unit) == ("answered", 5, "mg")
    other = layout.value_map[value_key(run_id, instance_id, select_field_id)]
    assert (other.status, other.value_text, other.other_text) == (
        "answered",
        None,
        expected_other_text,
    )  # D9

    await db_session.rollback()
