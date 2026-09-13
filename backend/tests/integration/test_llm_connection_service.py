"""LlmConnectionService against real Postgres: Fernet round-trip, the two
ownership guards (cross-owner = miss) and the identity uniqueness (§2,
§7.3). Literal public IPs pass the SSRF guard without DNS."""

from __future__ import annotations

from uuid import UUID

import pytest
from pydantic import SecretStr
from sqlalchemy.ext.asyncio import AsyncSession

from app.schemas.llm_connection import ProjectConnectionCreateRequest, UserConnectionCreateRequest
from app.services.llm_connection_service import (
    LlmConnectionService,
    owned_project_connection,
    owned_user_connection,
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
