"""Handler tests for /api/v1/projects/{id}/extraction-export status route.

Locks in the ownership gate on ``get_extraction_export_status`` — every
state branch in the handler returns task metadata (and FAILURE leaks the
exception repr), so a caller who guesses a valid ``job_id`` could
enumerate or read another user's export. The gate must fire before any
state-dependent return.
"""

from collections.abc import AsyncGenerator
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_db, get_supabase
from app.core.security import TokenPayload, get_current_user
from app.main import app

CALLER_USER_ID = str(uuid4())
OTHER_USER_ID = str(uuid4())


@pytest_asyncio.fixture
async def client() -> AsyncGenerator[AsyncClient, None]:
    async def override_get_db() -> AsyncGenerator[AsyncSession, None]:
        yield AsyncMock(spec=AsyncSession)

    async def override_get_current_user() -> TokenPayload:
        return TokenPayload(
            sub=CALLER_USER_ID,
            email="caller@example.com",
            role="authenticated",
            aal="aal1",
        )

    def override_get_supabase() -> MagicMock:
        return MagicMock()

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_current_user] = override_get_current_user
    app.dependency_overrides[get_supabase] = override_get_supabase

    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as ac:
        yield ac

    app.dependency_overrides.clear()


def _status_url(project_id: str, job_id: str) -> str:
    return f"/api/v1/projects/{project_id}/extraction-export/status/{job_id}"


@pytest.mark.asyncio
async def test_status_unknown_job_returns_not_found(
    client: AsyncClient,
) -> None:
    """No Redis owner record and no Celery result → 404 envelope."""
    project_id = str(uuid4())
    job_id = str(uuid4())

    mock_result = MagicMock()
    mock_result.state = "PENDING"
    mock_result.result = None

    with (
        patch("celery.result.AsyncResult", return_value=mock_result),
        patch(
            "app.api.v1.endpoints.extraction_export._lookup_export_owner",
            return_value=None,
        ),
    ):
        res = await client.get(_status_url(project_id, job_id))

    assert res.status_code == 200, res.text
    body = res.json()
    assert body["ok"] is False
    assert body["error"]["code"] == "NOT_FOUND"


@pytest.mark.asyncio
async def test_status_other_users_pending_job_returns_forbidden(
    client: AsyncClient,
) -> None:
    """BOLA regression: a PENDING job owned by a different user must not
    leak its state to the caller. Without the ownership gate, the
    handler returned 'pending' to anyone who guessed the id."""
    project_id = str(uuid4())
    job_id = str(uuid4())

    mock_result = MagicMock()
    mock_result.state = "PENDING"
    mock_result.result = None

    with (
        patch("celery.result.AsyncResult", return_value=mock_result),
        patch(
            "app.api.v1.endpoints.extraction_export._lookup_export_owner",
            return_value=OTHER_USER_ID,
        ),
    ):
        res = await client.get(_status_url(project_id, job_id))

    assert res.status_code == 200, res.text
    body = res.json()
    assert body["ok"] is False
    assert body["error"]["code"] == "FORBIDDEN"


@pytest.mark.asyncio
async def test_status_other_users_failed_job_does_not_leak_error(
    client: AsyncClient,
) -> None:
    """BOLA regression: the FAILURE branch returns ``str(result.result)``
    which would expose another user's exception repr. The gate must
    fire before the state branch."""
    project_id = str(uuid4())
    job_id = str(uuid4())

    mock_result = MagicMock()
    mock_result.state = "FAILURE"
    mock_result.result = RuntimeError("internal/path/should/not/leak: db row 42")

    with (
        patch("celery.result.AsyncResult", return_value=mock_result),
        patch(
            "app.api.v1.endpoints.extraction_export._lookup_export_owner",
            return_value=OTHER_USER_ID,
        ),
    ):
        res = await client.get(_status_url(project_id, job_id))

    assert res.status_code == 200, res.text
    body = res.json()
    assert body["ok"] is False
    assert body["error"]["code"] == "FORBIDDEN"
    assert "internal/path/should/not/leak" not in res.text


@pytest.mark.asyncio
async def test_status_own_pending_job_returns_pending(
    client: AsyncClient,
) -> None:
    """Sanity: ownership match + PENDING state still reports ``pending``."""
    project_id = str(uuid4())
    job_id = str(uuid4())

    mock_result = MagicMock()
    mock_result.state = "PENDING"
    mock_result.result = None

    with (
        patch("celery.result.AsyncResult", return_value=mock_result),
        patch(
            "app.api.v1.endpoints.extraction_export._lookup_export_owner",
            return_value=CALLER_USER_ID,
        ),
    ):
        res = await client.get(_status_url(project_id, job_id))

    assert res.status_code == 200, res.text
    body = res.json()
    assert body["ok"] is True
    assert body["data"]["status"] == "pending"


@pytest.mark.asyncio
async def test_status_own_success_job_returns_completed_with_url(
    client: AsyncClient,
) -> None:
    """Sanity: SUCCESS path still returns the download_url + expires_at.
    Also covers the TTL-expired-but-result-cached fallback by leaving
    the Redis owner record empty and relying on ``result.result.user_id``.
    """
    project_id = str(uuid4())
    job_id = str(uuid4())
    download_url = "https://example.supabase.co/sign/xlsx?sig=abc"
    expires_at = "2026-05-24T05:00:00+00:00"

    mock_result = MagicMock()
    mock_result.state = "SUCCESS"
    mock_result.result = {
        "user_id": CALLER_USER_ID,
        "download_url": download_url,
        "expires_at": expires_at,
    }

    with (
        patch("celery.result.AsyncResult", return_value=mock_result),
        patch(
            "app.api.v1.endpoints.extraction_export._lookup_export_owner",
            return_value=None,
        ),
    ):
        res = await client.get(_status_url(project_id, job_id))

    assert res.status_code == 200, res.text
    body = res.json()
    assert body["ok"] is True
    assert body["data"]["status"] == "completed"
    assert body["data"]["download_url"] == download_url
    assert body["data"]["expires_at"] == expires_at
