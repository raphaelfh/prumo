"""Integration tests for the llama_cloud provider in APIKeyService.

Verifies:
- ``llama_cloud`` is listed in ``SUPPORTED_PROVIDERS``
- ``save_key`` and ``get_key_for_provider`` work end-to-end (no network call)
"""

from __future__ import annotations

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user_api_key import SUPPORTED_PROVIDERS
from app.services.api_key_service import APIKeyService
from tests.integration.conftest import SEED


def test_llama_cloud_is_a_supported_provider() -> None:
    assert "llama_cloud" in SUPPORTED_PROVIDERS


@pytest.mark.asyncio
async def test_save_and_resolve_llama_cloud_key(db_session_real: AsyncSession) -> None:
    svc = APIKeyService(db_session_real, user_id=SEED.primary_profile)
    await svc.save_key(provider="llama_cloud", api_key="lc-secret", is_default=True, validate=False)
    await db_session_real.flush()
    resolved = await svc.get_key_for_provider("llama_cloud", use_fallback=False)
    assert resolved == "lc-secret"
