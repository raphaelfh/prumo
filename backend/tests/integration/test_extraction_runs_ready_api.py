"""API tests for POST /v1/runs/{run_id}/ready + the N/M ready hint on /view (Phase 2)."""

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


def _auth_as(profile_id: UUID) -> None:
    async def override() -> TokenPayload:
        return TokenPayload(
            sub=str(profile_id),
            email="test@example.com",
            role="authenticated",
            aal="aal1",
        )

    app.dependency_overrides[get_current_user] = override


@pytest_asyncio.fixture
async def auth_as_manager(db_session: AsyncSession) -> AsyncGenerator[UUID, None]:
    del db_session  # ordering: the seed runs first
    _auth_as(SEED.primary_profile)
    yield SEED.primary_profile


async def _seeded(db: AsyncSession) -> bool:
    return (
        await db.execute(
            text("SELECT 1 FROM public.profiles WHERE id = :id"),
            {"id": str(SEED.primary_profile)},
        )
    ).scalar() is not None


async def _create_run(client: AsyncClient) -> str:
    res = await client.post(
        "/api/v1/runs",
        json={
            "project_id": str(SEED.primary_project),
            "article_id": str(SEED.primary_article),
            "project_template_id": str(SEED.primary_template),
        },
    )
    assert res.status_code == 201, res.text
    return res.json()["data"]["id"]


@pytest.mark.asyncio
async def test_mark_ready_idempotent_toggle_and_view(
    db_client: AsyncClient,
    db_session: AsyncSession,
    auth_as_manager: UUID,
) -> None:
    if not await _seeded(db_session):
        pytest.skip("Missing fixtures.")
    run_id = await _create_run(db_client)

    # Mark ready.
    res = await db_client.post(f"/api/v1/runs/{run_id}/ready", json={"ready": True})
    assert res.status_code == 200, res.text
    data = res.json()["data"]
    assert data["ready_count"] == 1
    assert data["reviewers_ready"] == [str(auth_as_manager)]
    assert data["reviewer_count"] >= 1

    # Idempotent re-mark.
    res = await db_client.post(f"/api/v1/runs/{run_id}/ready", json={"ready": True})
    assert res.json()["data"]["ready_count"] == 1

    # The /view payload reflects the hint.
    view = await db_client.get(f"/api/v1/runs/{run_id}/view")
    assert view.status_code == 200, view.text
    vdata = view.json()["data"]
    assert vdata["ready_count"] == 1
    assert vdata["reviewers_ready"] == [str(auth_as_manager)]
    assert vdata["reviewer_count"] >= 1

    # Un-mark clears it.
    res = await db_client.post(f"/api/v1/runs/{run_id}/ready", json={"ready": False})
    assert res.status_code == 200
    assert res.json()["data"]["ready_count"] == 0
    assert res.json()["data"]["reviewers_ready"] == []


@pytest.mark.asyncio
async def test_mark_ready_admits_non_manager_reviewer(
    db_client: AsyncClient,
    db_session: AsyncSession,
    auth_as_manager: UUID,  # noqa: ARG001
) -> None:
    """The gate admits any reviewer-capable role, not just managers."""
    if not await _seeded(db_session):
        pytest.skip("Missing fixtures.")
    run_id = await _create_run(db_client)  # created by the manager

    _auth_as(SEED.reviewer_profile)  # a project reviewer
    res = await db_client.post(f"/api/v1/runs/{run_id}/ready", json={"ready": True})
    assert res.status_code == 200, res.text
    assert str(SEED.reviewer_profile) in res.json()["data"]["reviewers_ready"]


@pytest.mark.asyncio
async def test_mark_ready_rejects_non_member(
    db_client: AsyncClient,
    db_session: AsyncSession,
    auth_as_manager: UUID,  # noqa: ARG001
) -> None:
    if not await _seeded(db_session):
        pytest.skip("Missing fixtures.")
    run_id = await _create_run(db_client)

    _auth_as(SEED.outsider_profile)  # no membership
    res = await db_client.post(f"/api/v1/runs/{run_id}/ready", json={"ready": True})
    assert res.status_code == 403
    assert "access denied" in res.json()["error"]["message"].lower()


@pytest.mark.asyncio
async def test_mark_ready_rejects_viewer_member(
    db_client: AsyncClient,
    db_session: AsyncSession,
    auth_as_manager: UUID,  # noqa: ARG001
) -> None:
    """A project member with the read-only viewer role is rejected by the
    reviewer-role gate (distinct from the membership gate)."""
    if not await _seeded(db_session):
        pytest.skip("Missing fixtures.")
    run_id = await _create_run(db_client)

    # Make the outsider a VIEWER member of the project (shared session → visible
    # to the API request; rolled back at fixture teardown).
    await db_session.execute(
        text(
            "INSERT INTO public.project_members (project_id, user_id, role) "
            "VALUES (:pid, :uid, 'viewer')"
        ),
        {"pid": str(SEED.primary_project), "uid": str(SEED.outsider_profile)},
    )
    await db_session.flush()

    _auth_as(SEED.outsider_profile)
    res = await db_client.post(f"/api/v1/runs/{run_id}/ready", json={"ready": True})
    assert res.status_code == 403
    assert "reviewer role required" in res.json()["error"]["message"].lower()
