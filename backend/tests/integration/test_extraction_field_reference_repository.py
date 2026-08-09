"""The promoted "which fields hold recorded work" query (B-9b2a D5).

Discard's un-deletable-node gate and the config-diff read's
``affects_recorded_data`` flag must answer the same question about the same
tree, so the UNION over the five ``field_id`` RESTRICT tables lives in ONE
place. This suite owns that query directly; the discard suite exercises it
through the gate.
"""

from __future__ import annotations

from unittest.mock import AsyncMock
from uuid import UUID, uuid4

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.repositories.extraction_field_reference_repository import (
    ExtractionFieldReferenceRepository,
)
from tests.integration.conftest import SEED, make_proposal, open_session
from tests.integration.helpers.template_fixtures import (
    ARTICLE_ID,
    add_field,
    entity_id,
    fresh_charms,
)


@pytest.mark.asyncio
async def test_reports_only_the_fields_the_workflow_references(
    db_session: AsyncSession,
) -> None:
    """A proposal makes its field recorded; its sibling stays clean."""
    project_id, template_id, _ = await fresh_charms(db_session)
    owner = await entity_id(db_session, template_id, "sample_size")
    referenced = await add_field(db_session, owner, "b9b2a_referenced", sort_order=97)
    untouched = await add_field(db_session, owner, "b9b2a_untouched", sort_order=98)
    session = await open_session(
        db_session,
        project_id=project_id,
        article_id=ARTICLE_ID,
        template_id=template_id,
        user_id=SEED.primary_profile,
    )
    await make_proposal(
        db_session,
        run_id=session.run_id,
        instance_id=UUID(session.instances_by_entity_type[str(owner)]),
        field_id=referenced,
        user_id=SEED.primary_profile,
    )

    recorded = await ExtractionFieldReferenceRepository(db_session).fields_with_recorded_work(
        [referenced, untouched]
    )

    assert recorded == frozenset({referenced})


@pytest.mark.asyncio
async def test_unknown_field_ids_are_simply_absent(db_session: AsyncSession) -> None:
    """The caller passes LIVE field ids; an id the workflow never saw is
    not an error, it is just not in the answer."""
    recorded = await ExtractionFieldReferenceRepository(db_session).fields_with_recorded_work(
        [uuid4()]
    )

    assert recorded == frozenset()


@pytest.mark.asyncio
async def test_empty_input_short_circuits_before_any_sql() -> None:
    """A template with no fields must not pay for a five-way UNION."""
    db = AsyncMock()

    recorded = await ExtractionFieldReferenceRepository(db).fields_with_recorded_work([])

    assert recorded == frozenset()
    db.execute.assert_not_awaited()
