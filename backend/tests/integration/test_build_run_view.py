"""build_run_view composes get_run_with_workflow_history (the single blind
filter) and adds entity_types + current_values. It must NOT re-introduce a
blind leak, and current_values must be empty for an extract-stage run that has
no recorded decisions yet."""

from __future__ import annotations

from uuid import uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.extraction_run_read_service import build_run_view
from tests.integration.conftest import SEED
from tests.integration.test_blind_review_isolation import (
    _build_two_reviewer_review_run,
)
from tests.integration.test_run_proposals_latest_wins import _proposal_stage_coord


@pytest.mark.asyncio
async def test_build_run_view_blinds_peer_in_review(db_session: AsyncSession) -> None:
    built = await _build_two_reviewer_review_run(db_session)
    if built is None:
        pytest.skip("Seed graph incomplete")
    run_id, reviewer_a, reviewer_b = built

    view = await build_run_view(db_session, run_id, caller_id=reviewer_b, can_see_peers=False)
    reviewer_ids = {d.reviewer_id for d in view.decisions}
    assert reviewer_b in reviewer_ids
    assert reviewer_a not in reviewer_ids, "build_run_view leaked a peer decision"
    assert view.entity_types, "entity_types tree must be populated"
    assert isinstance(view.current_values, list)


@pytest.mark.asyncio
async def test_build_run_view_current_values_empty_in_extract(
    db_session: AsyncSession,
) -> None:
    fx = await _proposal_stage_coord(db_session)
    if fx is None:
        pytest.skip("Seed graph incomplete")
    run_id, _instance_id, _field_id, user_id = fx

    view = await build_run_view(db_session, run_id, caller_id=user_id, can_see_peers=False)
    assert view.run.stage == "extract"
    assert view.current_values == [], (
        "an extract-stage run with no recorded decisions has empty current_values"
    )


@pytest.mark.asyncio
async def test_build_run_view_instances_populated_and_scoped(
    db_session: AsyncSession,
) -> None:
    """build_run_view must populate instances scoped to (article_id, template_id).

    Creates a fresh run via _proposal_stage_coord (same builder used by
    test_build_run_view_current_values_empty_in_extract) so the test always
    executes — it no longer depends on a pre-existing run surviving the seed
    purge.

    Scope assertions:
    1. view.instances is a non-empty list.
    2. Every returned instance has article_id == run.article_id AND
       template_id == run.template_id.
    3. Cross-contamination proof: a foreign instance inserted under a different
       article_id is NOT returned by build_run_view.
    """
    fx = await _proposal_stage_coord(db_session)
    if fx is None:
        pytest.skip("Seed graph incomplete")
    run_id, _instance_id, _field_id, user_id = fx

    view = await build_run_view(db_session, run_id, caller_id=user_id, can_see_peers=True)

    assert isinstance(view.instances, list), "instances must be a list"
    assert len(view.instances) >= 1, (
        "build_run_view must return at least the seed instance for this article+template"
    )

    run_article_id = view.run.article_id
    run_template_id = view.run.template_id

    # Scope check: every instance must match the run's (article_id, template_id).
    for inst in view.instances:
        assert inst.article_id == run_article_id, (
            f"Instance {inst.id} has article_id {inst.article_id!r} but run has {run_article_id!r}"
        )
        assert inst.template_id == run_template_id, (
            f"Instance {inst.id} has template_id {inst.template_id!r} "
            f"but run has {run_template_id!r}"
        )

    # Cross-contamination proof: insert an instance under a DIFFERENT article_id
    # (using a fresh article in the same project) and confirm it is excluded.
    foreign_article_id = uuid4()
    foreign_instance_id = uuid4()
    await db_session.execute(
        text(
            "INSERT INTO public.articles (id, project_id, title, row_version) "
            "VALUES (:id, :pid, 'Foreign Article (scope test)', 1)"
        ),
        {"id": str(foreign_article_id), "pid": str(SEED.primary_project)},
    )
    await db_session.execute(
        text(
            "INSERT INTO public.extraction_instances "
            "(id, project_id, template_id, entity_type_id, article_id, "
            " label, status, created_by) "
            "VALUES (:id, :pid, :tid, :etid, :aid, "
            " 'Foreign Instance (scope test)', 'pending', :created_by)"
        ),
        {
            "id": str(foreign_instance_id),
            "pid": str(SEED.primary_project),
            "tid": str(run_template_id),
            "etid": str(SEED.primary_entity_type),
            "aid": str(foreign_article_id),
            "created_by": str(user_id),
        },
    )
    await db_session.flush()

    # Re-query after inserting the foreign instance.
    view2 = await build_run_view(db_session, run_id, caller_id=user_id, can_see_peers=True)
    returned_ids = {i.id for i in view2.instances}
    assert foreign_instance_id not in returned_ids, (
        "_instances_for_run must exclude instances from other articles; "
        f"foreign instance {foreign_instance_id} leaked into view"
    )
