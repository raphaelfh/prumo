"""Integration coverage for the export reviewer picker on a QA template.

The single-/all-users export dialog populates its reviewer dropdown from
``ExtractionExportService.list_eligible_reviewers_for_picker`` (FR-028),
which delegates to ``list_reviewers_with_decisions``. That primitive must
surface reviewers for a ``quality_assessment`` template the same way it
does for ``extraction``: a run's ``kind`` is copied from its template at
creation, so the picker keys on the exported template's own kind, not a
hard-coded ``"extraction"``. Otherwise a QA template's reviewer dropdown
comes back empty even though the finalized run and its decisions exist.

Reuses the finalized two-domain QA fixture from
``test_extraction_export_appraisal_summary`` (a QA run driven to FINALIZED
with primary + second-reviewer non-reject decisions). The ``db_session``
fixture is SAVEPOINT-isolated, so every write rolls back at teardown.
"""

from __future__ import annotations

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from tests.integration.test_extraction_export_appraisal_summary import (
    _seed_finalized_qa_run,
    _service,
)

pytestmark = pytest.mark.asyncio


async def test_qa_template_picker_surfaces_reviewers_with_decisions(
    db_session: AsyncSession,
) -> None:
    """Manager picker lists QA-run reviewers with non-reject decisions.

    The bug: ``list_reviewers_with_decisions`` hard-filtered
    ``ExtractionRun.kind == "extraction"``, so a ``quality_assessment``
    template surfaced ZERO reviewers even though its finalized run carries
    real reviewer decisions. The manager (primary profile) must see both
    the primary reviewer and the second reviewer.
    """
    fx = await _seed_finalized_qa_run(db_session, with_second_reviewer=True)
    if fx is None:
        pytest.skip("Missing fixtures.")

    reviewers = await _service(db_session, fx).list_eligible_reviewers_for_picker(
        project_id=fx.project_id,
        template_id=fx.qa_template_id,
    )

    surfaced_ids = {r["id"] for r in reviewers}
    assert str(fx.user_id) in surfaced_ids, "primary reviewer must surface for a QA template"
    assert str(fx.reviewer_id) in surfaced_ids, "second reviewer must surface for a QA template"

    await db_session.rollback()
