"""Integration: number+unit and 'other' envelopes resolve to scalars.

Regression for the §6 dict-leak: real persisted envelopes
({value,unit}, double-wrapped, single 'other') must reach the
ExportLayout.value_map as openpyxl-writable scalars, never dicts.

The consensus value_map is keyed by ``(run_id, instance_id, field_id)``
and feeds the matrix sheet directly. Before this fix the builders ran
each published ``value`` through the too-narrow ``_unwrap_value`` (which
only unwraps a single-key ``{"value": ...}``), so a number+unit envelope
or a double-wrapped one leaked into the cell as a Python-repr ``dict``.
"""

from __future__ import annotations

from unittest.mock import MagicMock
from uuid import UUID, uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction import ExtractionRun, ExtractionRunStage, TemplateKind
from app.models.extraction_workflow import (
    ExtractionConsensusMode,
    ExtractionProposalSource,
)
from app.services.extraction_consensus_service import ExtractionConsensusService
from app.services.extraction_export_service import ExportMode, ExtractionExportService
from app.services.extraction_proposal_service import ExtractionProposalService
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
    )
    assert consensus_record.run_id == run_id
    assert published.value == value


async def test_consensus_value_map_resolves_unit_and_other(
    db_session: AsyncSession,
) -> None:
    """value_map carries '5 mg' (double-wrapped number+unit) and the free
    text (single 'other'), never a dict."""
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

    # Park a human proposal per coord, mirroring the manual-only flow.
    # Advancing PROPOSAL → REVIEW materializes each into an
    # accept_proposal reviewer_decision (invariant I-1), so the run can
    # then advance to CONSENSUS where we publish via manual_override.
    proposals = ExtractionProposalService(db_session)
    lifecycle = RunLifecycleService(db_session)

    for fid in (number_field_id, select_field_id):
        await proposals.record_proposal(
            run_id=run_id,
            instance_id=instance_id,
            field_id=fid,
            source=ExtractionProposalSource.HUMAN,
            source_user_id=profile_id,
            proposed_value={"value": "seed"},
        )

    await lifecycle.advance_stage(
        run_id=run_id,
        target_stage=ExtractionRunStage.REVIEW,
        user_id=profile_id,
    )
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
        storage=MagicMock(),
    )
    layout = await service.resolve_layout(
        project_id=project_id,
        template_id=template_id,
        mode=ExportMode.CONSENSUS,
        article_ids=[article_id],
        include_ai_metadata=False,
        anonymize_reviewer_names=False,
    )

    key_unit = (run_id, instance_id, number_field_id)
    key_other = (run_id, instance_id, select_field_id)
    assert layout.value_map[key_unit] == "5 mg"
    assert layout.value_map[key_other] == expected_other_text
    for v in layout.value_map.values():
        assert not isinstance(v, dict)

    await db_session.rollback()
