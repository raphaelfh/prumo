"""GET/PUT /api/v1/projects/{id}/ai-policy — the manager-owned AI agents policy.

Members read it; only managers write it, and only through this route (the
single ``projects.settings`` writer). An unset or unparseable stored value
reads as the defaults: agent runs off, 25 articles per run, 100 per day.
"""

from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncGenerator
from datetime import datetime
from uuid import uuid4

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker

from app.core.deps import get_db
from app.core.security import TokenPayload, get_current_user
from app.main import app
from app.repositories.project_repository import ProjectRepository
from app.schemas.ai_policy import AiPolicyStored, AiPolicyUpdateRequest
from app.services import ai_policy_service
from tests.integration.conftest import SEED
from tests.integration.helpers import engine_setup

client_as_manager = engine_setup.client_as_manager
client_as_outsider = engine_setup.client_as_outsider
client_as_reviewer = engine_setup.client_as_reviewer

_URL = "/api/v1/projects/{pid}/ai-policy"
_VALID = {"agent_runs": "reviewers", "max_articles_per_run": 10, "daily_agent_article_cap": 50}


async def _clear_policy(db: AsyncSession) -> None:
    await db.execute(
        text("UPDATE public.projects SET settings = settings - 'ai_policy' WHERE id = :pid"),
        {"pid": str(SEED.primary_project)},
    )
    await db.flush()


@pytest.mark.asyncio
async def test_unset_policy_reads_defaults(
    db_session: AsyncSession, client_as_manager: AsyncClient
) -> None:
    await _clear_policy(db_session)

    res = await client_as_manager.get(_URL.format(pid=SEED.primary_project))

    assert res.status_code == 200, res.text
    data = res.json()["data"]
    assert data["agent_runs"] == "off"
    assert data["max_articles_per_run"] == 25
    assert data["daily_agent_article_cap"] == 100
    assert data["updated_by"] is None
    assert data["updated_at"] is None


@pytest.mark.asyncio
async def test_unparseable_policy_reads_defaults(
    db_session: AsyncSession, client_as_manager: AsyncClient
) -> None:
    await ProjectRepository(db_session).update_settings_key(
        SEED.primary_project, "ai_policy", lambda _old: {"agent_runs": "always"}
    )

    res = await client_as_manager.get(_URL.format(pid=SEED.primary_project))

    assert res.status_code == 200, res.text
    data = res.json()["data"]
    assert data["agent_runs"] == "off"
    assert data["max_articles_per_run"] == 25
    assert data["daily_agent_article_cap"] == 100


@pytest.mark.asyncio
async def test_member_get_200_non_member_403(
    db_session: AsyncSession, client_as_reviewer: AsyncClient, client_as_outsider: AsyncClient
) -> None:
    await _clear_policy(db_session)

    member = await client_as_reviewer.get(_URL.format(pid=SEED.primary_project))
    outsider = await client_as_outsider.get(_URL.format(pid=SEED.primary_project))

    assert member.status_code == 200, member.text
    assert member.json()["data"]["agent_runs"] == "off"
    assert outsider.status_code == 403, outsider.text


@pytest.mark.asyncio
async def test_non_manager_put_403(client_as_reviewer: AsyncClient) -> None:
    res = await client_as_reviewer.put(_URL.format(pid=SEED.primary_project), json=_VALID)

    assert res.status_code == 403, res.text


@pytest.mark.asyncio
async def test_unknown_field_422(client_as_manager: AsyncClient) -> None:
    res = await client_as_manager.put(
        _URL.format(pid=SEED.primary_project), json={**_VALID, "allow_deployment_key": True}
    )

    assert res.status_code == 422, res.text
    assert res.json()["error"]["code"] == "VALIDATION_ERROR"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "override",
    [{"max_articles_per_run": 101}, {"daily_agent_article_cap": 0}],
    ids=["per-run-101", "daily-cap-0"],
)
async def test_out_of_bounds_422(client_as_manager: AsyncClient, override: dict) -> None:
    res = await client_as_manager.put(
        _URL.format(pid=SEED.primary_project), json={**_VALID, **override}
    )

    assert res.status_code == 422, res.text


