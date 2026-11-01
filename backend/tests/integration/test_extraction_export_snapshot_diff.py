"""Integration: snapshot section reader against real local Supabase (spec §5.1)."""

from __future__ import annotations

from uuid import UUID

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.repositories.extraction_template_version_repository import (
    ExtractionTemplateVersionRepository,
)
from app.services.exports.extraction_snapshot_reader import load_export_sections
from tests.integration.conftest import SEED


async def _seeded_template_id(db: AsyncSession) -> UUID:
    project_id = (
        await db.execute(
            text("SELECT id FROM public.projects WHERE id = :pid"),
            {"pid": str(SEED.primary_project)},
        )
    ).scalar()
    template_id = (
        await db.execute(
            text(
                "SELECT id FROM public.project_extraction_templates "
                "WHERE kind = 'extraction' AND project_id = :pid LIMIT 1"
            ),
            {"pid": project_id},
        )
    ).scalar()
    if template_id is None:
        pytest.skip("No seeded extraction template")
    return UUID(str(template_id))


@pytest.mark.asyncio
async def test_load_export_sections_reads_active_version_snapshot(
    db_session: AsyncSession,
) -> None:
    template_id = await _seeded_template_id(db_session)
    version = await ExtractionTemplateVersionRepository(db_session).get_active(template_id)
    assert version is not None, "seeded template must have an active version"

    sections = await load_export_sections(db_session, version_id=version.id)

    assert sections, "active version snapshot must yield sections"
    # Ordered by sort_order, ascending.
    orders = [s.sort_order for s in sections]
    assert orders == sorted(orders)
    # Every section carries cardinality + its parent edge from the snapshot.
    # `role` is no longer read here at all (trees B4): structure is
    # `parent_entity_type_id` + `cardinality`.
    for s in sections:
        assert s.cardinality is not None
        assert not hasattr(s, "role")
    # This fixture's template is root sections only, so only the root edge
    # is assertable here; the nested edge is covered by the unit tests over
    # `ancestry` and by test_extraction_export_many_cardinality_fanout.
    assert any(s.parent_entity_type_id is None for s in sections)
    # Field metadata threads through (label + field_id present on every field).
    a_field = next((f for s in sections for f in s.fields), None)
    assert a_field is not None
    assert a_field.label
