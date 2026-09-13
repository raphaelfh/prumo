"""The viewer's row: the write gate (lock, credential, ownership) and the
§4 availability map (§7.2, §7.3). Resolution order is Task 21's file half."""

from __future__ import annotations

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.services.llm_connection_service import LlmConnectionService, availability_map
from app.services.user_engine_service import (
    EngineLockedError,
    EngineNeedsKeyError,
    clear_user_engine,
    set_user_engine,
)
from tests.integration.conftest import SEED
from tests.integration.helpers import engine_setup

_P = SEED.primary_project


async def _set(db: AsyncSession, user_id, provider="anthropic", model="claude-haiku-4-5", **kw):
    return await set_user_engine(
        db,
        user_id=user_id,
        project_id=_P,
        provider=provider,
        model=model,
        mode="fast",
        connection_id=kw.get("connection_id"),
        is_manager=kw.get("is_manager", False),
    )


@pytest.mark.asyncio
async def test_row_without_a_credential_is_refused_422(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", None)
    with pytest.raises(EngineNeedsKeyError):
        await _set(db_session, SEED.reviewer_profile)


@pytest.mark.asyncio
async def test_availability_map_is_per_caller(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "OPENAI_API_KEY", "sk-global")
    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", None)
    from pydantic import SecretStr

    from app.schemas.llm_connection import (
        ProjectConnectionCreateRequest,
        UserConnectionCreateRequest,
    )

    svc = LlmConnectionService(db_session)
    await svc.create_project(
        project_id=_P,
        created_by=SEED.primary_profile,
        payload=ProjectConnectionCreateRequest(
            provider="openai", label="s", api_key=SecretStr("k")
        ),
    )
    await svc.create_user(
        user_id=SEED.primary_profile,
        payload=UserConnectionCreateRequest(provider="openai", label="m", api_key=SecretStr("k")),
    )
    providers = ("openai", "anthropic", "openai_compatible")
    assert await availability_map(
        db_session, project_id=_P, user_id=SEED.primary_profile, providers=providers
    ) == {"openai": "user", "anthropic": None, "openai_compatible": None}
    assert (
        await availability_map(
            db_session, project_id=_P, user_id=SEED.reviewer_profile, providers=providers
        )
    )["openai"] == "project"
    await engine_setup.make_host_connection(db_session, user_id=SEED.reviewer_profile, label="h")
    assert (
        await availability_map(
            db_session, project_id=_P, user_id=SEED.reviewer_profile, providers=providers
        )
    )["openai_compatible"] == "user"


@pytest.mark.asyncio
async def test_another_users_connection_is_refused_at_write(db_session: AsyncSession) -> None:
    """§7.3 ownership, the write gate: a foreign connection id never becomes a row."""
    cid = await engine_setup.make_host_connection(
        db_session, user_id=SEED.primary_profile, label="managers"
    )
    with pytest.raises(ValueError, match="connection"):
        await _set(
            db_session,
            SEED.reviewer_profile,
            "openai_compatible",
            "endpoint-model-x",
            connection_id=cid,
        )


@pytest.mark.asyncio
async def test_lock_refuses_a_member_write_but_never_a_managers(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "sk-ant-global")
    await engine_setup.set_project_engine(
        db_session, "openai", "gpt-5.6-terra", user_choice_allowed=False
    )
    with pytest.raises(EngineLockedError):
        await _set(db_session, SEED.reviewer_profile)
    row = await _set(db_session, SEED.primary_profile, is_manager=True)  # managers are never bound
    assert (row.provider, row.model) == ("anthropic", "claude-haiku-4-5")
    assert await clear_user_engine(db_session, user_id=SEED.primary_profile, project_id=_P) is True
    assert await clear_user_engine(db_session, user_id=SEED.primary_profile, project_id=_P) is False
