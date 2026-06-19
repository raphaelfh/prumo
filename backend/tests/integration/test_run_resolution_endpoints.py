"""Integration tests for article-scoped run-resolution endpoints.

Tests three endpoints:
  GET /api/v1/articles/{article_id}/active-run?template_id=...
  GET /api/v1/articles/{article_id}/finalized-run?template_id=...
  POST /api/v1/articles/form-runs  body: {article_ids, template_id, project_id}

TDD: written RED first, then made GREEN by the implementation.

Pattern mirrors test_run_view_endpoint.py:
- db_client / db_session fixtures from conftest
- auth_as_profile / outsider_user for BOLA tests
- _create_run_via_api for seeding runs
"""

from __future__ import annotations

from collections.abc import AsyncGenerator
from typing import Any
from uuid import UUID

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import TokenPayload, get_current_user
from app.main import app
from tests.integration.conftest import SEED

_RUNS_URL = "/api/v1/runs"
_ARTICLES_URL = "/api/v1/articles"


# =================== FIXTURES ===================


@pytest_asyncio.fixture
async def auth_as_profile(
    db_session: AsyncSession,
) -> AsyncGenerator[UUID, None]:
    """Pin JWT sub to SEED.primary_profile (manager of primary_project)."""
    del db_session  # fixture ordering: seed runs first
    profile_id = SEED.primary_profile

    async def override_get_current_user() -> TokenPayload:
        return TokenPayload(
            sub=str(profile_id),
            email="primary@integration-test.prumo.local",
            role="authenticated",
            aal="aal1",
        )

    app.dependency_overrides[get_current_user] = override_get_current_user
    try:
        yield profile_id
    finally:
        app.dependency_overrides.pop(get_current_user, None)


