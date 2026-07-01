"""The frozen template-version snapshot must carry the ADR-0016 opt-in
disposition flags (allows_not_applicable / allows_not_evaluated) so the run-open
form and the runtime FieldInput affordance stay consistent with the template."""

from __future__ import annotations

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.extraction_snapshot import build_template_version_snapshot


@pytest.mark.asyncio
async def test_snapshot_carries_disposition_flags(db_session: AsyncSession) -> None:
    tid = (
        await db_session.execute(
            text(
                "SELECT t.id FROM public.project_extraction_templates t "
                "JOIN public.extraction_entity_types et ON et.project_template_id = t.id "
                "JOIN public.extraction_fields f ON f.entity_type_id = et.id LIMIT 1"
            )
        )
    ).scalar()
    if tid is None:
        pytest.skip("no project template with a field in the seed graph")

    # Flip one flag on so we prove a True round-trips into the snapshot JSON, not
    # merely that the keys are present. Rolled back with the test transaction.
    await db_session.execute(
        text(
            "UPDATE public.extraction_fields SET allows_not_applicable = true "
            "WHERE id = ("
            "  SELECT f.id FROM public.extraction_fields f "
            "  JOIN public.extraction_entity_types et ON f.entity_type_id = et.id "
            "  WHERE et.project_template_id = :tid ORDER BY f.id LIMIT 1"
            ")"
        ),
        {"tid": str(tid)},
    )

    snapshot = await build_template_version_snapshot(db_session, tid)
    fields = [f for et in snapshot["entity_types"] for f in et["fields"]]

    assert fields, "snapshot produced no fields"
    for f in fields:
        assert "allows_not_applicable" in f, f
        assert "allows_not_evaluated" in f, f
    assert any(f["allows_not_applicable"] is True for f in fields), (
        "the flag we set must round-trip into the snapshot"
    )
