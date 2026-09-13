"""The viewer's row: the write gate (lock, credential, ownership), the
§4 availability map (§7.2, §7.3) and the §3.2 resolution order."""

from __future__ import annotations

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.llm import catalog
from app.repositories import ExtractionRunRepository
from app.services.llm_connection_service import LlmConnectionService, availability_map
from app.services.llm_engine_service import (
    EngineRetiredError,
    get_user_engine,
    resolve_engine,
)
from app.services.run_engine_freeze import freeze_run_engine, resolve_engine_for_run
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


@pytest.mark.asyncio
async def test_no_row_resolves_the_project_default_without_deviation(
    db_session: AsyncSession,
) -> None:
    await engine_setup.set_project_engine(db_session, "openai", "gpt-5.6-terra")
    target = await resolve_engine(db_session, _P, SEED.reviewer_profile)
    assert (target.provider, target.model, target.deviation) == ("openai", "gpt-5.6-terra", False)


@pytest.mark.asyncio
async def test_user_row_wins_and_is_a_deviation(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "sk-ant-global")
    await engine_setup.set_project_engine(db_session, "openai", "gpt-5.6-terra")
    await _set(db_session, SEED.reviewer_profile)
    target = await resolve_engine(db_session, _P, SEED.reviewer_profile)
    assert (target.provider, target.model, target.deviation) == (
        "anthropic",
        "claude-haiku-4-5",
        True,
    )
    # Same pair as the default = no deviation.
    await _set(db_session, SEED.reviewer_profile, "openai", "gpt-5.6-terra")
    assert (await resolve_engine(db_session, _P, SEED.reviewer_profile)).deviation is False


@pytest.mark.asyncio
async def test_deviation_is_pinned_once_and_survives_a_later_default_change(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """§7.2 'set and stable across a later default change' (§3.2: computed
    at pin time, never recomputed). Live resolution flips it back to False
    once the default catches up with the user's pair; the run's pin — the
    retry path, ``repin=False`` — must keep True."""
    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "sk-ant-global")
    await engine_setup.set_project_engine(db_session, "openai", "gpt-5.6-terra")
    await _set(db_session, SEED.reviewer_profile)  # anthropic / claude-haiku-4-5
    run = await engine_setup.run_in_extract(db_session)
    pinned = await freeze_run_engine(
        ExtractionRunRepository(db_session),
        run.id,
        await resolve_engine(db_session, _P, SEED.reviewer_profile),
        repin=True,
    )
    assert pinned.deviation is True
    await engine_setup.set_project_engine(db_session, "anthropic", "claude-haiku-4-5")
    assert (
        await resolve_engine(db_session, _P, SEED.reviewer_profile)
    ).deviation is False  # live: recomputed
    retry = await resolve_engine_for_run(
        db_session, run_id=run.id, project_id=_P, repin=False, user_id=SEED.reviewer_profile
    )
    assert (retry.provider, retry.model, retry.deviation) == (
        "anthropic",
        "claude-haiku-4-5",
        True,
    )


@pytest.mark.asyncio
async def test_lock_ignores_a_member_row_but_never_a_manager_row(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "sk-ant-global")
    await engine_setup.set_project_engine(db_session, "openai", "gpt-5.6-terra")
    await _set(db_session, SEED.reviewer_profile)
    await _set(db_session, SEED.primary_profile, is_manager=True)
    await engine_setup.set_project_engine(
        db_session, "openai", "gpt-5.6-terra", user_choice_allowed=False
    )
    assert (await resolve_engine(db_session, _P, SEED.reviewer_profile)).provider == "openai"
    assert (await resolve_engine(db_session, _P, SEED.primary_profile)).provider == "anthropic"
    with pytest.raises(EngineLockedError):
        await _set(db_session, SEED.reviewer_profile)
    await _set(db_session, SEED.primary_profile, is_manager=True)  # managers are never bound


@pytest.mark.asyncio
async def test_retired_project_default_blocks_before_the_user_row(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "sk-ant-global")
    await _set(db_session, SEED.reviewer_profile)
    await engine_setup.set_project_engine(db_session, "openai", "gpt-5.6-terra")
    monkeypatch.setattr(
        "app.services.llm_engine_service.find_entry",
        lambda p, m: None if (p, m) == ("openai", "gpt-5.6-terra") else catalog.find_entry(p, m),
    )
    with pytest.raises(EngineRetiredError, match="manager"):
        await resolve_engine(db_session, _P, SEED.reviewer_profile)


@pytest.mark.asyncio
async def test_host_row_retires_when_the_connection_is_deleted(db_session: AsyncSession) -> None:
    cid = await engine_setup.make_host_connection(
        db_session, user_id=SEED.reviewer_profile, label="mine"
    )
    await _set(
        db_session,
        SEED.reviewer_profile,
        "openai_compatible",
        "endpoint-model-x",
        connection_id=cid,
    )
    target = await resolve_engine(db_session, _P, SEED.reviewer_profile)
    assert (target.connection_id, target.deviation) == (str(cid), True)
    await LlmConnectionService(db_session).delete_user(
        user_id=SEED.reviewer_profile, connection_id=cid
    )
    row = await get_user_engine(db_session, user_id=SEED.reviewer_profile, project_id=_P)
    assert row is not None and row.connection_id is None  # ON DELETE SET NULL
    with pytest.raises(EngineRetiredError, match="[Pp]ick a new model"):
        await resolve_engine(db_session, _P, SEED.reviewer_profile)
    assert await clear_user_engine(db_session, user_id=SEED.reviewer_profile, project_id=_P) is True
    assert (await resolve_engine(db_session, _P, SEED.reviewer_profile)).connection_id is None


@pytest.mark.asyncio
async def test_a_bypass_write_onto_another_users_connection_is_a_409(
    db_session: AsyncSession,
) -> None:
    """§7.3 ownership, resolution: a row re-homed onto a user who does not own
    its connection resolves to the typed 409, never a key."""
    cid = await engine_setup.make_host_connection(
        db_session, user_id=SEED.primary_profile, label="managers"
    )
    row = await _set(
        db_session,
        SEED.primary_profile,
        "openai_compatible",
        "endpoint-model-x",
        connection_id=cid,
        is_manager=True,
    )
    row.user_id = SEED.reviewer_profile  # bypass: re-home the row onto another user
    await db_session.flush()
    with pytest.raises(EngineRetiredError):
        await resolve_engine(db_session, _P, SEED.reviewer_profile)
