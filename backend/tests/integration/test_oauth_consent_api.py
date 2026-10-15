"""Integration tests for the consent routes under ``/api/v1/oauth`` (ADR 0022):
the signed-in consent page reads a pending authorization request and records
the user's decision."""

from __future__ import annotations

from collections.abc import AsyncGenerator
from datetime import timedelta
from typing import Any
from urllib.parse import parse_qs, urlsplit
from uuid import UUID, uuid4

import pytest
from httpx import ASGITransport, AsyncClient, Response
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.deps import get_db
from app.main import app, create_app
from tests.integration.conftest import SEED
from tests.integration.helpers.engine_setup import client_as
from tests.integration.helpers.pat_rows import (
    insert_oauth_client,
    insert_oauth_connection,
    insert_oauth_request,
)

_BASE = "/api/v1/oauth/requests"
CLAUDE_CB = "https://claude.ai/api/mcp/auth_callback"


@pytest.fixture
def oauth_on(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "PUBLIC_API_URL", "http://localhost:8000")


@pytest.fixture
async def as_primary(db_session: AsyncSession) -> AsyncGenerator[AsyncClient, None]:
    try:
        async with client_as(str(SEED.primary_profile), db_session) as ac:
            yield ac
    finally:
        app.dependency_overrides.clear()


async def _pending(db: AsyncSession, **kw: Any) -> tuple[UUID, UUID]:
    client_id = await insert_oauth_client(db)
    return client_id, await insert_oauth_request(db, client_id=client_id, **kw)


async def _decide(client: AsyncClient, request_id: UUID, **body: Any) -> Response:
    payload = {"approve": True, "write": False, **body}
    return await client.post(f"{_BASE}/{request_id}/decision", json=payload)


def _query(resp: Response) -> dict[str, list[str]]:
    return parse_qs(urlsplit(resp.json()["data"]["redirect_url"]).query)


def _assert_error(resp: Response, status: int, code: str) -> None:
    assert resp.status_code == status, resp.text
    body = resp.json()
    assert body["ok"] is False
    assert body["error"]["code"] == code


async def _unrevoked(db: AsyncSession, client_id: UUID, user_id: UUID) -> list[UUID]:
    rows = await db.execute(
        text(
            "SELECT id FROM public.personal_access_tokens WHERE kind = 'oauth' "
            "AND oauth_client_id = :cid AND user_id = :uid AND revoked_at IS NULL"
        ),
        {"cid": str(client_id), "uid": str(user_id)},
    )
    return [r[0] for r in rows]


# --------------------------------------------------------------------------- GET


@pytest.mark.usefixtures("oauth_on")
async def test_get_pending_request(as_primary: AsyncClient, db_session: AsyncSession) -> None:
    _, request_id = await _pending(db_session)

    resp = await as_primary.get(f"{_BASE}/{request_id}")

    assert resp.status_code == 200, resp.text
    data = resp.json()["data"]
    assert data["client_name"] == "Claude"
    assert data["redirect_host"] == "claude.ai"
    assert data["requested_scopes"] == ["read", "write"]
    assert data["offers_write"] is True
    assert data["expires_at"]


@pytest.mark.usefixtures("oauth_on")
async def test_get_read_only_request_offers_no_write(
    as_primary: AsyncClient, db_session: AsyncSession
) -> None:
    _, request_id = await _pending(db_session, requested_scopes=("read",))

    resp = await as_primary.get(f"{_BASE}/{request_id}")

    assert resp.status_code == 200, resp.text
    assert resp.json()["data"]["offers_write"] is False


@pytest.mark.usefixtures("oauth_on")
async def test_get_unknown_or_expired_is_404(
    as_primary: AsyncClient, db_session: AsyncSession
) -> None:
    _, expired = await _pending(db_session, expires_in=-timedelta(minutes=1))

    _assert_error(await as_primary.get(f"{_BASE}/{uuid4()}"), 404, "NOT_FOUND")
    _assert_error(await as_primary.get(f"{_BASE}/{expired}"), 404, "NOT_FOUND")


