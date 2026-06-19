"""Integration tests for the manager-review-visibility endpoint.

Covers:
- PUT sets one kind and persists without clobbering the other kind.
- PUT requires manager role (reviewer → 403).
- PUT rejects an invalid kind (422).
"""

from collections.abc import AsyncGenerator

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

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


@pytest_asyncio.fixture
async def client_as_manager(
    db_session: AsyncSession,
) -> AsyncGenerator[AsyncClient, None]:
    """HTTP client whose JWT resolves to SEED.primary_profile (manager)."""

    async def override_get_db() -> AsyncGenerator[AsyncSession, None]:
        yield db_session

    async def override_get_current_user() -> TokenPayload:
        return _make_token(str(SEED.primary_profile))

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_current_user] = override_get_current_user
    try:
        async with AsyncClient(
            transport=ASGITransport(app=app),
            base_url="http://test",
        ) as ac:
            yield ac
    finally:
        app.dependency_overrides.clear()


@pytest_asyncio.fixture
async def client_as_reviewer(
    db_session: AsyncSession,
) -> AsyncGenerator[AsyncClient, None]:
    """HTTP client whose JWT resolves to SEED.reviewer_profile (reviewer, not manager)."""

    async def override_get_db() -> AsyncGenerator[AsyncSession, None]:
        yield db_session

    async def override_get_current_user() -> TokenPayload:
        return _make_token(str(SEED.reviewer_profile))

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_current_user] = override_get_current_user
    try:
        async with AsyncClient(
            transport=ASGITransport(app=app),
            base_url="http://test",
        ) as ac:
            yield ac
    finally:
        app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_put_sets_one_kind_and_persists(client_as_manager: AsyncClient) -> None:
    pid = str(SEED.primary_project)
    r = await client_as_manager.put(
        f"/api/v1/projects/{pid}/manager-review-visibility",
        json={"kind": "extraction", "managers_see_reviewers": True},
    )
    assert r.status_code == 200, r.text
    body = r.json()["data"]
    assert body == {"extraction": True, "quality_assessment": False}

    # Persisted: a SEPARATE request sees it (no in-memory illusion).
    r2 = await client_as_manager.put(
        f"/api/v1/projects/{pid}/manager-review-visibility",
        json={"kind": "quality_assessment", "managers_see_reviewers": True},
    )
    # Setting QA must NOT clobber the extraction value set above.
    assert r2.status_code == 200, r2.text
    assert r2.json()["data"] == {"extraction": True, "quality_assessment": True}


@pytest.mark.asyncio
async def test_put_requires_manager(client_as_reviewer: AsyncClient) -> None:
    pid = str(SEED.primary_project)
    r = await client_as_reviewer.put(
        f"/api/v1/projects/{pid}/manager-review-visibility",
        json={"kind": "extraction", "managers_see_reviewers": True},
    )
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_put_rejects_bad_kind(client_as_manager: AsyncClient) -> None:
    pid = str(SEED.primary_project)
    r = await client_as_manager.put(
        f"/api/v1/projects/{pid}/manager-review-visibility",
        json={"kind": "nonsense", "managers_see_reviewers": True},
    )
    assert r.status_code == 422
