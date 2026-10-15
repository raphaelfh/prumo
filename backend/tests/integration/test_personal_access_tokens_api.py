"""Integration tests for ``/api/v1/me/tokens`` (spec §4.2, ADR 0020)."""

from __future__ import annotations

from collections.abc import AsyncGenerator
from uuid import UUID, uuid4

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
from tests.integration.helpers.pat_rows import insert_oauth_client, insert_oauth_connection

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


# --- OAuth connections (connected apps, ADR 0022) ------------------------------

_CONNECTIONS = "/api/v1/me/oauth-connections"
_CONNECTION_FIELDS = {
    "id",
    "client_name",
    "scope",
    "status",
    "created_at",
    "last_used_at",
    "expires_at",
}


async def _connection_for(db_session: AsyncSession, user_id: UUID, name: str = "Claude") -> UUID:
    client_id = await insert_oauth_client(db_session, client_name=name)
    return await insert_oauth_connection(
        db_session, user_id=user_id, client_id=client_id, name=name
    )


@pytest.mark.asyncio
async def test_connections_list_is_owner_only_and_kind_scoped(
    client_as_reviewer: AsyncClient, db_session: AsyncSession
) -> None:
    mine = await _connection_for(db_session, SEED.reviewer_profile, name="Claude")
    foreign = await _connection_for(db_session, SEED.primary_profile, name="Other")
    pat = await client_as_reviewer.post(
        _BASE, json={"name": "cli", "scope": "read", "expires_in_days": 30}
    )
    assert pat.status_code == 201, pat.text
    pat_id = pat.json()["data"]["token"]["id"]

    resp = await client_as_reviewer.get(_CONNECTIONS)

    assert resp.status_code == 200, resp.text
    rows = resp.json()["data"]
    ids = {r["id"] for r in rows}
    assert str(mine) in ids
    assert str(foreign) not in ids
    assert pat_id not in ids
    row = next(r for r in rows if r["id"] == str(mine))
    assert set(row) == _CONNECTION_FIELDS
    assert row["client_name"] == "Claude"
    assert row["scope"] == "read_write"
    assert row["status"] == "active"
    assert row["last_used_at"] is None

    tokens = (await client_as_reviewer.get(_BASE)).json()["data"]
    assert str(mine) not in {t["id"] for t in tokens}
    assert pat_id in {t["id"] for t in tokens}


@pytest.mark.asyncio
async def test_expired_connection_lists_as_expired(
    client_as_reviewer: AsyncClient, db_session: AsyncSession
) -> None:
    connection_id = await _connection_for(db_session, SEED.reviewer_profile)
    await db_session.execute(
        text(
            "UPDATE public.personal_access_tokens "
            "SET created_at = now() - interval '2 days', expires_at = now() - interval '1 day' "
            "WHERE id = :id"
        ),
        {"id": str(connection_id)},
    )

    rows = (await client_as_reviewer.get(_CONNECTIONS)).json()["data"]

    assert next(r for r in rows if r["id"] == str(connection_id))["status"] == "expired"


@pytest.mark.asyncio
async def test_revoke_connection_twice_is_200_revoked(
    client_as_reviewer: AsyncClient, db_session: AsyncSession
) -> None:
    connection_id = await _connection_for(db_session, SEED.reviewer_profile)

    for _ in range(2):
        resp = await client_as_reviewer.delete(f"{_CONNECTIONS}/{connection_id}")
        assert resp.status_code == 200, resp.text
        assert resp.json()["data"]["id"] == str(connection_id)
        assert resp.json()["data"]["status"] == "revoked"


@pytest.mark.asyncio
async def test_revoke_foreign_missing_or_pat_through_connections_is_404(
    client_as_reviewer: AsyncClient, db_session: AsyncSession
) -> None:
    foreign = await _connection_for(db_session, SEED.primary_profile, name="Secret App")
    pat = await client_as_reviewer.post(
        _BASE, json={"name": "cli", "scope": "read", "expires_in_days": 30}
    )
    pat_id = pat.json()["data"]["token"]["id"]

    responses = [
        await client_as_reviewer.delete(f"{_CONNECTIONS}/{target}")
        for target in (foreign, uuid4(), pat_id)
    ]

    assert [r.status_code for r in responses] == [404, 404, 404], [r.text for r in responses]
    messages = {r.json()["error"]["message"] for r in responses}
    assert messages == {"Connection not found"}
    assert "Secret App" not in responses[0].text
    still_active = (
        await db_session.execute(
            text(
                "SELECT count(*) FROM public.personal_access_tokens "
                "WHERE id IN (:a, :b) AND revoked_at IS NULL"
            ),
            {"a": str(foreign), "b": pat_id},
        )
    ).scalar_one()
    assert still_active == 2


@pytest.mark.asyncio
async def test_llm_connections_route_is_unchanged(
    client_as_reviewer: AsyncClient, db_session: AsyncSession
) -> None:
    oauth_id = await _connection_for(db_session, SEED.reviewer_profile)

    resp = await client_as_reviewer.get("/api/v1/me/connections")

    assert resp.status_code == 200, resp.text
    rows = resp.json()["data"]
    assert isinstance(rows, list)
    assert str(oauth_id) not in {r["id"] for r in rows}
    spec = create_app().openapi()
    schema = spec["paths"]["/api/v1/me/connections"]["get"]["responses"]["200"]["content"][
        "application/json"
    ]["schema"]
    assert schema["$ref"].endswith("ApiResponse_list_LlmConnectionRead__")


@pytest.mark.asyncio
async def test_connection_routes_rate_limited(client_as_reviewer: AsyncClient) -> None:
    for _ in range(60):
        resp = await client_as_reviewer.get(_CONNECTIONS)
        assert resp.status_code == 200, resp.text
    limited_get = await client_as_reviewer.get(_CONNECTIONS)
    assert limited_get.status_code == 429, limited_get.text

    # slowapi buckets by URL, so the budget is per connection id: one id throughout.
    missing = f"{_CONNECTIONS}/{uuid4()}"
    for _ in range(20):
        resp = await client_as_reviewer.delete(missing)
        assert resp.status_code == 404, resp.text
    limited_delete = await client_as_reviewer.delete(missing)
    assert limited_delete.status_code == 429, limited_delete.text
