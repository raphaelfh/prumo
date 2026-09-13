"""LlmConnectionService against real Postgres: Fernet round-trip, the two
ownership guards (cross-owner = miss) and the identity uniqueness (§2,
§7.3). Literal public IPs pass the SSRF guard without DNS."""

from __future__ import annotations

from uuid import UUID

import pytest
from pydantic import SecretStr
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.schemas.llm_connection import (
    LlmConnectionUpdateRequest,
    ProjectConnectionCreateRequest,
    UserConnectionCreateRequest,
)
from app.services.llm_connection_service import (
    ConnectionNotFoundError,
    KeyScope,
    LlmConnectionService,
    ResolvedKey,
    owned_project_connection,
    owned_user_connection,
    resolve_provider_key,
)
from tests.integration.conftest import SEED


async def _user_key(db: AsyncSession, provider: str = "openai", key: str = "sk-user") -> UUID:
    read = await LlmConnectionService(db).create_user(
        user_id=SEED.primary_profile,
        payload=UserConnectionCreateRequest(
            provider=provider, label=f"my {provider}", api_key=SecretStr(key)
        ),
    )
    return read.id


async def _project_key(db: AsyncSession, provider: str = "openai", key: str = "sk-project") -> UUID:
    read = await LlmConnectionService(db).create_project(
        project_id=SEED.primary_project,
        created_by=SEED.primary_profile,
        payload=ProjectConnectionCreateRequest(
            provider=provider, label=f"shared {provider}", api_key=SecretStr(key)
        ),
    )
    return read.id


@pytest.mark.asyncio
async def test_create_encrypts_and_read_never_carries_the_key(db_session: AsyncSession) -> None:
    svc = LlmConnectionService(db_session)
    read = await svc.create_user(
        user_id=SEED.primary_profile,
        payload=UserConnectionCreateRequest(
            provider="openai", label="k", api_key=SecretStr("sk-plain")
        ),
    )
    assert read.has_api_key is True and "sk-plain" not in read.model_dump_json()
    row = await owned_user_connection(db_session, read.id, SEED.primary_profile)
    assert row is not None and row.encrypted_api_key != "sk-plain"
    assert await svc.decrypt_key(row) == "sk-plain"


@pytest.mark.asyncio
async def test_user_guard_misses_another_users_row(db_session: AsyncSession) -> None:
    cid = await _user_key(db_session)
    assert await owned_user_connection(db_session, cid, SEED.reviewer_profile) is None
    assert await owned_project_connection(db_session, cid, SEED.primary_project) is None


@pytest.mark.asyncio
async def test_project_guard_misses_another_project(db_session: AsyncSession) -> None:
    cid = await _project_key(db_session)
    assert await owned_project_connection(db_session, cid, SEED.secondary_project) is None
    assert await owned_user_connection(db_session, cid, SEED.primary_profile) is None


@pytest.mark.asyncio
async def test_one_hosted_key_per_provider_per_user(db_session: AsyncSession) -> None:
    await _user_key(db_session)
    with pytest.raises(ValueError, match="already have a key"):
        await LlmConnectionService(db_session).create_user(
            user_id=SEED.primary_profile,
            payload=UserConnectionCreateRequest(
                provider="openai", label="second", api_key=SecretStr("k2")
            ),
        )


@pytest.mark.asyncio
async def test_duplicate_label_at_project_scope_is_a_label_collision(
    db_session: AsyncSession,
) -> None:
    await _project_key(db_session)
    with pytest.raises(ValueError, match="labeled"):
        await _project_key(db_session)


@pytest.mark.asyncio
async def test_host_connections_store_the_vetted_url_and_allow_keyless(
    db_session: AsyncSession,
) -> None:
    read = await LlmConnectionService(db_session).create_user(
        user_id=SEED.primary_profile,
        payload=UserConnectionCreateRequest(
            provider="openai_compatible",
            label="ollama",
            base_url="https://8.8.8.8/v1/",
            allowed_models=["llama3"],
        ),
    )
    assert read.base_url == "https://8.8.8.8/v1" and read.has_api_key is False
    assert read.validation_status == "unverified" and read.allowed_models == ["llama3"]


@pytest.mark.asyncio
async def test_update_and_delete_go_through_the_guard(db_session: AsyncSession) -> None:
    cid = await _user_key(db_session)
    svc = LlmConnectionService(db_session)
    with pytest.raises(ConnectionNotFoundError):
        await svc.update_user(
            user_id=SEED.reviewer_profile,
            connection_id=cid,
            payload=LlmConnectionUpdateRequest(label="stolen"),
        )
    with pytest.raises(ConnectionNotFoundError):
        await svc.delete_user(user_id=SEED.reviewer_profile, connection_id=cid)
    read = await svc.update_user(
        user_id=SEED.primary_profile,
        connection_id=cid,
        payload=LlmConnectionUpdateRequest(label="renamed"),
    )
    assert read.label == "renamed"
    result = await svc.delete_user(user_id=SEED.primary_profile, connection_id=cid)
    assert result.deleted is True and result.id == cid
    assert await svc.list_user(SEED.primary_profile) == []


