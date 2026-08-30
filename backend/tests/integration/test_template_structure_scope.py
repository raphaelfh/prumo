"""BOLA: the draft lock is claimed on the PATH template, in the path project.

``claim_draft_lock`` is the first DB statement on all 8 template-config write
endpoints, ahead of the ``owned_template`` check inside the service. It took
``template_id`` raw, so a template outside the path project still got as far
as the lock — and when the lock was held, the 409 named the holder:
``holder_id`` plus ``holder_name``, a cross-project existence + editor-name
oracle. The write itself always rolled back, so this is disclosure, not
corruption.

The sibling ``take_over_draft_lock`` already accepted ``project_id``; this
suite pins the same binding onto the claim path.
"""

from __future__ import annotations

from uuid import UUID

import pytest
from httpx import AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from tests.integration.conftest import SEED
from tests.integration.helpers import engine_setup
from tests.integration.helpers.template_fixtures import draft_lock_holder, fresh_charms

client_as_manager = engine_setup.client_as_manager

_SECTION_BODY = {
    "name": "scope_probe",
    "label": "Scope probe",
    "role": "study_section",
    "cardinality": "one",
}


async def _held_foreign_template(db: AsyncSession) -> str:
    """A template outside the primary project, held by a DIFFERENT editor."""
    _, template_id, _ = await fresh_charms(db)
    await db.execute(
        text(
            "UPDATE public.project_extraction_templates SET config_draft_by = :uid WHERE id = :tid"
        ),
        {"uid": str(SEED.reviewer_profile), "tid": str(template_id)},
    )
    return str(template_id)


@pytest.mark.asyncio
async def test_a_foreign_template_404s_and_its_lock_is_untouched(
    client_as_manager: AsyncClient,
    db_session: AsyncSession,
) -> None:
    """The path template must belong to the path project — before the lock.

    Three things about ONE refusal, because the fixture (a full CHARMS clone
    + republish) is the expensive part: it 404s rather than 409-ing, it names
    neither the holder nor their id, and the scoped UPDATE never matched the
    foreign row, so the real holder keeps the draft.

    ``Integration Reviewer`` is the seeded holder's display name.
    """
    template_id = await _held_foreign_template(db_session)

    r = await client_as_manager.post(
        f"/api/v1/projects/{SEED.primary_project}/templates/{template_id}/sections",
        json=_SECTION_BODY,
    )

    assert r.status_code == 404, r.text
    assert "Integration Reviewer" not in r.text
    assert str(SEED.reviewer_profile) not in r.text
    assert await draft_lock_holder(db_session, UUID(template_id)) == SEED.reviewer_profile


@pytest.mark.asyncio
async def test_own_template_still_claims_the_lock(
    client_as_manager: AsyncClient,
    db_session: AsyncSession,
) -> None:
    """Positive control: the binding must not break the normal edit path."""
    r = await client_as_manager.post(
        f"/api/v1/projects/{SEED.primary_project}/templates/{SEED.primary_template}/sections",
        json={**_SECTION_BODY, "name": "scope_probe_ok"},
    )

    assert r.status_code == 201, r.text
    assert await draft_lock_holder(db_session, SEED.primary_template) == SEED.primary_profile
