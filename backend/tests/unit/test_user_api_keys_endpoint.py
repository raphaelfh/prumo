"""Handler tests for /api/v1/user-api-keys PATCH (issues #29, #31, #63).

Mocks ``APIKeyService`` end-to-end so we can verify that:
* the handler now forwards ``key_name`` to ``service.update_key_name``
  (was previously discarded — issues #29 / #63);
* the handler rejects the inconsistent
  ``is_default=True`` + ``is_active=False`` combination with a 400
  rather than silently producing a ghost-default key (issue #31).
"""

from collections.abc import AsyncGenerator
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_db
from app.core.security import TokenPayload, get_current_user
from app.main import app


@pytest_asyncio.fixture
async def client_with_uuid_user() -> AsyncGenerator[tuple[AsyncClient, str], None]:
    """Yield an AsyncClient where the authenticated user has a valid UUID sub.

    Handler relies on ``APIKeyService(user_id=user.sub)`` and that service
    requires a parseable UUID for the user identifier (except when going
    straight to the global-key fallback). The default conftest user has
    ``sub="test-user-id"`` which would fail UUID parsing on first
    repository call.
    """
    user_id = str(uuid4())

    async def override_get_db() -> AsyncGenerator[AsyncSession, None]:
        yield AsyncMock(spec=AsyncSession)

    async def override_get_current_user() -> TokenPayload:
        return TokenPayload(
            sub=user_id,
            email="user@example.com",
            role="authenticated",
            aal="aal1",
        )

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_current_user] = override_get_current_user

    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as ac:
        yield ac, user_id

    app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_patch_forwards_key_name_to_service(
    client_with_uuid_user: tuple[AsyncClient, str],
) -> None:
    """Issue #29 / #63: keyName must reach `service.update_key_name`."""
    ac, _ = client_with_uuid_user
    key_id = str(uuid4())

    mock_service = MagicMock()
    mock_service.update_key_name = AsyncMock(return_value=True)
    mock_service.set_default = AsyncMock(return_value=True)
    mock_service.deactivate_key = AsyncMock(return_value=True)

    with patch("app.api.v1.endpoints.user_api_keys.APIKeyService", return_value=mock_service):
        res = await ac.patch(
            f"/api/v1/user-api-keys/{key_id}",
            json={"keyName": "Production key"},
        )

    assert res.status_code == 200, res.text
    mock_service.update_key_name.assert_awaited_once()
    args, _kwargs = mock_service.update_key_name.call_args
    # call signature: (key_id, key_name)
    assert str(args[0]) == key_id
    assert args[1] == "Production key"


@pytest.mark.asyncio
async def test_patch_rejects_default_plus_inactive_combo(
    client_with_uuid_user: tuple[AsyncClient, str],
) -> None:
    """Issue #31: is_default=True + is_active=False must 400 — a default
    inactive key is invisible to the resolver but blocks future updates."""
    ac, _ = client_with_uuid_user
    key_id = str(uuid4())

    mock_service = MagicMock()
    mock_service.update_key_name = AsyncMock(return_value=True)
    mock_service.set_default = AsyncMock(return_value=True)
    mock_service.deactivate_key = AsyncMock(return_value=True)

    with patch("app.api.v1.endpoints.user_api_keys.APIKeyService", return_value=mock_service):
        res = await ac.patch(
            f"/api/v1/user-api-keys/{key_id}",
            json={"isDefault": True, "isActive": False},
        )

    assert res.status_code == 400
    # And neither side-effect happened.
    mock_service.set_default.assert_not_called()
    mock_service.deactivate_key.assert_not_called()


@pytest.mark.asyncio
async def test_patch_returns_404_when_key_name_target_missing(
    client_with_uuid_user: tuple[AsyncClient, str],
) -> None:
    """Issue #29: an unknown key_id during a rename must still 404."""
    ac, _ = client_with_uuid_user
    key_id = str(uuid4())

    mock_service = MagicMock()
    mock_service.update_key_name = AsyncMock(return_value=False)
    mock_service.set_default = AsyncMock(return_value=True)
    mock_service.deactivate_key = AsyncMock(return_value=True)

    with patch("app.api.v1.endpoints.user_api_keys.APIKeyService", return_value=mock_service):
        res = await ac.patch(
            f"/api/v1/user-api-keys/{key_id}",
            json={"keyName": "Renamed"},
        )

    assert res.status_code == 404
