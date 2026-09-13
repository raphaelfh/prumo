"""§4 user scope through the real ASGI app: any member may manage their own
rows, never another user's; §7.5 providers payload."""

from __future__ import annotations

from uuid import uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.llm.registry import REGISTRY
from tests.integration.conftest import SEED
from tests.integration.helpers import engine_setup

client_as_reviewer = engine_setup.client_as_reviewer

_BASE = "/api/v1/me/connections"
_OPENAI = {"provider": "openai", "label": "mine", "api_key": "sk-user-secret"}


@pytest.mark.asyncio
async def test_create_list_update_delete_own_rows(client_as_reviewer: AsyncClient) -> None:
    created = await client_as_reviewer.post(_BASE, json=_OPENAI)
    assert created.status_code == 201, created.text
    row = created.json()["data"]
    assert row["has_api_key"] is True and "sk-user-secret" not in created.text
    assert (await client_as_reviewer.get(_BASE)).json()["data"][0]["id"] == row["id"]
    updated = await client_as_reviewer.put(f"{_BASE}/{row['id']}", json={"label": "renamed"})
    assert updated.status_code == 200 and updated.json()["data"]["label"] == "renamed"
    deleted = await client_as_reviewer.delete(f"{_BASE}/{row['id']}")
    assert deleted.status_code == 200 and deleted.json()["data"] == {
        "deleted": True,
        "id": row["id"],
    }


@pytest.mark.asyncio
async def test_another_user_cannot_touch_my_row(
    client_as_reviewer: AsyncClient, db_session: AsyncSession
) -> None:
    """The second client is built INSIDE the test on purpose:
    ``client_as`` installs the auth override globally, so two client
    fixtures in one signature would both authenticate as whichever was
    set up last and the guard would never be exercised."""
    row = (await client_as_reviewer.post(_BASE, json=_OPENAI)).json()["data"]
    other = engine_setup.client_as(str(SEED.primary_profile), db_session)
    assert (await other.put(f"{_BASE}/{row['id']}", json={"label": "x"})).status_code == 404
    assert (await other.delete(f"{_BASE}/{row['id']}")).status_code == 404
    assert (await other.post(f"{_BASE}/{row['id']}/verify")).status_code == 404
    assert all(r["id"] != row["id"] for r in (await other.get(_BASE)).json()["data"])


@pytest.mark.asyncio
async def test_duplicate_is_400_and_the_session_survives_it(
    client_as_reviewer: AsyncClient,
) -> None:
    """The duplicate arrives as a post-flush IntegrityError: without a
    rollback in the handler every later request on the same session dies
    with the previous request's error. Nothing is written after the
    rollback on purpose: under the SAVEPOINT fixture a session rollback
    ends the test transaction, so anything committed after it would
    escape into the shared database — the follow-up requests are reads."""
    assert (await client_as_reviewer.post(_BASE, json=_OPENAI)).status_code == 201
    duplicate = await client_as_reviewer.post(_BASE, json=_OPENAI)
    assert duplicate.status_code == 400, duplicate.text
    assert "sk-user-secret" not in duplicate.text
    after = await client_as_reviewer.get(_BASE)
    assert after.status_code == 200, after.text
    missing = await client_as_reviewer.put(f"{_BASE}/{uuid4()}", json={"label": "x"})
    assert missing.status_code == 404, missing.text


@pytest.mark.asyncio
async def test_422_echo_never_carries_the_secret(client_as_reviewer: AsyncClient) -> None:
    r = await client_as_reviewer.post(
        _BASE, json={"provider": "grok", "label": "x", "api_key": "sk-leak"}
    )
    assert r.status_code == 422 and "sk-leak" not in r.text


@pytest.mark.asyncio
async def test_providers_payload_has_exactly_the_spec_fields(
    client_as_reviewer: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", None)
    rows = (await client_as_reviewer.get("/api/v1/me/providers")).json()["data"]
    assert [r["id"] for r in rows] == [s.id for s in REGISTRY]
    assert all(
        set(r)
        == {
            "id",
            "label",
            "description",
            "docs_url",
            "needs_host",
            "key_optional",
            "scopes",
            "global_key_available",
        }
        for r in rows
    )
    by_id = {r["id"]: r for r in rows}
    assert by_id["openai_compatible"]["scopes"] == ["user"] and (
        by_id["openai_compatible"]["key_optional"] is True
    )
    assert by_id["anthropic"]["global_key_available"] is False
    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "sk-ant-global")
    rows = (await client_as_reviewer.get("/api/v1/me/providers")).json()["data"]
    assert {r["id"]: r for r in rows}["anthropic"]["global_key_available"] is True