@pytest.mark.asyncio
async def test_clearing_the_key_is_refused_on_a_hosted_provider(db_session: AsyncSession) -> None:
    cid = await _user_key(db_session)
    with pytest.raises(ValueError, match="key"):
        await LlmConnectionService(db_session).update_user(
            user_id=SEED.primary_profile,
            connection_id=cid,
            payload=LlmConnectionUpdateRequest(label="k", api_key=SecretStr("")),
        )


@pytest.mark.asyncio
async def test_ladder_user_then_project_then_global(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "OPENAI_API_KEY", "sk-global")
    kw = {"provider": "openai", "project_id": SEED.primary_project}
    assert await resolve_provider_key(
        db_session, user_id=SEED.reviewer_profile, **kw
    ) == ResolvedKey("sk-global", KeyScope.GLOBAL_SERVICE)
    await _project_key(db_session)
    assert await resolve_provider_key(
        db_session, user_id=SEED.reviewer_profile, **kw
    ) == ResolvedKey("sk-project", KeyScope.PROJECT_SHARED)
    await _user_key(db_session)
    assert await resolve_provider_key(
        db_session, user_id=SEED.primary_profile, **kw
    ) == ResolvedKey("sk-user", KeyScope.USER_BYOK)
    # Per caller: the reviewer has no key of their own and still sees the project's.
    assert (
        await resolve_provider_key(db_session, user_id=SEED.reviewer_profile, **kw)
    ).scope is KeyScope.PROJECT_SHARED
    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", None)
    assert (
        await resolve_provider_key(
            db_session,
            provider="anthropic",
            project_id=SEED.primary_project,
            user_id=SEED.reviewer_profile,
        )
        is None
    )


@pytest.mark.asyncio
async def test_llama_cloud_key_resolves_for_parsing(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Port of test_api_key_llama_cloud.py (§7.5): a user-scope llama_cloud
    connection resolves USER_BYOK; a project-scope one resolves
    PROJECT_SHARED for a member without a key."""
    monkeypatch.setattr(settings, "LLAMA_CLOUD_API_KEY", None)
    await _user_key(db_session, "llama_cloud", "lc-secret")
    assert await resolve_provider_key(
        db_session,
        provider="llama_cloud",
        project_id=SEED.primary_project,
        user_id=SEED.primary_profile,
    ) == ResolvedKey("lc-secret", KeyScope.USER_BYOK)
    await _project_key(db_session, "llama_cloud", "lc-shared")
    assert await resolve_provider_key(
        db_session,
        provider="llama_cloud",
        project_id=SEED.primary_project,
        user_id=SEED.reviewer_profile,
    ) == ResolvedKey("lc-shared", KeyScope.PROJECT_SHARED)


@pytest.mark.asyncio
async def test_ladder_skips_host_rows_and_tolerates_several_shared_keys(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A keyed HOST is never handed out as a bare provider key, and two
    shared keys for one provider (distinct labels - legal at project scope)
    resolve to one of them, never ``MultipleResultsFound``."""
    monkeypatch.setattr(settings, "OPENAI_API_KEY", None)
    svc = LlmConnectionService(db_session)
    await svc.create_user(
        user_id=SEED.primary_profile,
        payload=UserConnectionCreateRequest(
            provider="openai_compatible",
            label="h",
            base_url="https://8.8.8.8/v1",
            api_key=SecretStr("host-key"),
        ),
    )
    assert (
        await resolve_provider_key(
            db_session,
            provider="openai_compatible",
            project_id=SEED.primary_project,
            user_id=SEED.primary_profile,
        )
        is None
    )
    await _project_key(db_session, key="sk-first")
    await svc.create_project(
        project_id=SEED.primary_project,
        created_by=SEED.primary_profile,
        payload=ProjectConnectionCreateRequest(
            provider="openai", label="second", api_key=SecretStr("sk-second")
        ),
    )
    resolved = await resolve_provider_key(
        db_session,
        provider="openai",
        project_id=SEED.primary_project,
        user_id=SEED.reviewer_profile,
    )
    assert resolved is not None and resolved.scope is KeyScope.PROJECT_SHARED
    assert resolved.key in {"sk-first", "sk-second"}  # same-transaction created_at ties are legal
