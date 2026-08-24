# backend/tests/integration/test_template_create_endpoints.py
"""HTTP-layer smoke for ``POST /projects/{id}/templates``: routing + auth +
envelope + BOLA through the real ASGI stack. Behavior lives in
``test_template_create_service.py``. ``db_client`` shares ``db_session``
(no commits needed for visibility)."""

from __future__ import annotations

from uuid import UUID

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from tests.integration.conftest import SEED, clean_project_clones
from tests.integration.helpers import template_fixtures

auth_as_manager = template_fixtures.auth_as_manager
auth_as_reviewer = template_fixtures.auth_as_reviewer

TEMPLATES = "/api/v1/projects/{pid}/templates"


@pytest.mark.asyncio
async def test_create_returns_201_and_the_standard_envelope(
    db_session: AsyncSession, db_client: AsyncClient, auth_as_manager: UUID
) -> None:
    del auth_as_manager  # consumed for its dependency-override side effect
    project_id = SEED.secondary_project
    await clean_project_clones(db_session, project_id)

    r = await db_client.post(
        TEMPLATES.format(pid=project_id),
        json={"name": "From the dialog", "description": "d", "framework": "CUSTOM"},
    )

    assert r.status_code == 201, r.text
    body = r.json()
    assert body["ok"] is True
    data = body["data"]
    assert data["created"] is True
    assert data["entity_type_count"] == 0
    assert data["field_count"] == 0
    assert data["project_template_id"] and data["version_id"]


@pytest.mark.asyncio
async def test_create_is_manager_only(db_client: AsyncClient, auth_as_reviewer: UUID) -> None:
    """Creating a template deactivates the project's current one — that is
    project-wide configuration, so a reviewer must not reach it."""
    del auth_as_reviewer  # consumed for its dependency-override side effect
    r = await db_client.post(
        TEMPLATES.format(pid=SEED.secondary_project),
        json={"name": "Not allowed", "framework": "CUSTOM"},
    )
    assert r.status_code == 403, r.text


@pytest.mark.asyncio
async def test_create_rejects_unknown_fields(db_client: AsyncClient, auth_as_manager: UUID) -> None:
    """``extra="forbid"`` blocks mass assignment: the client must not be able
    to set ``is_active``, ``project_id`` or ``created_by`` itself."""
    del auth_as_manager  # consumed for its dependency-override side effect
    r = await db_client.post(
        TEMPLATES.format(pid=SEED.secondary_project),
        json={"name": "Sneaky", "framework": "CUSTOM", "is_active": False},
    )
    assert r.status_code == 422, r.text


@pytest.mark.asyncio
async def test_create_validates_the_name(db_client: AsyncClient, auth_as_manager: UUID) -> None:
    del auth_as_manager  # consumed for its dependency-override side effect
    r = await db_client.post(
        TEMPLATES.format(pid=SEED.secondary_project),
        json={"name": "  ", "framework": "CUSTOM"},
    )
    assert r.status_code == 422, r.text