@pytest.mark.usefixtures("oauth_on")
async def test_get_malformed_id_is_422(as_primary: AsyncClient) -> None:
    _assert_error(await as_primary.get(f"{_BASE}/not-a-uuid"), 422, "VALIDATION_ERROR")


async def test_oauth_off_is_404(
    as_primary: AsyncClient, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "PUBLIC_API_URL", "")
    client_id, request_id = await _pending(db_session)

    _assert_error(await as_primary.get(f"{_BASE}/{request_id}"), 404, "NOT_FOUND")
    _assert_error(await _decide(as_primary, request_id), 404, "NOT_FOUND")
    assert await _unrevoked(db_session, client_id, SEED.primary_profile) == []


@pytest.mark.usefixtures("oauth_on")
async def test_routes_require_a_jwt(db_session: AsyncSession) -> None:
    _, request_id = await _pending(db_session)

    async def _session() -> AsyncGenerator[AsyncSession, None]:
        yield db_session

    isolated = create_app()
    isolated.dependency_overrides[get_db] = _session
    async with AsyncClient(transport=ASGITransport(app=isolated), base_url="http://test") as ac:
        get_resp = await ac.get(f"{_BASE}/{request_id}")
        post_resp = await _decide(ac, request_id)
    isolated.dependency_overrides.clear()

    assert get_resp.status_code == 401, get_resp.text
    assert post_resp.status_code == 401, post_resp.text


# --------------------------------------------------------------------------- POST


@pytest.mark.usefixtures("oauth_on")
@pytest.mark.parametrize(
    ("requested", "write", "expected"),
    [
        (("read", "write"), True, "read_write"),
        (("read", "write"), False, "read"),
        (("read",), True, "read"),
        (("read",), False, "read"),
    ],
    ids=["rw-write", "rw-read", "r-write", "r-read"],
)
async def test_approve_grants_the_scope(
    as_primary: AsyncClient,
    db_session: AsyncSession,
    requested: tuple[str, ...],
    write: bool,
    expected: str,
) -> None:
    client_id, request_id = await _pending(db_session, requested_scopes=requested)

    resp = await _decide(as_primary, request_id, write=write)

    assert resp.status_code == 200, resp.text
    query = _query(resp)
    assert query["code"][0]
    assert query["state"] == ["st"]
    scope = (
        await db_session.execute(
            text(
                "SELECT scope FROM public.personal_access_tokens "
                "WHERE oauth_client_id = :cid AND user_id = :uid"
            ),
            {"cid": str(client_id), "uid": str(SEED.primary_profile)},
        )
    ).scalar_one()
    assert scope == expected


@pytest.mark.usefixtures("oauth_on")
async def test_approve_binds_the_connection_to_the_caller(db_session: AsyncSession) -> None:
    client_id, request_id = await _pending(db_session)

    try:
        async with client_as(str(SEED.reviewer_profile), db_session) as reviewer:
            resp = await _decide(reviewer, request_id, write=True)
    finally:
        app.dependency_overrides.clear()

    assert resp.status_code == 200, resp.text
    assert len(await _unrevoked(db_session, client_id, SEED.reviewer_profile)) == 1
    assert await _unrevoked(db_session, client_id, SEED.primary_profile) == []


@pytest.mark.usefixtures("oauth_on")
async def test_approve_revokes_the_previous_connection(
    as_primary: AsyncClient, db_session: AsyncSession
) -> None:
    client_id, request_id = await _pending(db_session)
    previous = await insert_oauth_connection(
        db_session, user_id=SEED.primary_profile, client_id=client_id
    )

    resp = await _decide(as_primary, request_id)

    assert resp.status_code == 200, resp.text
    revoked_at = (
        await db_session.execute(
            text("SELECT revoked_at FROM public.personal_access_tokens WHERE id = :id"),
            {"id": str(previous)},
        )
    ).scalar_one()
    assert revoked_at is not None
    remaining = await _unrevoked(db_session, client_id, SEED.primary_profile)
    assert len(remaining) == 1
    assert remaining[0] != previous


