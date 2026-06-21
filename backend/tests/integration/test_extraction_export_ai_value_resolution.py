"""Integration: AI-metadata value columns resolve envelopes (A1).

The 'AI proposed value' column must surface number+unit/other scalars,
never a Python-repr dict (the reported AI-metadata bug).

``_load_ai_proposal_rows`` read ``ExtractionProposalRecord.proposed_value``
through the too-narrow ``_unwrap_value`` (single-key ``{"value": ...}``
only), so a real double-wrapped number+unit envelope leaked into the
'AI proposed value' cell as a ``dict``. This drives a real AI proposal
record through to a FINALIZED run and asserts the column carries the
resolved scalar. ``final_value_used`` already comes resolved from the
consensus value_map (prior task), and must likewise never be a dict.
"""

from __future__ import annotations

from unittest.mock import MagicMock
from uuid import UUID

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


async def test_ai_proposed_value_resolves_number_unit(
    db_session: AsyncSession,
) -> None:
    """The 'AI proposed value' column surfaces '5 mg' from the real
    double-wrapped number+unit envelope, never a dict; 'Final value
    used' is likewise a resolved scalar."""
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
    instance_id = SEED.primary_instance
    number_field_id = SEED.primary_field  # seeded 'number' field "Sample Size"
    number_field_label = "Sample Size"

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
    run_id: UUID = session.run_id

    proposals = ExtractionProposalService(db_session)
    lifecycle = RunLifecycleService(db_session)

    # AI proposals persist when recorded in EXTRACT stage. The
    # double-wrapped number+unit shape is the real write-path payload the
    # §6 bug corrupted; it must surface as "5 mg" in the AI column.
    await proposals.record_proposal(
        run_id=run_id,
        instance_id=instance_id,
        field_id=number_field_id,
        source=ExtractionProposalSource.AI,
        proposed_value={"value": {"value": 5, "unit": "mg"}},
        confidence_score=0.9,
        rationale="AI-metadata resolution fixture",
    )

    # The run is already in EXTRACT (session open parks it there); advance
    # straight to CONSENSUS, where the value is published via manual_override.
    await lifecycle.advance_stage(
        run_id=run_id,
        target_stage=ExtractionRunStage.CONSENSUS,
        user_id=profile_id,
    )

    # Publish the consensus value so final_value_used is populated.
    _consensus, published = await ExtractionConsensusService(db_session).record_consensus(
        run_id=run_id,
        instance_id=instance_id,
        field_id=number_field_id,
        consensus_user_id=profile_id,
        mode=ExtractionConsensusMode.MANUAL_OVERRIDE,
        value={"value": {"value": 5, "unit": "mg"}},
        rationale="AI-metadata resolution fixture",
    )
    assert published.value == {"value": {"value": 5, "unit": "mg"}}

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
        include_ai_metadata=True,
        anonymize_reviewer_names=False,
    )

    rows = layout.ai_proposal_rows
    assert rows, "expected at least one AI proposal row"
    target = next(r for r in rows if r.field_label == number_field_label)
    assert target.ai_proposed_value == "5 mg"
    for r in rows:
        assert not isinstance(r.ai_proposed_value, dict)
        assert not isinstance(r.final_value_used, dict)

    await db_session.rollback()