@pytest.mark.asyncio
async def test_put_returns_fresh_read(client_as_manager: AsyncClient) -> None:
    res = await client_as_manager.put(_URL.format(pid=SEED.primary_project), json=_VALID)

    assert res.status_code == 200, res.text
    data = res.json()["data"]
    assert data["agent_runs"] == "reviewers"
    assert data["max_articles_per_run"] == 10
    assert data["daily_agent_article_cap"] == 50
    assert data["updated_by"] == str(SEED.primary_profile)
    assert datetime.fromisoformat(data["updated_at"]) is not None

    again = await client_as_manager.get(_URL.format(pid=SEED.primary_project))
    assert again.json()["data"] == data


@pytest.mark.asyncio
async def test_concurrent_settings_puts_keep_every_sibling_key(_engine: AsyncEngine) -> None:
    """Three settings writers race on one row; the row lock keeps every key.

    Each request gets its own real-commit session, so the three writes are
    genuinely concurrent transactions; the original settings are restored.
    """
    sessions = async_sessionmaker(_engine, expire_on_commit=False)
    pid = str(SEED.primary_project)
    async with sessions() as s:
        original = (
            await s.execute(
                text("SELECT settings FROM public.projects WHERE id = :pid"), {"pid": pid}
            )
        ).scalar_one()

    async def database() -> AsyncGenerator[AsyncSession, None]:
        async with sessions() as session:
            yield session

    async def user() -> TokenPayload:
        return TokenPayload(
            sub=str(SEED.primary_profile),
            email="manager@integration-test.prumo.local",
            role="authenticated",
            aal="aal1",
        )

    app.dependency_overrides[get_db] = database
    app.dependency_overrides[get_current_user] = user
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            base = f"/api/v1/projects/{pid}"
            responses = await asyncio.gather(
                c.put(f"{base}/ai-policy", json=_VALID),
                c.put(f"{base}/parser-settings", json={"type": "docling"}),
                c.put(
                    f"{base}/manager-review-visibility",
                    json={"kind": "extraction", "managers_see_reviewers": True},
                ),
            )
        assert [r.status_code for r in responses] == [200, 200, 200], [r.text for r in responses]
        async with sessions() as s:
            settings = (
                await s.execute(
                    text("SELECT settings FROM public.projects WHERE id = :pid"), {"pid": pid}
                )
            ).scalar_one()
        assert settings["ai_policy"]["agent_runs"] == "reviewers"
        assert settings["ai_policy"]["daily_agent_article_cap"] == 50
        assert settings["parsing"] == {"type": "docling"}
        assert settings["managers_see_reviewers"]["extraction"] is True
    finally:
        app.dependency_overrides.clear()
        async with sessions() as s:
            await s.execute(
                text("UPDATE public.projects SET settings = CAST(:s AS jsonb) WHERE id = :pid"),
                {"s": json.dumps(original), "pid": pid},
            )
            await s.commit()


# --- service level (the ASGI transport hides handler-path coverage) ---


@pytest.mark.asyncio
async def test_service_round_trip_and_defaults(db_session: AsyncSession) -> None:
    await _clear_policy(db_session)
    assert await ai_policy_service.read(db_session, SEED.primary_project) == AiPolicyStored()

    written = await ai_policy_service.set_for_project(
        db_session,
        project_id=SEED.primary_project,
        update=AiPolicyUpdateRequest(**_VALID),
        user_id=SEED.primary_profile,
    )

    read_back = await ai_policy_service.read(db_session, SEED.primary_project)
    assert read_back == written
    assert read_back.agent_runs == "reviewers"
    assert read_back.updated_by == SEED.primary_profile


@pytest.mark.asyncio
@pytest.mark.parametrize("raw", ["managers", {"max_articles_per_run": 0}], ids=["str", "invalid"])
async def test_service_reads_a_bad_stored_value_as_defaults(
    db_session: AsyncSession, raw: object
) -> None:
    await ProjectRepository(db_session).update_settings_key(
        SEED.primary_project, "ai_policy", lambda _old: raw
    )

    assert await ai_policy_service.read(db_session, SEED.primary_project) == AiPolicyStored()


@pytest.mark.asyncio
async def test_service_missing_project_raises(db_session: AsyncSession) -> None:
    with pytest.raises(ai_policy_service.ProjectNotFoundError):
        await ai_policy_service.read(db_session, uuid4())
    with pytest.raises(ai_policy_service.ProjectNotFoundError):
        await ai_policy_service.set_for_project(
            db_session,
            project_id=uuid4(),
            update=AiPolicyUpdateRequest(**_VALID),
            user_id=SEED.primary_profile,
        )
