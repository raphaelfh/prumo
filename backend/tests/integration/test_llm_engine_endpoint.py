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
async def test_put_verified_mode_round_trips(client_as_manager: AsyncClient) -> None:
    """Verified shipped: the PUT persists ``mode: "verified"`` and the GET
    reflects it (the C1b 422 flipped with the §5 verify pass)."""
    r = await client_as_manager.put(
        _url(), json={"provider": "openai", "model": "gpt-4o", "mode": "verified"}
    )
    assert r.status_code == 200, r.text
    assert r.json()["data"]["mode"] == "verified"

    r2 = await client_as_manager.get(_url())
    assert r2.status_code == 200
    data = r2.json()["data"]
    assert data["mode"] == "verified"
    assert data["source"] == "project"


@pytest.mark.asyncio
async def test_put_unknown_mode_is_422(client_as_manager: AsyncClient) -> None:
    r = await client_as_manager.put(
        _url(), json={"provider": "openai", "model": "gpt-4o", "mode": "turbo"}
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
            """'{"provider": "openai", "model": "gpt-4o", "mode": "turbo"}'::jsonb) """
            "WHERE id = :pid"
        ),
        {"pid": str(SEED.primary_project)},
    )
    r = await client_as_manager.get(_url())
    assert r.status_code == 200, r.text
    data = r.json()["data"]
    assert data["mode"] == "fast"
    assert (data["provider"], data["model"]) == ("openai", "gpt-4o")
    assert data["source"] == "project"


@pytest.mark.asyncio
async def test_put_smuggled_key_is_422(client_as_manager: AsyncClient) -> None:
    r = await client_as_manager.put(
        _url(), json={"provider": "openai", "model": "gpt-4o", "temperature": 0}
    )
    assert r.status_code == 422
