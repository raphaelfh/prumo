"""Changing a field's type with answers recorded is ALLOWED, then acked.

The inspector used to tell the manager "Type changes are blocked once the
field holds extracted data." Nothing blocks it: `update_field` has no such
guard, and B-9b2b deliberately chose ack-over-block — `_attribute_tier`
marks `field_type` DESTRUCTIVE when the field has values
(`template_diff.py:535`), so it needs a per-item ☑ before it can reach
published data.

Blocking would be the wrong product: a field typed `text` that should
always have been `number` is exactly the correction a manager needs to
make, and the recorded answers are what the acknowledgement is for.

This pins both halves, because the copy now describes them and a future
"fix" that adds a block would silently contradict the publish contract.
"""

from __future__ import annotations

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.template_change import ChangeTier
from app.services.template_version_read_service import get_template_config_diff
from tests.integration.conftest import SEED, make_proposal, open_session
from tests.integration.helpers.template_fixtures import (
    ARTICLE_ID,
    entity_id,
    field_id,
    fresh_charms,
)


@pytest.mark.asyncio
async def test_a_type_change_on_a_field_with_answers_is_allowed_and_destructive(
    db_session: AsyncSession,
) -> None:
    project_id, template_id, _ = await fresh_charms(db_session)
    owner = await entity_id(db_session, template_id, "sample_size")
    target = await field_id(db_session, template_id, "sample_size", "number_of_participants")

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
        instance_id=__import__("uuid").UUID(session.instances_by_entity_type[str(owner)]),
        field_id=target,
        user_id=SEED.primary_profile,
    )

    # The write is NOT refused — this is the half the copy got wrong.
    await db_session.execute(
        text("UPDATE public.extraction_fields SET field_type = 'text' WHERE id = :f"),
        {"f": str(target)},
    )
    await db_session.flush()

    diff = await get_template_config_diff(
        db_session, project_id=project_id, template_id=template_id
    )

    row = next(r for r in diff.changes.destructive if r.attribute == "field_type")
    assert row.tier is ChangeTier.DESTRUCTIVE
    assert row.affects_recorded_data is True
