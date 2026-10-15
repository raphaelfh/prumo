"""Integration tests for ``/api/v1/me/tokens`` (spec §4.2, ADR 0020)."""

from __future__ import annotations

from collections.abc import AsyncGenerator
from uuid import uuid4

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_db
from app.main import create_app
from app.schemas.personal_access_token import PersonalAccessTokenCreateRequest
from app.services.pat_service import create_token
from tests.integration.conftest import SEED
from tests.integration.helpers import engine_setup
from tests.integration.helpers.engine_setup import client_as

client_as_reviewer = engine_setup.client_as_reviewer

_BASE = "/api/v1/me/tokens"


async def _yield_session(db_session: AsyncSession) -> AsyncGenerator[AsyncSession]:
    yield db_session


@pytest.mark.asyncio
async def test_create_list_revoke(client_as_reviewer: AsyncClient) -> None:
    create_resp = await client_as_reviewer.post(
        _BASE, json={"name": "cli", "scope": "read", "expires_in_days": 30}
    )
    assert create_resp.status_code == 201, create_resp.text
    body = create_resp.json()["data"]
    assert body["secret"].startswith("prumo_pat_")
    token_id = body["token"]["id"]

    list_resp = await client_as_reviewer.get(_BASE)
    assert list_resp.status_code == 200, list_resp.text
    rows = list_resp.json()["data"]
    assert any(r["id"] == token_id for r in rows)
    assert all("secret" not in r for r in rows)
    assert body["secret"] not in list_resp.text

    delete_resp = await client_as_reviewer.delete(f"{_BASE}/{token_id}")
    assert delete_resp.status_code == 200, delete_resp.text
    assert delete_resp.json()["data"]["status"] == "revoked"

    delete_again = await client_as_reviewer.delete(f"{_BASE}/{token_id}")
    assert delete_again.status_code == 200, delete_again.text
    assert delete_again.json()["data"]["status"] == "revoked"


@pytest.mark.asyncio
async def test_foreign_or_missing_token_is_404(
    client_as_reviewer: AsyncClient, db_session: AsyncSession
) -> None:
    async with client_as(str(SEED.primary_profile), db_session) as owner_client:
        created = await owner_client.post(
            _BASE, json={"name": "foreign", "scope": "read", "expires_in_days": 30}
        )
        assert created.status_code == 201, created.text
        foreign_id = created.json()["data"]["token"]["id"]

    foreign_delete = await client_as_reviewer.delete(f"{_BASE}/{foreign_id}")
    assert foreign_delete.status_code == 404, foreign_delete.text

    missing_delete = await client_as_reviewer.delete(f"{_BASE}/{uuid4()}")
    assert missing_delete.status_code == 404, missing_delete.text
    assert foreign_delete.json()["error"]["message"] == missing_delete.json()["error"]["message"]


@pytest.mark.asyncio
async def test_expires_in_days_bounds(
    client_as_reviewer: AsyncClient, db_session: AsyncSession
) -> None:
    count_before = (
        await db_session.execute(
            text("SELECT count(*) FROM public.personal_access_tokens WHERE user_id = :uid"),
            {"uid": str(SEED.reviewer_profile)},
        )
    ).scalar_one()

    too_low = await client_as_reviewer.post(
        _BASE, json={"name": "low", "scope": "read", "expires_in_days": 0}
    )
    assert too_low.status_code == 422, too_low.text
    too_high = await client_as_reviewer.post(
        _BASE, json={"name": "high", "scope": "read", "expires_in_days": 366}
    )
    assert too_high.status_code == 422, too_high.text

    count_after = (
        await db_session.execute(
            text("SELECT count(*) FROM public.personal_access_tokens WHERE user_id = :uid"),
            {"uid": str(SEED.reviewer_profile)},
        )
    ).scalar_one()
    assert count_after == count_before

    at_min = await client_as_reviewer.post(
        _BASE, json={"name": "min", "scope": "read", "expires_in_days": 1}
    )
    assert at_min.status_code == 201, at_min.text
    at_max = await client_as_reviewer.post(
        _BASE, json={"name": "max", "scope": "read", "expires_in_days": 365}
    )
    assert at_max.status_code == 201, at_max.text


@pytest.mark.asyncio
async def test_cap_is_409_with_code(client_as_reviewer: AsyncClient) -> None:
    for i in range(10):
        resp = await client_as_reviewer.post(
            _BASE, json={"name": f"cap-{i}", "scope": "read", "expires_in_days": 30}
        )
        assert resp.status_code == 201, resp.text

    eleventh = await client_as_reviewer.post(
        _BASE, json={"name": "cap-10", "scope": "read", "expires_in_days": 30}
    )
    assert eleventh.status_code == 409, eleventh.text
    assert eleventh.json()["error"]["code"] == "TOKEN_LIMIT_REACHED"


