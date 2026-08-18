"""B6 — role gate for the llm-endpoints surface through the real ASGI app.

Every route is ``require_project_manager``; the one matrix cell the unit
suite cannot prove (the dependency is resolved by FastAPI, not called in
the handler) is that a plain MEMBER — the seeded reviewer — is refused.
Mirrors ``test_llm_engine_endpoint``'s reviewer-403 pattern.
"""

from __future__ import annotations

import pytest
from httpx import AsyncClient

from tests.integration.conftest import SEED
from tests.integration.helpers import engine_setup

client_as_reviewer = engine_setup.client_as_reviewer


@pytest.mark.asyncio
async def test_member_create_is_403(client_as_reviewer: AsyncClient) -> None:
    r = await client_as_reviewer.post(
        f"/api/v1/projects/{SEED.primary_project}/llm-endpoints",
        json={"label": "Lab Ollama", "base_url": "https://llm.lab.example.com/v1"},
    )
    assert r.status_code == 403
