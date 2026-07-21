"""Integration tests for GET /api/v1/articles/{article_id}/content-markdown.

Real-DB coverage of the membership gate (200 member / 403 non-member), the
camelCase wire shape, and the 404 when the article has no parsed MAIN file.

Reuses the auth + BOLA fixtures from test_suggestion_read.py's siblings via a
local copy of the same overrides (the pattern: db_client shares db_session, so
inserts flushed on db_session are visible to the endpoint call).
"""

from __future__ import annotations

import uuid as _uuid_mod
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

_ARTICLES_URL = "/api/v1/articles"


@pytest_asyncio.fixture
async def auth_as_profile(db_session: AsyncSession) -> AsyncGenerator[UUID, None]:
    """Pin JWT sub to SEED.primary_profile (manager of primary_project)."""
    del db_session  # fixture ordering: seed runs first
    profile_id = SEED.primary_profile

    async def _override() -> TokenPayload:
        return TokenPayload(
            sub=str(profile_id),
            email="primary@integration-test.prumo.local",
            role="authenticated",
            aal="aal1",
        )

    app.dependency_overrides[get_current_user] = _override
    try:
        yield profile_id
    finally:
        app.dependency_overrides.pop(get_current_user, None)


@pytest_asyncio.fixture
async def outsider_user(db_session: AsyncSession) -> AsyncGenerator[UUID, None]:
    """A profile with no project membership — for the BOLA test."""
    outsider_id = _uuid_mod.uuid4()
    email = f"outsider-md-{outsider_id}@test.local"
    await db_session.execute(
        text(
            "INSERT INTO auth.users (id, email, instance_id, aud, role) "
            "VALUES (:id, :email, '00000000-0000-0000-0000-000000000000', "
            "'authenticated', 'authenticated')"
        ),
        {"id": str(outsider_id), "email": email},
    )
    # auth.users has a trigger that auto-creates the profile row; upsert to be
    # robust whether or not it fired.
    await db_session.execute(
        text(
            "INSERT INTO public.profiles (id, email) VALUES (:id, :email) "
            "ON CONFLICT (id) DO NOTHING"
        ),
        {"id": str(outsider_id), "email": email},
    )
    await db_session.flush()

    async def _override() -> TokenPayload:
        return TokenPayload(sub=str(outsider_id), email=email, role="authenticated", aal="aal1")

    app.dependency_overrides[get_current_user] = _override
    try:
        yield outsider_id
    finally:
        app.dependency_overrides.pop(get_current_user, None)


async def _insert_main_file(db: AsyncSession, *, content_markdown: str | None) -> UUID:
    file_id = _uuid_mod.uuid4()
    await db.execute(
        text(
            "INSERT INTO public.article_files "
            "(id, project_id, article_id, file_type, storage_key, file_role, "
            " original_filename, content_markdown) "
            "VALUES (:id, :pid, :aid, 'pdf', :key, 'MAIN', :name, :md)"
        ),
        {
            "id": str(file_id),
            "pid": str(SEED.primary_project),
            "aid": str(SEED.primary_article),
            "key": f"articles/{file_id}.pdf",
            "name": "teste3.pdf",
            "md": content_markdown,
        },
    )
    await db.flush()
    return file_id


@pytest.mark.asyncio
async def test_content_markdown_endpoint_200_returns_camelcase_markdown(
    db_client: AsyncClient,
    db_session: AsyncSession,
    auth_as_profile: UUID,  # noqa: ARG001
) -> None:
    await _insert_main_file(db_session, content_markdown="# Results\n\nEffect size 0.81.")

    resp = await db_client.get(f"{_ARTICLES_URL}/{SEED.primary_article}/content-markdown")
    assert resp.status_code == 200, resp.text
    payload = resp.json()
    assert payload["ok"] is True
    data = payload["data"]
    # camelCase on the wire (aliases), like the sibling file schema.
    assert data["fileName"] == "teste3.pdf"
    assert data["contentMarkdown"] == "# Results\n\nEffect size 0.81."


@pytest.mark.asyncio
async def test_content_markdown_endpoint_null_markdown_when_unparsed(
    db_client: AsyncClient,
    db_session: AsyncSession,
    auth_as_profile: UUID,  # noqa: ARG001
) -> None:
    # A MAIN file exists but was never parsed → contentMarkdown is null (200).
    await _insert_main_file(db_session, content_markdown=None)

    resp = await db_client.get(f"{_ARTICLES_URL}/{SEED.primary_article}/content-markdown")
    assert resp.status_code == 200, resp.text
    assert resp.json()["data"]["contentMarkdown"] is None


@pytest.mark.asyncio
async def test_content_markdown_endpoint_404_without_file(
    db_client: AsyncClient,
    db_session: AsyncSession,  # noqa: ARG001
    auth_as_profile: UUID,  # noqa: ARG001
) -> None:
    # No MAIN file for the article (none seeded) → 404.
    resp = await db_client.get(f"{_ARTICLES_URL}/{SEED.primary_article}/content-markdown")
    assert resp.status_code == 404, resp.text


@pytest.mark.asyncio
async def test_content_markdown_endpoint_403_bola(
    db_client: AsyncClient,
    db_session: AsyncSession,  # noqa: ARG001
    outsider_user: UUID,  # noqa: ARG001
) -> None:
    resp = await db_client.get(f"{_ARTICLES_URL}/{SEED.primary_article}/content-markdown")
    assert resp.status_code == 403, resp.text
