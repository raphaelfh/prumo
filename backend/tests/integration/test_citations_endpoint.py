"""API contract tests for `GET /api/v1/articles/{article_id}/citations`.

The endpoint surfaces `extraction_evidence` rows with their JSONB
`position` validated against `PositionV1` so the PDF viewer can render
them without a translation layer. Before these tests it had zero
integration coverage — the read service and endpoint were exercised
only transitively by frontend code, with no gate on the membership
check or the article-not-found path.

Scoped to the failure surfaces that matter:
- 200 + [] for an article with no evidence (the legacy empty-`{}`
  filter is exercised elsewhere; here we lock the "no rows" path)
- 404 for an unknown article id
- 403 for an authenticated user who is not a project member

Auth pattern mirrors `test_extraction_runs_endpoints.py`: the `db_client`
fixture from the root conftest overrides `get_current_user` with a
stub `sub='test-user-id'` that has no profile FK, so we re-override
inside the test to point at a real seed profile.
"""

from __future__ import annotations

import uuid
from collections.abc import AsyncGenerator
from uuid import UUID

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import TokenPayload, get_current_user
from app.main import app
from tests.integration.conftest import SEED


@pytest_asyncio.fixture
async def auth_as_primary_member(
    db_session: AsyncSession,
) -> AsyncGenerator[UUID, None]:
    """Override `get_current_user` so JWT sub matches a real seed profile."""
    del db_session  # fixture-ordering dependency only
    profile_id = SEED.primary_profile

    async def override_get_current_user() -> TokenPayload:
        return TokenPayload(
            sub=str(profile_id),
            email="primary@integration-test.prumo.local",
            role="authenticated",
            aal="aal1",
        )

    app.dependency_overrides[get_current_user] = override_get_current_user
    yield profile_id


@pytest_asyncio.fixture
async def auth_as_outsider(
    db_session: AsyncSession,
) -> AsyncGenerator[UUID, None]:
    """Authenticated user with no project memberships."""
    outsider_id = uuid.uuid4()
    email = f"outsider-{outsider_id}@citations-test.local"

    await db_session.execute(
        text(
            "INSERT INTO auth.users (id, email, instance_id, aud, role) "
            "VALUES (:id, :email, '00000000-0000-0000-0000-000000000000', "
            "'authenticated', 'authenticated')"
        ),
        {"id": str(outsider_id), "email": email},
    )
    await db_session.execute(
        text(
            "INSERT INTO public.profiles (id, email, full_name) "
            "VALUES (:id, :email, 'Citations Outsider') "
            "ON CONFLICT (id) DO NOTHING"
        ),
        {"id": str(outsider_id), "email": email},
    )
    await db_session.commit()

    async def override_get_current_user() -> TokenPayload:
        return TokenPayload(
            sub=str(outsider_id),
            email=email,
            role="authenticated",
            aal="aal1",
        )

    app.dependency_overrides[get_current_user] = override_get_current_user
    try:
        yield outsider_id
    finally:
        await db_session.execute(
            text("DELETE FROM public.profiles WHERE id = :id"),
            {"id": str(outsider_id)},
        )
        await db_session.execute(
            text("DELETE FROM auth.users WHERE id = :id"),
            {"id": str(outsider_id)},
        )
        await db_session.commit()


@pytest.mark.asyncio
async def test_list_citations_returns_empty_for_article_without_evidence(
    db_client: AsyncClient,
    auth_as_primary_member: UUID,
) -> None:
    """An article with zero ExtractionEvidence rows resolves to an empty list."""
    del auth_as_primary_member

    res = await db_client.get(f"/api/v1/articles/{SEED.primary_article}/citations")

    assert res.status_code == 200, res.text
    body = res.json()
    assert body["ok"] is True
    assert body["data"] == []


@pytest.mark.asyncio
async def test_list_citations_returns_404_for_unknown_article(
    db_client: AsyncClient,
    auth_as_primary_member: UUID,
) -> None:
    """Unknown article id surfaces `ArticleNotFoundError` as a 404."""
    del auth_as_primary_member
    unknown_id = uuid.uuid4()

    res = await db_client.get(f"/api/v1/articles/{unknown_id}/citations")

    assert res.status_code == 404, res.text
    assert str(unknown_id) in res.json()["detail"]


@pytest.mark.asyncio
async def test_list_citations_returns_403_for_non_project_member(
    db_client: AsyncClient,
    auth_as_outsider: UUID,
) -> None:
    """Non-members cannot list citations for a project's article."""
    del auth_as_outsider

    res = await db_client.get(f"/api/v1/articles/{SEED.primary_article}/citations")

    assert res.status_code == 403, res.text
