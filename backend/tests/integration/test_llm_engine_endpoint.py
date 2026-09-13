"""T3 — integration tests for the llm-engine endpoints (C1b).

Role matrix through the real ASGI app + real Postgres membership rows:
- GET is member-visible (``require_project_scope``): outsider 403,
  reviewer 200.
- PUT is manager-only (``require_project_manager``): reviewer 403,
  manager 200 (with attribution), outsider 403.
- The body contract: unknown model 400, ``verified`` round-trips (the
  Verified-mode write gate), unknown modes 422, smuggled keys 422
  (``extra="forbid"``); a stored unknown mode normalizes to "fast" on
  the read.
"""

from __future__ import annotations

from uuid import uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from tests.integration.conftest import SEED
from tests.integration.helpers import engine_setup

client_as_manager = engine_setup.client_as_manager
client_as_reviewer = engine_setup.client_as_reviewer
client_as_outsider = engine_setup.client_as_outsider


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
    assert data["source"] == "env_default"
    assert data["default"]["source"] == "env_default"
    assert data["default"]["provider"] == settings.LLM_PROVIDER
    assert data["effective"]["model"] == settings.LLM_DEFAULT_MODEL
    assert data["default"]["retired"] is False
    # The server-curated roster rides along for the picker.
    pairs = {(e["provider"], e["model"]) for e in data["catalog"]}
    assert ("openai", "gpt-5.6-luna") in pairs
    assert ("openai", "gpt-4o-mini") in pairs  # kept for existing projects
    assert ("anthropic", "claude-sonnet-5") in pairs
    assert all("canonical" in e for e in data["catalog"])
    assert all("byok_only" not in e for e in data["catalog"])
    # Availability: a scope tag per registry LLM provider — never key material.
    availability = data["availability"]
    assert set(availability) == {"openai", "anthropic", "google", "openai_compatible"}
    # The reviewer has no anthropic credential on any rung of the ladder.
    assert availability["anthropic"] is None


# ---------------------------------------------------------------------------
# PUT — manager-only
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_outsider_put_is_403(client_as_outsider: AsyncClient) -> None:
    r = await client_as_outsider.put(_url(), json={"provider": "openai", "model": "gpt-5.6-terra"})
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_reviewer_put_is_403(client_as_reviewer: AsyncClient) -> None:
    r = await client_as_reviewer.put(_url(), json={"provider": "openai", "model": "gpt-5.6-terra"})
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_manager_put_persists_and_attributes(client_as_manager: AsyncClient) -> None:
    r = await client_as_manager.put(_url(), json={"provider": "openai", "model": "gpt-5.6-terra"})
    assert r.status_code == 200, r.text
    data = r.json()["data"]
    assert data["default"]["source"] == "project"
    assert (data["default"]["provider"], data["default"]["model"]) == ("openai", "gpt-5.6-terra")
    assert data["default"]["updated_by_name"] == "Integration Primary"
    assert data["default"]["updated_at"] is not None

    # The GET reflects the write (same session — SAVEPOINT-isolated).
    r2 = await client_as_manager.get(_url())
    assert r2.status_code == 200
    assert r2.json()["data"]["default"]["model"] == "gpt-5.6-terra"


@pytest.mark.asyncio
async def test_manager_put_unknown_model_is_400(client_as_manager: AsyncClient) -> None:
    r = await client_as_manager.put(_url(), json={"provider": "openai", "model": "gpt-999"})
    assert r.status_code == 400


@pytest.mark.asyncio
async def test_put_verified_mode_round_trips(client_as_manager: AsyncClient) -> None:
    """Verified shipped: the PUT persists ``mode: "verified"`` and the GET
    reflects it (the C1b 422 flipped with the §5 verify pass)."""
    r = await client_as_manager.put(
        _url(), json={"provider": "openai", "model": "gpt-5.6-terra", "mode": "verified"}
    )
    assert r.status_code == 200, r.text
    assert r.json()["data"]["default"]["mode"] == "verified"

    r2 = await client_as_manager.get(_url())
    assert r2.status_code == 200
    data = r2.json()["data"]["default"]
    assert data["mode"] == "verified"
    assert data["source"] == "project"


