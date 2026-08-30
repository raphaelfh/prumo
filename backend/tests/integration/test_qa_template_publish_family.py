"""Evidence: the publish-family endpoints accept a QUALITY_ASSESSMENT template.

The PICOT AI-context design (spec §5c) mounts ``TemplateInstructionControl``
and the publish cluster on the QA Configuration tab with "no backend work",
resting on the observation that ``template_instruction_service`` and
``TemplateVersionService`` carry no ``kind`` predicate. That was READ from the
absence of a filter, never exercised: every existing test in the family drives
an ``extraction`` clone (``test_template_version_republish.py`` clones CHARMS).

This file converts that inference into evidence, and is deliberately written
BEFORE the surface that depends on it. If a ``kind`` guard is ever added to
these endpoints, this fails and the QA Configuration tab is known to be
unbuildable — instead of shipping and 404ing in a manager's face.

Scope note: ``to_portable`` / ``parse_portable_document`` (export/import) ARE
hard-gated to extraction. Spec §5c does not mount them, and this file does not
claim they work.
"""

from __future__ import annotations

from collections.abc import AsyncGenerator
from uuid import UUID

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import TokenPayload, get_current_user
from app.main import app
from app.models.extraction import TemplateKind
from app.services.template_clone_service import TemplateCloneService
from tests.integration.conftest import SEED

# Seeded PROBAST global (``app/seed.py:158``). Cloning the SEEDED global — not
# ``TemplateFactory`` — is what makes this a faithful probe: the factory never
# sets ``global_template_id``, and a committed ``kind='quality_assessment'``
# row without one is exactly what ``test_kind_discriminator`` asserts a zero
# count of.
PROBAST_GLOBAL_ID = UUID("00b00000-0000-0000-0000-000000000001")


async def _clean_project_clones(db: AsyncSession, project_id: UUID) -> None:
    await db.execute(
        text("DELETE FROM public.project_extraction_templates WHERE project_id = :pid"),
        {"pid": str(project_id)},
    )
    await db.flush()


@pytest_asyncio.fixture
async def auth_as_manager(db_session: AsyncSession) -> AsyncGenerator[UUID, None]:
    """JWT sub must be a real profile id (manager on the seeded projects)."""
    del db_session  # kept for fixture-dependency ordering; the seed runs first
    profile_id = SEED.primary_profile

    async def override_get_current_user() -> TokenPayload:
        return TokenPayload(
            sub=str(profile_id),
            email="test@example.com",
            role="authenticated",
            aal="aal1",
        )

    app.dependency_overrides[get_current_user] = override_get_current_user
    yield profile_id


@pytest.mark.asyncio
async def test_qa_template_accepts_instruction_then_publish(
    db_session: AsyncSession,
    db_client: AsyncClient,
    auth_as_manager: UUID,
) -> None:
    """A QA clone survives the full config-diff -> instruction -> publish chain.

    Three endpoints, not two: ``republish-version`` refuses a ``None``
    fingerprint whenever its own under-lock recompute says the publish is
    AVAILABLE, so the diff sheet has to be read first for its fingerprint.
    That makes ``config-diff`` a third kind-untested endpoint this proves.
    """
    project_id = SEED.secondary_project
    await _clean_project_clones(db_session, project_id)
    clone = await TemplateCloneService(db_session).clone(
        project_id=project_id,
        global_template_id=PROBAST_GLOBAL_ID,
        user_id=auth_as_manager,
        kind=TemplateKind.QUALITY_ASSESSMENT,
    )
    await db_session.flush()

    instruction = "Step-1 PICOTS for this review: adults with acute heart failure."
    put = await db_client.put(
        f"/api/v1/projects/{project_id}/templates/{clone.project_template_id}/llm-instruction",
        json={"llm_template_instruction": instruction},
    )
    assert put.status_code == 200, put.text
    assert put.json()["data"]["llm_template_instruction"] == instruction

    sheet = await db_client.get(
        f"/api/v1/projects/{project_id}/templates/{clone.project_template_id}/config-diff"
    )
    assert sheet.status_code == 200, sheet.text

    published = await db_client.post(
        f"/api/v1/projects/{project_id}/templates/{clone.project_template_id}/republish-version",
        json={"expected_fingerprint": sheet.json()["data"]["fingerprint"]},
    )
    assert published.status_code == 200, published.text
    data = published.json()["data"]
    assert data["changed"] is True
    assert UUID(data["version_id"]) != clone.version_id

    # The instruction reached the NEW version's snapshot — which is what the
    # prompts read (never the live column), so this is the assertion that
    # proves a QA publish actually changes what the model is told.
    pinned = (
        await db_session.execute(
            text(
                "SELECT schema ->> 'llm_template_instruction' "
                "FROM public.extraction_template_versions WHERE id = :vid"
            ),
            {"vid": data["version_id"]},
        )
    ).scalar_one_or_none()
    assert pinned == instruction

    await db_session.rollback()