@pytest_asyncio.fixture
async def outsider_user(
    db_session: AsyncSession,
) -> AsyncGenerator[UUID, None]:
    """Create a fresh profile that has no project membership (BOLA test)."""
    import uuid as _uuid_mod

    outsider_id = _uuid_mod.uuid4()
    email = f"outsider-resolution-{outsider_id}@run-resolution-test.local"

    await db_session.execute(
        text(
            "INSERT INTO auth.users (id, email, instance_id, aud, role) "
            "VALUES (:id, :email, '00000000-0000-0000-0000-000000000000', "
            "'authenticated', 'authenticated')"
        ),
        {"id": str(outsider_id), "email": email},
    )
    await db_session.commit()

    profile_id = (
        await db_session.execute(
            text("SELECT id FROM public.profiles WHERE id = :id"),
            {"id": str(outsider_id)},
        )
    ).scalar()
    if profile_id is None:
        await db_session.execute(
            text("INSERT INTO public.profiles (id, full_name) VALUES (:id, 'Outsider Resolution')"),
            {"id": str(outsider_id)},
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
        app.dependency_overrides.pop(get_current_user, None)


# =================== HELPERS ===================


async def _create_extraction_run(client: AsyncClient) -> dict[str, Any]:
    """Create a new extraction run via POST /api/v1/runs."""
    body = {
        "project_id": str(SEED.primary_project),
        "article_id": str(SEED.primary_article),
        "project_template_id": str(SEED.primary_template),
    }
    resp = await client.post(_RUNS_URL, json=body)
    assert resp.status_code == 201, resp.text
    payload = resp.json()
    assert payload["ok"] is True
    return payload["data"]


async def _force_finalize_run(db: AsyncSession, run_id: str) -> None:
    """Directly set a run to finalized stage (bypasses business rules)."""
    await db.execute(
        text(
            "UPDATE public.extraction_runs SET stage='finalized', status='completed' WHERE id=:id"
        ),
        {"id": run_id},
    )
    await db.commit()


# =================== TESTS ===================


@pytest.mark.asyncio
async def test_active_run_returns_200_with_run_id(
    db_client: AsyncClient,
    db_session: AsyncSession,  # noqa: ARG001 — seed ordering
    auth_as_profile: UUID,  # noqa: ARG001
) -> None:
    """Happy path: a member gets 200 with the active run's id."""
    created = await _create_extraction_run(db_client)
    run_id = created["id"]
    article_id = str(SEED.primary_article)

    resp = await db_client.get(f"{_ARTICLES_URL}/{article_id}/active-run")
    assert resp.status_code == 200, resp.text

    payload = resp.json()
    assert payload["ok"] is True
    data = payload["data"]
    assert data is not None
    assert data["id"] == run_id


@pytest.mark.asyncio
async def test_active_run_with_template_id_filter(
    db_client: AsyncClient,
    db_session: AsyncSession,  # noqa: ARG001
    auth_as_profile: UUID,  # noqa: ARG001
) -> None:
    """active-run with correct template_id still returns the run."""
    created = await _create_extraction_run(db_client)
    run_id = created["id"]
    article_id = str(SEED.primary_article)
    template_id = str(SEED.primary_template)

    resp = await db_client.get(
        f"{_ARTICLES_URL}/{article_id}/active-run",
        params={"template_id": template_id},
    )
    assert resp.status_code == 200, resp.text
    payload = resp.json()
    assert payload["ok"] is True
    assert payload["data"]["id"] == run_id


@pytest.mark.asyncio
async def test_active_run_returns_null_when_finalized(
    db_client: AsyncClient,
    db_session: AsyncSession,
    auth_as_profile: UUID,  # noqa: ARG001
) -> None:
    """active-run returns null when the only run for that article is finalized."""
    created = await _create_extraction_run(db_client)
    run_id = created["id"]
    await _force_finalize_run(db_session, run_id)

    article_id = str(SEED.primary_article)
    resp = await db_client.get(f"{_ARTICLES_URL}/{article_id}/active-run")
    assert resp.status_code == 200, resp.text
    payload = resp.json()
    assert payload["ok"] is True
    assert payload["data"] is None


@pytest.mark.asyncio
async def test_finalized_run_returns_null_when_no_finalized_run(
    db_client: AsyncClient,
    db_session: AsyncSession,  # noqa: ARG001
    auth_as_profile: UUID,  # noqa: ARG001
) -> None:
    """finalized-run returns null when the only run for the article is active."""
    await _create_extraction_run(db_client)
    article_id = str(SEED.primary_article)

    resp = await db_client.get(f"{_ARTICLES_URL}/{article_id}/finalized-run")
    assert resp.status_code == 200, resp.text
    payload = resp.json()
    assert payload["ok"] is True
    assert payload["data"] is None


@pytest.mark.asyncio
async def test_finalized_run_returns_run_when_finalized(
    db_client: AsyncClient,
    db_session: AsyncSession,
    auth_as_profile: UUID,  # noqa: ARG001
) -> None:
    """finalized-run returns the run id once it reaches finalized stage."""
    created = await _create_extraction_run(db_client)
    run_id = created["id"]
    await _force_finalize_run(db_session, run_id)

    article_id = str(SEED.primary_article)
    resp = await db_client.get(f"{_ARTICLES_URL}/{article_id}/finalized-run")
    assert resp.status_code == 200, resp.text
    payload = resp.json()
    assert payload["ok"] is True
    assert payload["data"] is not None
    assert payload["data"]["id"] == run_id


@pytest.mark.asyncio
async def test_active_run_returns_403_for_non_member(
    db_client: AsyncClient,
    db_session: AsyncSession,  # noqa: ARG001
    outsider_user: UUID,  # noqa: ARG001
) -> None:
    """BOLA gate: non-member gets 403 on active-run."""
    # Seed an article owned by primary_project (outsider is not a member)
    article_id = str(SEED.primary_article)
    resp = await db_client.get(f"{_ARTICLES_URL}/{article_id}/active-run")
    assert resp.status_code == 403, resp.text


@pytest.mark.asyncio
async def test_finalized_run_returns_403_for_non_member(
    db_client: AsyncClient,
    db_session: AsyncSession,  # noqa: ARG001
    outsider_user: UUID,  # noqa: ARG001
) -> None:
    """BOLA gate: non-member gets 403 on finalized-run."""
    article_id = str(SEED.primary_article)
    resp = await db_client.get(f"{_ARTICLES_URL}/{article_id}/finalized-run")
    assert resp.status_code == 403, resp.text


@pytest.mark.asyncio
async def test_form_runs_returns_article_run_refs(
    db_client: AsyncClient,
    db_session: AsyncSession,  # noqa: ARG001
    auth_as_profile: UUID,  # noqa: ARG001
) -> None:
    """POST /form-runs returns one ArticleRunRef per input article."""
    created = await _create_extraction_run(db_client)
    run_id = created["id"]
    article_id = str(SEED.primary_article)

    body = {
        "article_ids": [article_id],
        "template_id": str(SEED.primary_template),
        "project_id": str(SEED.primary_project),
    }
    resp = await db_client.post(f"{_ARTICLES_URL}/form-runs", json=body)
    assert resp.status_code == 200, resp.text

    payload = resp.json()
    assert payload["ok"] is True
    data = payload["data"]
    assert isinstance(data, list)
    assert len(data) == 1
    ref = data[0]
    assert ref["article_id"] == article_id
    assert ref["run_id"] == run_id


@pytest.mark.asyncio
async def test_form_runs_returns_null_run_id_when_no_run(
    db_client: AsyncClient,
    db_session: AsyncSession,  # noqa: ARG001
    auth_as_profile: UUID,  # noqa: ARG001
) -> None:
    """POST /form-runs returns run_id=null when article has no runs."""
    article_id = str(SEED.primary_article)

    body = {
        "article_ids": [article_id],
        "template_id": str(SEED.primary_template),
        "project_id": str(SEED.primary_project),
    }
    resp = await db_client.post(f"{_ARTICLES_URL}/form-runs", json=body)
    assert resp.status_code == 200, resp.text

    payload = resp.json()
    assert payload["ok"] is True
    data = payload["data"]
    assert len(data) == 1
    assert data[0]["article_id"] == article_id
    assert data[0]["run_id"] is None


@pytest.mark.asyncio
async def test_form_runs_returns_403_for_non_member(
    db_client: AsyncClient,
    db_session: AsyncSession,  # noqa: ARG001
    outsider_user: UUID,  # noqa: ARG001
) -> None:
    """BOLA gate: non-member of project gets 403 on /form-runs."""
    body = {
        "article_ids": [str(SEED.primary_article)],
        "template_id": str(SEED.primary_template),
        "project_id": str(SEED.primary_project),
    }
    resp = await db_client.post(f"{_ARTICLES_URL}/form-runs", json=body)
    assert resp.status_code == 403, resp.text
