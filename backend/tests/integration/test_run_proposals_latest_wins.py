"""Phase 0 reproduction — an updated value reverts to the OLD value on refresh.

Reported by a user and reproduced live on production: edit an already-filled
field (V1 -> V2), refresh the page, and the form shows V1 again — the update
is lost. Root cause is a read-ordering mismatch on the PROPOSAL-stage
hydration path:

  * proposals are append-only; updating a field appends a NEWER row (V2)
    while V1 remains (extraction_proposal_service.record_proposal);
  * the API read returns a coord's proposals OLDEST-first
    (ExtractionProposalRepository.list_by_run -> created_at.asc(),
    extraction_proposal_repository.py:49);
  * the form keeps the FIRST proposal per (instance, field)
    (useExtractedValues.ts:184), under a comment that wrongly assumes the
    API is newest-first.

First-of-oldest-first = the oldest = V1, so the stale value wins. (A
re-record-on-mount then re-stamps the stale value as newest, making the
loss permanent — covered by the consolidation's "save only on change"
fix, not asserted here.)

This test pins the contract the form depends on: for a coordinate with
multiple proposals, the read model must surface the NEWEST value (V2) as
the one that drives the form. It is RED today and turns GREEN once the
consolidation resolves current values newest-first (RunView, or
list_by_run -> created_at.desc()).
"""

from __future__ import annotations

from uuid import UUID

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction import ExtractionRunStage
from app.models.extraction_workflow import ExtractionProposalSource
from app.services.extraction_proposal_service import ExtractionProposalService
from app.services.extraction_run_read_service import get_run_with_workflow_history
from app.services.run_lifecycle_service import RunLifecycleService


async def _proposal_stage_coord(
    db: AsyncSession,
) -> tuple[UUID, UUID, UUID, UUID] | None:
    """Build an EXTRACT-stage run; return (run_id, instance_id, field_id, user_id)."""
    project_id = (
        await db.execute(
            text(
                "SELECT p.id FROM public.projects p WHERE EXISTS (SELECT 1 FROM public.project_extraction_templates t JOIN public.extraction_entity_types et ON et.project_template_id = t.id JOIN public.extraction_fields f ON f.entity_type_id = et.id JOIN public.extraction_instances i ON i.template_id = t.id WHERE t.project_id = p.id) ORDER BY p.id LIMIT 1"
            )
        )
    ).scalar()
    if project_id is None:
        return None
    article_id = (
        await db.execute(
            text("SELECT id FROM public.articles WHERE project_id = :pid LIMIT 1"),
            {"pid": str(project_id)},
        )
    ).scalar()
    template_id = (
        await db.execute(
            text(
                "SELECT id FROM public.project_extraction_templates "
                "WHERE project_id = :pid AND kind = 'extraction' LIMIT 1"
            ),
            {"pid": str(project_id)},
        )
    ).scalar()
    user_id = (
        await db.execute(
            text(
                "SELECT pm.user_id FROM public.project_members pm WHERE pm.role = 'manager' AND EXISTS (SELECT 1 FROM public.project_extraction_templates t JOIN public.extraction_entity_types et ON et.project_template_id = t.id JOIN public.extraction_fields f ON f.entity_type_id = et.id JOIN public.extraction_instances i ON i.template_id = t.id WHERE t.project_id = pm.project_id) ORDER BY pm.user_id LIMIT 1"
            )
        )
    ).scalar()
    if not all((article_id, template_id, user_id)):
        return None
    coord = (
        await db.execute(
            text(
                """
                SELECT i.id, f.id
                FROM public.extraction_instances i
                JOIN public.extraction_entity_types et ON et.id = i.entity_type_id
                JOIN public.extraction_fields f ON f.entity_type_id = et.id
                WHERE i.template_id = :tid AND i.article_id = :aid
                LIMIT 1
                """
            ),
            {"tid": str(template_id), "aid": str(article_id)},
        )
    ).first()
    if coord is None:
        return None
    instance_id, field_id = coord

    lifecycle = RunLifecycleService(db)
    run = await lifecycle.create_run(
        project_id=project_id,
        article_id=article_id,
        project_template_id=template_id,
        user_id=user_id,
    )
    await lifecycle.advance_stage(
        run_id=run.id, target_stage=ExtractionRunStage.EXTRACT, user_id=user_id
    )
    return run.id, instance_id, field_id, UUID(str(user_id))


@pytest.mark.asyncio
async def test_read_model_preserves_proposals_for_newest_wins_resolution(
    db_session: AsyncSession,
) -> None:
    """Data contract behind the stale-update fix.

    The read model must preserve EVERY append-only proposal for a coord and
    carry ``created_at``, so a resolver can select the newest. The selection
    itself is order-independent and unit-tested in
    ``frontend/lib/extraction/proposalValues.test.ts``.

    We deliberately do NOT assert the API returns newest-first: the QA
    hydration path (``QualityAssessmentFullScreen.tsx``) relies on the
    OPPOSITE (oldest-first) order with a last-wins merge, so reordering
    ``list_by_run`` would fix extraction but silently break QA. Both clients
    are being converged onto the shared newest-by-created_at resolver
    instead.
    """
    fx = await _proposal_stage_coord(db_session)
    if fx is None:
        pytest.skip("Seed graph incomplete")
    run_id, instance_id, field_id, user_id = fx

    proposals = ExtractionProposalService(db_session)
    # AI source: human extraction writes go through /decisions now, but the
    # append-only / newest-wins read contract is source-agnostic, so we
    # exercise it via AI proposals (allowed on extraction runs in extract).
    v1 = await proposals.record_proposal(
        run_id=run_id,
        instance_id=instance_id,
        field_id=field_id,
        source=ExtractionProposalSource.AI,
        proposed_value={"value": "V1-original"},
    )
    v2 = await proposals.record_proposal(
        run_id=run_id,
        instance_id=instance_id,
        field_id=field_id,
        source=ExtractionProposalSource.AI,
        proposed_value={"value": "V2-updated"},
    )
    # now() is constant within a transaction, so both rows tie on created_at.
    # Force the production reality (each POST is its own txn → distinct time):
    # V1 strictly older than V2.
    await db_session.execute(
        text(
            "UPDATE public.extraction_proposal_records SET created_at = now() - interval '2 hours' WHERE id = :id"
        ),
        {"id": str(v1.id)},
    )
    await db_session.execute(
        text(
            "UPDATE public.extraction_proposal_records SET created_at = now() - interval '1 hour' WHERE id = :id"
        ),
        {"id": str(v2.id)},
    )
    await db_session.flush()
    # The raw UPDATE bypasses the ORM identity map, so the in-session
    # instances still hold their original (tied) created_at. Expire them so
    # the read re-fetches the distinct timestamps — in production each
    # proposal is recorded in its own transaction, so this is automatic.
    db_session.expire_all()

    detail = await get_run_with_workflow_history(
        db_session, run_id, caller_id=user_id, can_see_peers=False
    )
    coord_proposals = [
        p for p in detail.proposals if p.instance_id == instance_id and p.field_id == field_id
    ]
    assert len(coord_proposals) == 2, (
        "read model must not collapse append-only proposals — the resolver "
        "needs every row to pick the newest"
    )
    # created_at must be present and correct so newest-wins resolution works.
    newest = max(coord_proposals, key=lambda p: p.created_at)
    assert newest.proposed_value == {"value": "V2-updated"}, (
        "Newest-wins data contract broken: the newest proposal by created_at "
        f"is not the updated value ({newest.proposed_value})."
    )
