"""§4 project scope through the real ASGI app: manager-gated CRUD, the
project-scoped WHERE guard (a row of another project is a 404), hosted
providers only, ``llama_cloud`` offered at project scope (§5 shared keys
cover parsing)."""

from __future__ import annotations

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from tests.integration.conftest import SEED
from tests.integration.helpers import engine_setup

client_as_manager = engine_setup.client_as_manager
client_as_reviewer = engine_setup.client_as_reviewer


def _base(project_id: object = SEED.primary_project) -> str:
    return f"/api/v1/projects/{project_id}/connections"


@pytest.mark.asyncio
async def test_member_and_outsider_are_403(
    client_as_reviewer: AsyncClient, db_session: AsyncSession
) -> None:
    """The outsider client is built INSIDE the test: ``client_as``
    installs the auth override globally, so two client fixtures in one
    signature would both authenticate as whichever was set up last and
    the guard would never be exercised."""
    body = {"provider": "openai", "label": "shared", "api_key": "sk-shared"}
    assert (await client_as_reviewer.get(_base())).status_code == 403
    assert (await client_as_reviewer.post(_base(), json=body)).status_code == 403
    outsider = engine_setup.client_as(str(SEED.outsider_profile), db_session)
    assert (await outsider.get(_base())).status_code == 403
    assert (await outsider.post(_base(), json=body)).status_code == 403


@pytest.mark.asyncio
async def test_reviewer_is_403_on_every_write_verb(
    client_as_manager: AsyncClient, db_session: AsyncSession
) -> None:
    """A manager-created row exists; the reviewer client (built INSIDE the
    test, same reasoning as ``test_member_and_outsider_are_403``) is
    refused on PUT/DELETE/verify. Reads/403s only — never a write past
    this guard, so no handler rollback is exercised here."""
    created = await client_as_manager.post(
        _base(), json={"provider": "openai", "label": "shared", "api_key": "sk-shared"}
    )
    assert created.status_code == 201, created.text
    row_id = created.json()["data"]["id"]
    reviewer = engine_setup.client_as(str(SEED.reviewer_profile), db_session)
    assert (await reviewer.put(f"{_base()}/{row_id}", json={"label": "x"})).status_code == 403
    assert (await reviewer.post(f"{_base()}/{row_id}/verify")).status_code == 403
    assert (await reviewer.delete(f"{_base()}/{row_id}")).status_code == 403


@pytest.mark.asyncio
async def test_manager_crud_and_llama_cloud_is_offered(client_as_manager: AsyncClient) -> None:
    created = await client_as_manager.post(
        _base(), json={"provider": "llama_cloud", "label": "parsing", "api_key": "lc-shared"}
    )
    assert created.status_code == 201, created.text
    row = created.json()["data"]
    assert row["scope"] == "project"
    assert row["has_api_key"] is True and "lc-shared" not in created.text
    listed = await client_as_manager.get(_base())
    assert [r["id"] for r in listed.json()["data"]] == [row["id"]]
    renamed = await client_as_manager.put(f"{_base()}/{row['id']}", json={"label": "renamed"})
    assert renamed.status_code == 200 and renamed.json()["data"]["label"] == "renamed"
    deleted = await client_as_manager.delete(f"{_base()}/{row['id']}")
    assert deleted.status_code == 200
    assert deleted.json()["data"] == {"deleted": True, "id": row["id"]}


@pytest.mark.asyncio
async def test_host_bearing_provider_is_422_at_project_scope(
    client_as_manager: AsyncClient,
) -> None:
    r = await client_as_manager.post(
        _base(),
        json={
            "provider": "openai_compatible",
            "label": "lab",
            "base_url": "https://8.8.8.8/v1",
            "api_key": "k-secret",
        },
    )
    assert r.status_code == 422, r.text
    assert "k-secret" not in r.text


@pytest.mark.asyncio
async def test_row_of_another_project_is_404(client_as_manager: AsyncClient) -> None:
    row = (
        await client_as_manager.post(
            _base(), json={"provider": "openai", "label": "s", "api_key": "sk"}
        )
    ).json()["data"]
    # The manager also manages the secondary project (seed graph); the row is not there.
    other = _base(SEED.secondary_project)
    assert (
        await client_as_manager.put(f"{other}/{row['id']}", json={"label": "x"})
    ).status_code == 404
    assert (await client_as_manager.post(f"{other}/{row['id']}/verify")).status_code == 404
    assert (await client_as_manager.delete(f"{other}/{row['id']}")).status_code == 404
