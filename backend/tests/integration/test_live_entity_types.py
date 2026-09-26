"""``live_entity_types`` matches the live-fallback branch of
``entity_types_for_version`` (spec §1.1 fallback chain)."""

from __future__ import annotations

from uuid import uuid4

from app.repositories.extraction_template_version_repository import (
    ExtractionTemplateVersionRepository,
)
from app.services.extraction_snapshot import entity_types_for_version, live_entity_types
from tests.integration.helpers.template_fixtures import force_narrow_baseline, fresh_charms


async def test_live_entity_types_matches_narrow_fallback(db_session):
    project_id, template_id, schema = await fresh_charms(db_session)
    live = await live_entity_types(db_session, template_id=template_id)
    assert [et.id for et in live] and all(
        [f.sort_order for f in et.fields] == sorted(f.sort_order for f in et.fields) for et in live
    )
    await force_narrow_baseline(db_session, template_id, uuid4())
    active = await ExtractionTemplateVersionRepository(db_session).get_active(template_id)
    via_version = await entity_types_for_version(
        db_session, version_id=active.id, template_id=template_id
    )
    assert [e.model_dump() for e in via_version] == [e.model_dump() for e in live]
