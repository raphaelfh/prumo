"""Handler tests for /api/v1/articles-export (issues #30 and #60).

These focus narrowly on the two behaviours under repair:
* the sync path surfaces ``X-Skipped-Files`` when the service reports
  any skipped files (was silently dropped before — issue #30);
* GET /status/{job_id} returns ``NOT_FOUND`` for an unknown job id
  instead of forever spinning in "pending" (was dead code — issue #60).
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


@pytest_asyncio.fixture
async def client() -> AsyncGenerator[AsyncClient, None]:
    async def override_get_db() -> AsyncGenerator[AsyncSession, None]:
        yield AsyncMock(spec=AsyncSession)

    async def override_get_current_user() -> TokenPayload:
        return TokenPayload(
            sub=str(uuid4()),
            email="user@example.com",
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


@pytest.mark.asyncio
async def test_sync_export_surfaces_skipped_files_header(
    client: AsyncClient,
) -> None:
    """Issue #30: when the sync path returns skipped files the response
    must expose them — historically the list was bound and discarded."""
    project_id = str(uuid4())
    article_id = str(uuid4())

    mock_article = MagicMock()
    mock_article.id = article_id

    # Mock the service: report 1 skipped file alongside a stub CSV.
    mock_service = MagicMock()
    mock_service.get_articles_for_export = AsyncMock(return_value=[mock_article])
    mock_service.run_export = AsyncMock(
        return_value=(
            b"id,title\n",
            "text/csv",
            "articles_export.csv",
            [
                {
                    "article_id": article_id,
                    "storage_key": "x/y.pdf",
                    "reason": "storage 404",
                }
            ],
        )
    )

    # Mock the membership check used inside the endpoint.
    mock_uow = MagicMock()
    mock_uow.__aenter__ = AsyncMock(return_value=mock_uow)
    mock_uow.__aexit__ = AsyncMock(return_value=None)
    mock_uow.project_members.is_member = AsyncMock(return_value=True)

    with (
        patch(
            "app.api.v1.endpoints.articles_export.ArticlesExportService",
            return_value=mock_service,
        ),
        patch(
            "app.api.v1.endpoints.articles_export.UnitOfWork",
            return_value=mock_uow,
        ),
        patch(
            "app.api.v1.endpoints.articles_export.create_storage_adapter",
            return_value=MagicMock(),
        ),
    ):
        res = await client.post(
            "/api/v1/articles-export",
            json={
                "project_id": project_id,
                "article_ids": [article_id],
                "formats": ["csv"],
                "file_scope": "none",
            },
        )

    assert res.status_code == 200, res.text
    assert res.headers.get("X-Skipped-Files") == "1"


@pytest.mark.asyncio
async def test_status_returns_not_found_for_unknown_job(
    client: AsyncClient,
) -> None:
    """Issue #60: a job id that was never enqueued must 404 (it used to
    spin in 'pending' forever because the guard checked the wrong field)."""
    unknown_job_id = str(uuid4())

    mock_result = MagicMock()
    mock_result.state = "PENDING"
    mock_result.backend = MagicMock()  # always truthy in real Celery, hence dead guard

    with (
        patch(
            "celery.result.AsyncResult",
            return_value=mock_result,
        ),
        patch(
            "app.api.v1.endpoints.articles_export._lookup_export_owner",
            return_value=None,
        ),
    ):
        res = await client.get(f"/api/v1/articles-export/status/{unknown_job_id}")

    assert res.status_code == 200, res.text
    body = res.json()
    assert body["ok"] is False
    assert body["error"]["code"] == "NOT_FOUND"


@pytest.mark.asyncio
async def test_status_pending_for_known_job(
    client: AsyncClient,
) -> None:
    """Counterpart to the NOT_FOUND fix: a PENDING task with a known
    owner record must still report 'pending', not 'not_found'."""
    known_job_id = str(uuid4())

    mock_result = MagicMock()
    mock_result.state = "PENDING"
    mock_result.backend = MagicMock()

    with (
        patch(
            "celery.result.AsyncResult",
            return_value=mock_result,
        ),
        patch(
            "app.api.v1.endpoints.articles_export._lookup_export_owner",
            return_value="owner-uuid",
        ),
    ):
        res = await client.get(f"/api/v1/articles-export/status/{known_job_id}")

    assert res.status_code == 200, res.text
    body = res.json()
    assert body["ok"] is True
    assert body["data"]["status"] == "pending"
