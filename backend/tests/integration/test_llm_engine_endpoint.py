"""T3 — integration tests for the llm-engine endpoints (C1b).

Role matrix through the real ASGI app + real Postgres membership rows:
- GET is member-visible (``require_project_scope``): outsider 403,
  reviewer 200.
- PUT is manager-only (``require_project_manager``): reviewer 403,
  manager 200 (with attribution), outsider 403.
- The body contract: unknown model 400, ``verified`` 422 (schema-level),
  smuggled keys 422 (``extra="forbid"``).
"""

from __future__ import annotations

from collections.abc import AsyncGenerator

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.deps import get_db
from app.core.security import TokenPayload, get_current_user
from app.main import app
from tests.integration.conftest import SEED


def _make_token(profile_id: str) -> TokenPayload:
    return TokenPayload(
        sub=profile_id,
        email=f"{profile_id}@integration-test.prumo.local",
        role="authenticated",
        aal="aal1",
    )


def _client_as(profile_id: str, db_session: AsyncSession) -> AsyncClient:
    async def override_get_db() -> AsyncGenerator[AsyncSession, None]:
        yield db_session

    async def override_get_current_user() -> TokenPayload:
        return _make_token(profile_id)

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_current_user] = override_get_current_user
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


@pytest_asyncio.fixture
async def client_as_manager(db_session: AsyncSession) -> AsyncGenerator[AsyncClient, None]:
    try:
        async with _client_as(str(SEED.primary_profile), db_session) as ac:
            yield ac
    finally:
        app.dependency_overrides.clear()


@pytest_asyncio.fixture
async def client_as_reviewer(db_session: AsyncSession) -> AsyncGenerator[AsyncClient, None]:
    try:
        async with _client_as(str(SEED.reviewer_profile), db_session) as ac:
            yield ac
    finally:
        app.dependency_overrides.clear()


@pytest_asyncio.fixture
async def client_as_outsider(db_session: AsyncSession) -> AsyncGenerator[AsyncClient, None]:
    try:
        async with _client_as(str(SEED.outsider_profile), db_session) as ac:
            yield ac
    finally:
        app.dependency_overrides.clear()


def _url() -> str:
    return f"/api/v1/projects/{SEED.primary_project}/llm-engine"


# ---------------------------------------------------------------------------
# GET — member-visible
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_outsider_get_is_403(client_as_outsider: AsyncClient) -> None:
    r = await client_as_outsider.get(_url())
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_member_get_returns_resolved_view(client_as_reviewer: AsyncClient) -> None:
    r = await client_as_reviewer.get(_url())
    assert r.status_code == 200, r.text
    data = r.json()["data"]
    assert data["source"] == "default"
    assert data["provider"] == settings.LLM_PROVIDER
    assert data["model"] == settings.LLM_DEFAULT_MODEL
    assert data["retired"] is False
    # The server-curated roster rides along for the picker.
    pairs = {(e["provider"], e["model"]) for e in data["catalog"]}
    assert ("openai", "gpt-4o-mini") in pairs
    assert ("anthropic", "claude-sonnet-4-5") in pairs
    assert all("canonical" in e and "byok_only" in e for e in data["catalog"])
    # Availability: booleans only — never key ids / metadata.
    availability = data["availability"]
    assert set(availability) == {e["provider"] for e in data["catalog"]}
    assert all(isinstance(v, bool) for v in availability.values())
    # The reviewer has no stored anthropic key and there is no global one.
    assert availability["anthropic"] is False


# ---------------------------------------------------------------------------
# PUT — manager-only
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_outsider_put_is_403(client_as_outsider: AsyncClient) -> None:
    r = await client_as_outsider.put(_url(), json={"provider": "openai", "model": "gpt-4o"})
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_reviewer_put_is_403(client_as_reviewer: AsyncClient) -> None:
    r = await client_as_reviewer.put(_url(), json={"provider": "openai", "model": "gpt-4o"})
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_manager_put_persists_and_attributes(client_as_manager: AsyncClient) -> None:
    r = await client_as_manager.put(_url(), json={"provider": "openai", "model": "gpt-4o"})
    assert r.status_code == 200, r.text
    data = r.json()["data"]
    assert data["source"] == "project"
    assert (data["provider"], data["model"]) == ("openai", "gpt-4o")
    assert data["updated_by_name"] == "Integration Primary"
    assert data["updated_at"] is not None

    # The GET reflects the write (same session — SAVEPOINT-isolated).
    r2 = await client_as_manager.get(_url())
    assert r2.status_code == 200
    assert r2.json()["data"]["model"] == "gpt-4o"


@pytest.mark.asyncio
async def test_manager_put_unknown_model_is_400(client_as_manager: AsyncClient) -> None:
    r = await client_as_manager.put(_url(), json={"provider": "openai", "model": "gpt-999"})
    assert r.status_code == 400


@pytest.mark.asyncio
async def test_put_verified_mode_is_422(client_as_manager: AsyncClient) -> None:
    r = await client_as_manager.put(
        _url(), json={"provider": "openai", "model": "gpt-4o", "mode": "verified"}
    )
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_put_smuggled_key_is_422(client_as_manager: AsyncClient) -> None:
    r = await client_as_manager.put(
        _url(), json={"provider": "openai", "model": "gpt-4o", "temperature": 0}
    )
    assert r.status_code == 422