@pytest.mark.asyncio
async def test_put_unknown_mode_is_422(client_as_manager: AsyncClient) -> None:
    r = await client_as_manager.put(
        _url(), json={"provider": "openai", "model": "gpt-5.6-terra", "mode": "turbo"}
    )
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_get_normalizes_a_stored_unknown_mode_to_fast(
    client_as_manager: AsyncClient,
    db_session: AsyncSession,
) -> None:
    """A hand-written (or future-build) stored mode this build does not know
    must NOT 500 the read or degrade the pair to the env default: the read
    normalizes the mode to "fast" and keeps the stored engine pair."""
    await db_session.execute(
        text(
            "UPDATE public.projects SET settings = "
            "jsonb_set(COALESCE(settings, '{}'::jsonb), '{llm_engine}', "
            """'{"provider": "openai", "model": "gpt-5.6-terra", "mode": "turbo"}'::jsonb) """
            "WHERE id = :pid"
        ),
        {"pid": str(SEED.primary_project)},
    )
    r = await client_as_manager.get(_url())
    assert r.status_code == 200, r.text
    data = r.json()["data"]["default"]
    assert data["mode"] == "fast"
    assert (data["provider"], data["model"]) == ("openai", "gpt-5.6-terra")
    assert data["source"] == "project"


@pytest.mark.asyncio
async def test_put_smuggled_key_is_422(client_as_manager: AsyncClient) -> None:
    r = await client_as_manager.put(
        _url(), json={"provider": "openai", "model": "gpt-5.6-terra", "temperature": 0}
    )
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_put_with_a_connection_id_is_422(client_as_manager: AsyncClient) -> None:
    r = await client_as_manager.put(
        _url(), json={"provider": "openai", "model": "gpt-5.6-terra", "connection_id": str(uuid4())}
    )
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_availability_is_per_caller(
    client_as_manager: AsyncClient, client_as_reviewer: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """§7.5: user > project > global > null, and the map is the CALLER's."""
    monkeypatch.setattr(settings, "OPENAI_API_KEY", "sk-global")
    monkeypatch.setattr(settings, "GOOGLE_API_KEY", None)
    assert (await client_as_reviewer.get(_url())).json()["data"]["availability"][
        "openai"
    ] == "global"
    await client_as_manager.post(
        f"/api/v1/projects/{SEED.primary_project}/connections",
        json={"provider": "openai", "label": "shared", "api_key": "sk-shared"},
    )
    assert (await client_as_reviewer.get(_url())).json()["data"]["availability"][
        "openai"
    ] == "project"
    await client_as_reviewer.post(
        "/api/v1/me/connections", json={"provider": "openai", "label": "mine", "api_key": "sk-mine"}
    )
    body = (await client_as_reviewer.get(_url())).json()["data"]["availability"]
    assert body["openai"] == "user" and body["google"] is None and body["openai_compatible"] is None
    assert (await client_as_manager.get(_url())).json()["data"]["availability"][
        "openai"
    ] == "project"


@pytest.mark.asyncio
async def test_user_row_put_and_delete(
    client_as_reviewer: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "sk-ant")
    r = await client_as_reviewer.put(
        f"{_url()}/me", json={"provider": "anthropic", "model": "claude-haiku-4-5"}
    )
    assert r.status_code == 200, r.text
    data = r.json()["data"]
    assert data["source"] == "user" and data["effective"]["model"] == "claude-haiku-4-5"
    assert data["default"]["source"] == "env_default"
    r = await client_as_reviewer.delete(f"{_url()}/me")
    assert r.status_code == 200 and r.json()["data"] == {"cleared": True}
    assert (await client_as_reviewer.get(_url())).json()["data"]["source"] == "env_default"


@pytest.mark.asyncio
async def test_user_row_put_is_403_while_locked_for_a_member(
    client_as_manager: AsyncClient, client_as_reviewer: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "sk-ant")
    r = await client_as_manager.put(
        _url(),
        json={"provider": "openai", "model": "gpt-5.6-terra", "user_choice_allowed": False},
    )
    assert r.status_code == 200 and r.json()["data"]["default"]["user_choice_allowed"] is False
    r = await client_as_reviewer.put(
        f"{_url()}/me", json={"provider": "anthropic", "model": "claude-haiku-4-5"}
    )
    assert r.status_code == 403 and r.json()["error"]["code"] == "LLM_ENGINE_LOCKED"
    r = await client_as_manager.put(
        f"{_url()}/me", json={"provider": "anthropic", "model": "claude-haiku-4-5"}
    )
    assert r.status_code == 200 and r.json()["data"]["source"] == "user"


@pytest.mark.asyncio
async def test_user_row_put_without_a_credential_is_422(
    client_as_reviewer: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "GOOGLE_API_KEY", None)
    r = await client_as_reviewer.put(
        f"{_url()}/me", json={"provider": "google", "model": "gemini-3.8-flash"}
    )
    assert r.status_code == 422 and r.json()["error"]["code"] == "LLM_ENGINE_NEEDS_KEY"


@pytest.mark.asyncio
async def test_outsider_user_row_put_is_403(client_as_outsider: AsyncClient) -> None:
    r = await client_as_outsider.put(
        f"{_url()}/me", json={"provider": "openai", "model": "gpt-5.6-terra"}
    )
    assert r.status_code == 403