@pytest.mark.usefixtures("oauth_on")
async def test_approve_revokes_a_previous_connection_that_expired(
    as_primary: AsyncClient, db_session: AsyncSession
) -> None:
    client_id, request_id = await _pending(db_session)
    previous = await insert_oauth_connection(
        db_session, user_id=SEED.primary_profile, client_id=client_id
    )
    await db_session.execute(
        text(
            "UPDATE public.personal_access_tokens SET created_at = now() - interval '100 days', "
            "expires_at = now() - interval '10 days' WHERE id = :id"
        ),
        {"id": str(previous)},
    )

    resp = await _decide(as_primary, request_id)

    assert resp.status_code == 200, resp.text
    revoked_at = (
        await db_session.execute(
            text("SELECT revoked_at FROM public.personal_access_tokens WHERE id = :id"),
            {"id": str(previous)},
        )
    ).scalar_one()
    assert revoked_at is not None
    assert len(await _unrevoked(db_session, client_id, SEED.primary_profile)) == 1


@pytest.mark.usefixtures("oauth_on")
async def test_decided_request_is_409(as_primary: AsyncClient, db_session: AsyncSession) -> None:
    client_id, request_id = await _pending(db_session)
    assert (await _decide(as_primary, request_id)).status_code == 200

    _assert_error(await as_primary.get(f"{_BASE}/{request_id}"), 409, "REQUEST_ALREADY_DECIDED")
    _assert_error(await _decide(as_primary, request_id), 409, "REQUEST_ALREADY_DECIDED")
    assert len(await _unrevoked(db_session, client_id, SEED.primary_profile)) == 1

    await db_session.execute(
        text(
            "UPDATE public.mcp_oauth_requests SET expires_at = now() - interval '1 minute' "
            "WHERE id = :id"
        ),
        {"id": str(request_id)},
    )
    _assert_error(await as_primary.get(f"{_BASE}/{request_id}"), 409, "REQUEST_ALREADY_DECIDED")
    _assert_error(await _decide(as_primary, request_id), 409, "REQUEST_ALREADY_DECIDED")


@pytest.mark.usefixtures("oauth_on")
async def test_post_on_expired_request_is_404(
    as_primary: AsyncClient, db_session: AsyncSession
) -> None:
    _, request_id = await _pending(db_session, expires_in=-timedelta(minutes=1))

    _assert_error(await _decide(as_primary, request_id), 404, "NOT_FOUND")


@pytest.mark.usefixtures("oauth_on")
async def test_deny(as_primary: AsyncClient, db_session: AsyncSession) -> None:
    _, request_id = await _pending(db_session)

    resp = await _decide(as_primary, request_id, approve=False, write=False)

    assert resp.status_code == 200, resp.text
    query = _query(resp)
    assert query["error"] == ["access_denied"]
    assert query["state"] == ["st"]
    row = (
        await db_session.execute(
            text(
                "SELECT decided_at, connection_id, code_hash FROM public.mcp_oauth_requests "
                "WHERE id = :id"
            ),
            {"id": str(request_id)},
        )
    ).one()
    assert row.decided_at is not None
    assert row.connection_id is None
    assert row.code_hash is None
    _assert_error(await as_primary.get(f"{_BASE}/{request_id}"), 409, "REQUEST_ALREADY_DECIDED")
    _assert_error(await _decide(as_primary, request_id), 409, "REQUEST_ALREADY_DECIDED")


@pytest.mark.usefixtures("oauth_on")
async def test_extra_body_field_is_422(as_primary: AsyncClient, db_session: AsyncSession) -> None:
    _, request_id = await _pending(db_session)

    resp = await _decide(as_primary, request_id, extra=1)

    _assert_error(resp, 422, "VALIDATION_ERROR")


@pytest.mark.usefixtures("oauth_on")
async def test_consent_routes_rate_limited(as_primary: AsyncClient) -> None:
    unknown = uuid4()
    for _ in range(60):
        resp = await as_primary.get(f"{_BASE}/{unknown}")
        assert resp.status_code == 404, resp.text
    assert (await as_primary.get(f"{_BASE}/{unknown}")).status_code == 429

    for _ in range(20):
        resp = await _decide(as_primary, unknown)
        assert resp.status_code == 404, resp.text
    assert (await _decide(as_primary, unknown)).status_code == 429
