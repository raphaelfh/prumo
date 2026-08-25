# backend/tests/integration/test_template_portable_endpoints.py
"""HTTP-layer smoke for export / import / delete: routing + auth + envelope +
BOLA through the real ASGI stack. Behavior lives in the service tests.
``db_client`` shares ``db_session`` (no commits needed for visibility)."""

from __future__ import annotations

from uuid import UUID, uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from tests.integration.conftest import SEED, clean_project_clones, clone_charms
from tests.integration.helpers import template_fixtures

# Registered by assignment, the idiom the sibling suites use (pytest collects
# fixtures from module attributes).
auth_as_manager = template_fixtures.auth_as_manager

TEMPLATES = "/api/v1/projects/{pid}/templates"


@pytest.mark.asyncio
async def test_export_then_import_over_http(
    db_session: AsyncSession, db_client: AsyncClient, auth_as_manager: UUID
) -> None:
    project_id = SEED.secondary_project
    await clean_project_clones(db_session, project_id)
    clone = await clone_charms(db_session, project_id, auth_as_manager)

    r = await db_client.get(
        f"{TEMPLATES.format(pid=project_id)}/{clone.project_template_id}/export"
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["ok"] is True
    doc = body["data"]
    assert doc["prumo_template"] == 1 and doc["kind"] == "extraction"
    # File keys, not attribute names; defaults omitted (spec §4) — a field
    # carries "required" only when it is true.
    first_field = doc["sections"][0]["fields"][0]
    assert "type" in first_field and "field_type" not in first_field
    assert first_field.get("required", True) is True
    assert all(
        "allow_other" not in f or f["allow_other"] is True
        for s in doc["sections"]
        for f in s.get("fields", [])
    )

    r = await db_client.post(f"{TEMPLATES.format(pid=project_id)}/import", json=doc)
    assert r.status_code == 201, r.text
    assert r.json()["data"]["created"] is True


@pytest.mark.asyncio
async def test_import_wrong_kind_is_typed_422(
    db_client: AsyncClient, auth_as_manager: UUID
) -> None:
    del auth_as_manager  # consumed for its dependency-override side effect
    r = await db_client.post(
        f"{TEMPLATES.format(pid=SEED.secondary_project)}/import",
        json={"prumo_template": 1, "kind": "quality_assessment", "name": "x", "sections": []},
    )
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "TEMPLATE_IMPORT_WRONG_KIND"


@pytest.mark.asyncio
async def test_import_invalid_carries_typed_details(
    db_client: AsyncClient, auth_as_manager: UUID
) -> None:
    del auth_as_manager  # consumed for its dependency-override side effect
    r = await db_client.post(
        f"{TEMPLATES.format(pid=SEED.secondary_project)}/import",
        json={
            "prumo_template": 1,
            "kind": "extraction",
            "name": "x",
            "sections": [
                {
                    "name": "sec",
                    "label": "S",
                    "fields": [{"name": "Bad", "label": "B", "type": "text"}],
                }
            ],
        },
    )
    assert r.status_code == 422
    err = r.json()["error"]
    assert err["code"] == "TEMPLATE_IMPORT_INVALID"
    assert err["details"]["errors"][0]["path"] == "sections[0].fields[0].name"


@pytest.mark.asyncio
async def test_export_foreign_project_is_404(
    db_session: AsyncSession, db_client: AsyncClient, auth_as_manager: UUID
) -> None:
    await clean_project_clones(db_session, SEED.secondary_project)
    clone = await clone_charms(db_session, SEED.secondary_project, auth_as_manager)
    r = await db_client.get(
        f"{TEMPLATES.format(pid=SEED.primary_project)}/{clone.project_template_id}/export"
    )
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_delete_active_is_typed_409_and_writes_nothing(
    db_session: AsyncSession, db_client: AsyncClient, auth_as_manager: UUID
) -> None:
    project_id = SEED.secondary_project
    await clean_project_clones(db_session, project_id)
    clone = await clone_charms(db_session, project_id, auth_as_manager)
    r = await db_client.delete(f"{TEMPLATES.format(pid=project_id)}/{clone.project_template_id}")
    assert r.status_code == 409
    assert r.json()["error"]["code"] == "TEMPLATE_ACTIVE"
    r = await db_client.get(
        f"{TEMPLATES.format(pid=project_id)}/{clone.project_template_id}/export"
    )
    assert r.status_code == 200


@pytest.mark.asyncio
async def test_delete_unknown_is_404(db_client: AsyncClient, auth_as_manager: UUID) -> None:
    del auth_as_manager  # consumed for its dependency-override side effect
    r = await db_client.delete(f"{TEMPLATES.format(pid=SEED.secondary_project)}/{uuid4()}")
    assert r.status_code == 404
