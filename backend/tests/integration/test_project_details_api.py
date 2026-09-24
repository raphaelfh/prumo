"""PATCH /api/v1/projects/{id}/details — gate order, precondition, validation.

The gate order is the contract: a non-member and a missing project both get
the same 404 (no existence oracle), a member who is not a manager gets 403,
and only a manager reaches the service. None of the refused calls may move
the row.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID, uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from tests.integration.conftest import SEED
from tests.integration.helpers import engine_setup

client_as_manager = engine_setup.client_as_manager
client_as_outsider = engine_setup.client_as_outsider
client_as_reviewer = engine_setup.client_as_reviewer

_URL = "/api/v1/projects/{pid}/details"
_ELEVEN = {
    "name",
    "description",
    "review_type",
    "review_title",
    "condition_studied",
    "review_rationale",
    "search_strategy",
    "eligibility_criteria",
    "study_design",
    "review_keywords",
    "review_context",
}


async def _description(db: AsyncSession, pid: UUID = SEED.primary_project) -> Any:
    return (
        await db.execute(
            text("SELECT description FROM public.projects WHERE id = :pid"), {"pid": str(pid)}
        )
    ).scalar_one()


def _body(new: Any, old: Any) -> dict[str, Any]:
    return {"fields": {"description": new}, "expected": {"description": old}}


@pytest.mark.asyncio
async def test_project_details_gate_order(
    db_session: AsyncSession,
    client_as_manager: AsyncClient,
    client_as_reviewer: AsyncClient,
    client_as_outsider: AsyncClient,
) -> None:
    current = await _description(db_session)
    pid = SEED.primary_project

    reviewer = await client_as_reviewer.patch(_URL.format(pid=pid), json=_body("x", current))
    outsider = await client_as_outsider.patch(_URL.format(pid=pid), json=_body("x", current))
    missing = await client_as_manager.patch(_URL.format(pid=uuid4()), json=_body("x", current))

    assert reviewer.status_code == 403, reviewer.text
    assert outsider.status_code == 404, outsider.text
    assert missing.status_code == 404, missing.text
    assert missing.json()["error"] == outsider.json()["error"]
    assert await _description(db_session) == current

    ok = await client_as_manager.patch(_URL.format(pid=pid), json=_body("via api", current))

    assert ok.status_code == 200, ok.text
    data = ok.json()["data"]
    assert data["description"] == "via api"
    assert set(data) == _ELEVEN | {"updated_at"}
    await db_session.rollback()


@pytest.mark.asyncio
async def test_stale_value_is_409_with_current(
    db_session: AsyncSession, client_as_manager: AsyncClient
) -> None:
    await db_session.execute(
        text("UPDATE public.projects SET description = 'changed by agent' WHERE id = :pid"),
        {"pid": str(SEED.primary_project)},
    )
    await db_session.flush()

    res = await client_as_manager.patch(
        _URL.format(pid=SEED.primary_project), json=_body("mine", "stale")
    )

    assert res.status_code == 409, res.text
    error = res.json()["error"]
    assert error["code"] == "STALE_VALUE"
    assert error["details"]["current"] == {"description": "changed by agent"}
    assert await _description(db_session) == "changed by agent"
    await db_session.rollback()


@pytest.mark.asyncio
async def test_unknown_field_is_422(client_as_manager: AsyncClient) -> None:
    res = await client_as_manager.patch(
        _URL.format(pid=SEED.primary_project),
        json={
            "fields": {"picots_config_ai_review": {}},
            "expected": {"picots_config_ai_review": {}},
        },
    )

    assert res.status_code == 422, res.text
    assert res.json()["error"]["code"] == "VALIDATION_ERROR"


@pytest.mark.asyncio
async def test_expected_must_cover_fields(client_as_manager: AsyncClient) -> None:
    res = await client_as_manager.patch(
        _URL.format(pid=SEED.primary_project), json={"fields": {"name": "a"}, "expected": {}}
    )

    assert res.status_code == 422, res.text


@pytest.mark.asyncio
async def test_route_is_rate_limited(
    db_session: AsyncSession, client_as_manager: AsyncClient
) -> None:
    # The autouse _isolated_rate_limits fixture reset the limiter before this test.
    current = await _description(db_session)
    url = _URL.format(pid=SEED.primary_project)
    for attempt in range(30):
        res = await client_as_manager.patch(url, json=_body(current, current))
        assert res.status_code == 200, f"request {attempt + 1}: {res.text}"

    limited = await client_as_manager.patch(url, json=_body(current, current))

    assert limited.status_code == 429, limited.text
    await db_session.rollback()