@pytest.mark.asyncio
async def test_pat_cannot_call_token_routes(db_session: AsyncSession) -> None:
    """ADR 0020: a PAT never mints a PAT. /me/tokens stays JWT-only."""
    created = await create_token(
        db_session,
        user_id=SEED.reviewer_profile,
        payload=PersonalAccessTokenCreateRequest(
            name="pat-probe", scope="read", expires_in_days=30
        ),
    )

    isolated_app = create_app()
    isolated_app.dependency_overrides[get_db] = lambda: _yield_session(db_session)

    async with AsyncClient(transport=ASGITransport(app=isolated_app), base_url="http://test") as ac:
        headers = {"Authorization": f"Bearer {created.secret}"}
        get_resp = await ac.get(_BASE, headers=headers)
        post_resp = await ac.post(
            _BASE,
            json={"name": "should-fail", "scope": "read", "expires_in_days": 30},
            headers=headers,
        )
        delete_resp = await ac.delete(f"{_BASE}/{created.token.id}", headers=headers)

    isolated_app.dependency_overrides.clear()

    assert get_resp.status_code == 401, get_resp.text
    assert post_resp.status_code == 401, post_resp.text
    assert delete_resp.status_code == 401, delete_resp.text

    count = (
        await db_session.execute(
            text("SELECT count(*) FROM public.personal_access_tokens WHERE user_id = :uid"),
            {"uid": str(SEED.reviewer_profile)},
        )
    ).scalar_one()
    assert count == 1
    still_active = (
        await db_session.execute(
            text("SELECT revoked_at IS NULL FROM public.personal_access_tokens WHERE id = :id"),
            {"id": str(created.token.id)},
        )
    ).scalar_one()
    assert still_active is True


@pytest.mark.asyncio
async def test_token_routes_rate_limited(client_as_reviewer: AsyncClient) -> None:
    for i in range(10):
        resp = await client_as_reviewer.post(
            _BASE, json={"name": f"rl-{i}", "scope": "read", "expires_in_days": 30}
        )
        assert resp.status_code == 201, resp.text
    for i in range(10):
        resp = await client_as_reviewer.post(
            _BASE, json={"name": f"rl-over-{i}", "scope": "read", "expires_in_days": 30}
        )
        assert resp.status_code == 409, resp.text
    limited_post = await client_as_reviewer.post(
        _BASE, json={"name": "rl-limited", "scope": "read", "expires_in_days": 30}
    )
    assert limited_post.status_code == 429, limited_post.text

    for _ in range(60):
        resp = await client_as_reviewer.get(_BASE)
        assert resp.status_code == 200, resp.text
    limited_get = await client_as_reviewer.get(_BASE)
    assert limited_get.status_code == 429, limited_get.text


# --- optional per-project restriction ----------------------------------------


async def _reviewer_token_count(db_session: AsyncSession) -> int:
    return (
        await db_session.execute(
            text("SELECT count(*) FROM public.personal_access_tokens WHERE user_id = :uid"),
            {"uid": str(SEED.reviewer_profile)},
        )
    ).scalar_one()


@pytest.mark.asyncio
async def test_create_with_and_without_project_ids(client_as_reviewer: AsyncClient) -> None:
    unrestricted = await client_as_reviewer.post(
        _BASE, json={"name": "all", "scope": "read", "expires_in_days": 30}
    )
    assert unrestricted.status_code == 201, unrestricted.text
    assert unrestricted.json()["data"]["token"]["project_ids"] is None

    restricted = await client_as_reviewer.post(
        _BASE,
        json={
            "name": "a-only",
            "scope": "read",
            "expires_in_days": 30,
            "project_ids": [str(SEED.primary_project)],
        },
    )
    assert restricted.status_code == 201, restricted.text
    assert restricted.json()["data"]["token"]["project_ids"] == [str(SEED.primary_project)]


@pytest.mark.asyncio
async def test_unreachable_project_is_one_422_for_foreign_and_missing(
    client_as_reviewer: AsyncClient, db_session: AsyncSession
) -> None:
    before = await _reviewer_token_count(db_session)
    bodies = []
    for project_id in (SEED.secondary_project, uuid4()):
        resp = await client_as_reviewer.post(
            _BASE,
            json={
                "name": "x",
                "scope": "read",
                "expires_in_days": 30,
                "project_ids": [str(project_id)],
            },
        )
        assert resp.status_code == 422, resp.text
        body = resp.json()
        body.pop("trace_id", None)
        bodies.append(body)

    assert bodies[0]["error"]["code"] == "PROJECT_NOT_ACCESSIBLE"
    assert bodies[0] == bodies[1]
    assert await _reviewer_token_count(db_session) == before


@pytest.mark.parametrize(
    "project_ids",
    [
        pytest.param([], id="empty"),
        pytest.param([str(uuid4()) for _ in range(21)], id="twenty-one"),
        pytest.param([str(SEED.primary_project)] * 2, id="duplicate"),
    ],
)
@pytest.mark.asyncio
async def test_bad_project_ids_are_validation_errors(
    client_as_reviewer: AsyncClient, db_session: AsyncSession, project_ids: list[str]
) -> None:
    before = await _reviewer_token_count(db_session)
    resp = await client_as_reviewer.post(
        _BASE,
        json={"name": "x", "scope": "read", "expires_in_days": 30, "project_ids": project_ids},
    )
    assert resp.status_code == 422, resp.text
    assert resp.json()["error"]["code"] == "VALIDATION_ERROR"
    assert await _reviewer_token_count(db_session) == before


def test_create_422_contract_types_both_refusals() -> None:
    spec = create_app().openapi()
    schema = spec["paths"]["/api/v1/me/tokens"]["post"]["responses"]["422"]["content"][
        "application/json"
    ]["schema"]
    refs = {item["$ref"].rsplit("/", 1)[-1] for item in schema["anyOf"]}
    assert refs == {"PersonalAccessTokenRefusalResponse", "ApiResponse_NoneType_"}

    components = spec["components"]["schemas"]
    error_ref = components["PersonalAccessTokenRefusalResponse"]["properties"]["error"]["$ref"]
    error = components[error_ref.rsplit("/", 1)[-1]]
    code_ref = error["properties"]["code"]["$ref"]
    codes = set(components[code_ref.rsplit("/", 1)[-1]]["enum"])
    assert {"TOKEN_LIMIT_REACHED", "PROJECT_NOT_ACCESSIBLE"} <= codes
