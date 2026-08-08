"""HTTP-layer smoke for the B-7 template-structure endpoints.

The full behavior matrix lives in the service integration tests
(test_template_field_service.py / test_template_section_service.py) and
the direct-coroutine unit tests; this exercises the one thing neither
can — routing + auth + envelope through the real ASGI stack: a field
create lands a row (201) and a foreign-project URL 404s (BOLA).
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
from tests.integration.conftest import (
    SEED,
    clean_project_clones,
    clone_charms,
    first_entity_type_id,
)


@pytest_asyncio.fixture
async def auth_as_profile(
    db_session: AsyncSession,
) -> AsyncGenerator[UUID, None]:
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
async def test_create_field_endpoint_persists_row(
    db_session: AsyncSession,
    db_client: AsyncClient,
    auth_as_profile: UUID,
) -> None:
    project_id = SEED.secondary_project
    await clean_project_clones(db_session, project_id)
    clone = await clone_charms(db_session, project_id, auth_as_profile)
    et_id = await first_entity_type_id(db_session, clone.project_template_id)

    res = await db_client.post(
        f"/api/v1/projects/{project_id}/templates/{clone.project_template_id}/fields",
        json={
            "entity_type_id": str(et_id),
            "name": "smoke_endpoint_field",
            "label": "Smoke Endpoint Field",
            "field_type": "text",
        },
    )
    assert res.status_code == 201, res.text
    envelope = res.json()
    assert envelope["ok"] is True
    data = envelope["data"]
    assert data["name"] == "smoke_endpoint_field"
    assert data["entity_type_id"] == str(et_id)

    persisted = (
        await db_session.execute(
            text("SELECT 1 FROM public.extraction_fields WHERE id = :id"),
            {"id": data["id"]},
        )
    ).scalar()
    assert persisted == 1

    await db_session.rollback()


@pytest.mark.asyncio
async def test_create_field_endpoint_404_for_foreign_project(
    db_session: AsyncSession,
    db_client: AsyncClient,
    auth_as_profile: UUID,
) -> None:
    """BOLA: writing a template through another project's URL is 404."""
    await clean_project_clones(db_session, SEED.secondary_project)
    clone = await clone_charms(db_session, SEED.secondary_project, auth_as_profile)
    et_id = await first_entity_type_id(db_session, clone.project_template_id)

    res = await db_client.post(
        f"/api/v1/projects/{SEED.primary_project}/templates/{clone.project_template_id}/fields",
        json={
            "entity_type_id": str(et_id),
            "name": "bola_field",
            "label": "Bola Field",
            "field_type": "text",
        },
    )
    assert res.status_code == 404, res.text

    await db_session.rollback()
