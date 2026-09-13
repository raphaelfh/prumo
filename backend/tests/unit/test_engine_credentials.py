"""The ONE place an engine turns into credentials (§3.3): a pinned
connection through the owner guard, else the one ladder; never a cloud
fallback for a pinned host."""

from __future__ import annotations

from typing import Any
from uuid import UUID, uuid4

import pytest

import app.services.engine_credentials as ec
from app.schemas.llm_target import LlmTarget
from app.services.engine_credentials import (
    EngineCredentials,
    rekey_for_adopted_engine,
    resolve_engine_credentials,
)
from app.services.llm_connection_service import (
    ConnectionUnavailableError,
    KeyScope,
    ResolvedKey,
)

_PROJECT = uuid4()
_USER = uuid4()
_CID_A = str(uuid4())
_CID_B = str(uuid4())
_CID_C = str(uuid4())


def _row(connection_id: UUID, *, base_url: str = "https://8.8.8.8/v1") -> Any:
    row = type("Row", (), {})()
    row.id, row.base_url, row.label, row.encrypted_api_key = (
        connection_id,
        base_url,
        "host",
        "cipher",
    )
    return row


def _stub_guard(monkeypatch: pytest.MonkeyPatch, row: Any | None) -> list[tuple[UUID, UUID]]:
    calls: list[tuple[UUID, UUID]] = []

    async def fake(_db: Any, connection_id: UUID, user_id: UUID) -> Any:
        calls.append((connection_id, user_id))
        return row

    monkeypatch.setattr(ec, "owned_user_connection", fake)
    return calls


def _stub_decrypt(
    monkeypatch: pytest.MonkeyPatch, key: str | None, error: Exception | None = None
) -> None:
    class _Service:
        def __init__(self, _db: Any) -> None: ...

        async def decrypt_key(self, _row: Any) -> str | None:
            if error is not None:
                raise error
            return key

    monkeypatch.setattr(ec, "LlmConnectionService", _Service)


def _stub_ladder(monkeypatch: pytest.MonkeyPatch, resolved: ResolvedKey | None) -> list[str]:
    asked: list[str] = []

    async def fake(_session: Any, *, provider: str, **_kwargs: Any) -> ResolvedKey | None:
        asked.append(provider)
        return resolved

    monkeypatch.setattr(ec, "resolve_provider_key", fake)
    return asked


@pytest.mark.asyncio
async def test_pinned_connection_resolves_through_the_owner_guard(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    cid = uuid4()
    calls = _stub_guard(monkeypatch, _row(cid))
    _stub_decrypt(monkeypatch, "sk-host")
    asked = _stub_ladder(monkeypatch, ResolvedKey("cloud", KeyScope.GLOBAL_SERVICE))
    creds = await resolve_engine_credentials(
        object(),
        user_id=str(_USER),
        project_id=_PROJECT,
        engine=LlmTarget(provider="openai_compatible", model="llama3", connection_id=str(cid)),
    )
    assert creds == EngineCredentials(
        api_key="sk-host",
        key_scope=KeyScope.USER_BYOK,
        base_url="https://8.8.8.8/v1",
        connection_id=str(cid),
    )
    assert calls == [(cid, _USER)] and asked == []


@pytest.mark.asyncio
@pytest.mark.parametrize("connection_id", [str(uuid4()), "not-a-uuid"])
async def test_missing_foreign_or_corrupt_pin_is_the_typed_409_never_a_cloud_key(
    monkeypatch: pytest.MonkeyPatch, connection_id: str
) -> None:
    _stub_guard(monkeypatch, None)
    asked = _stub_ladder(monkeypatch, ResolvedKey("cloud", KeyScope.GLOBAL_SERVICE))
    with pytest.raises(ConnectionUnavailableError):
        await resolve_engine_credentials(
            object(),
            user_id=_USER,
            project_id=_PROJECT,
            engine=LlmTarget(provider="openai_compatible", model="m", connection_id=connection_id),
        )
    assert asked == []


@pytest.mark.asyncio
async def test_undecryptable_pin_propagates_the_typed_409(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    cid = uuid4()
    _stub_guard(monkeypatch, _row(cid))
    _stub_decrypt(monkeypatch, None, ConnectionUnavailableError("cannot decrypt"))
    with pytest.raises(ConnectionUnavailableError):
        await resolve_engine_credentials(
            object(),
            user_id=_USER,
            project_id=_PROJECT,
            engine=LlmTarget(provider="openai_compatible", model="m", connection_id=str(cid)),
        )


@pytest.mark.asyncio
async def test_keyless_host_is_legal(monkeypatch: pytest.MonkeyPatch) -> None:
    cid = uuid4()
    _stub_guard(monkeypatch, _row(cid))
    _stub_decrypt(monkeypatch, None)
    creds = await resolve_engine_credentials(
        object(),
        user_id=_USER,
        project_id=_PROJECT,
        engine=LlmTarget(provider="openai_compatible", model="m", connection_id=str(cid)),
    )
    assert creds.api_key is None and creds.key_scope is KeyScope.USER_BYOK and creds.base_url


@pytest.mark.asyncio
async def test_catalogue_engine_walks_the_one_ladder(monkeypatch: pytest.MonkeyPatch) -> None:
    asked = _stub_ladder(monkeypatch, ResolvedKey("sk-shared", KeyScope.PROJECT_SHARED))
    creds = await resolve_engine_credentials(
        object(),
        user_id=_USER,
        project_id=_PROJECT,
        engine=LlmTarget(provider="anthropic", model="m"),
    )
    assert creds == EngineCredentials(
        api_key="sk-shared", key_scope=KeyScope.PROJECT_SHARED, base_url=None, connection_id=None
    )
    assert asked == ["anthropic"]


@pytest.mark.asyncio
async def test_no_key_anywhere_is_none_credentials(monkeypatch: pytest.MonkeyPatch) -> None:
    _stub_ladder(monkeypatch, None)
    creds = await resolve_engine_credentials(
        object(), user_id=_USER, project_id=_PROJECT, engine=LlmTarget(provider="openai", model="m")
    )
    assert creds == EngineCredentials(
        api_key=None, key_scope=None, base_url=None, connection_id=None
    )


def test_repr_never_prints_the_key() -> None:
    creds = EngineCredentials(
        api_key="sk-secret", key_scope=KeyScope.USER_BYOK, base_url=None, connection_id=None
    )
    assert "sk-secret" not in repr(creds) and "<redacted>" in repr(creds)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("keyed_for", "current_cid", "engine_cid", "expect_rekey"),
    [
        ("openai", None, None, False),
        ("openai", None, _CID_C, True),
        ("openai_compatible", _CID_A, _CID_B, True),
        ("openai_compatible", _CID_A, _CID_A, False),
        (None, None, None, False),
        (None, _CID_A, _CID_A, True),
    ],
)
async def test_rekey_identity_is_provider_plus_connection(
    monkeypatch: pytest.MonkeyPatch,
    keyed_for: str | None,
    current_cid: str | None,
    engine_cid: str | None,
    expect_rekey: bool,
) -> None:
    asked = _stub_ladder(monkeypatch, ResolvedKey("k", KeyScope.USER_BYOK))
    _stub_guard(monkeypatch, _row(uuid4()))
    _stub_decrypt(monkeypatch, "k")
    provider = "openai_compatible" if engine_cid else "openai"
    result = await rekey_for_adopted_engine(
        object(),
        user_id=_USER,
        project_id=_PROJECT,
        engine=LlmTarget(provider=provider, model="m", connection_id=engine_cid),
        current=EngineCredentials(
            api_key="old", key_scope=KeyScope.USER_BYOK, base_url=None, connection_id=current_cid
        ),
        keyed_for=keyed_for,
    )
    assert (result is not None) is expect_rekey, asked


def test_legacy_pinned_snapshot_with_endpoint_id_validates() -> None:
    """§7.4 read tolerance: nothing writes ``endpoint_id`` again; old pins read."""
    target = LlmTarget.model_validate(
        {"provider": "openai_compatible", "model": "m", "endpoint_id": "x"}
    )
    assert target.connection_id is None and target.deviation is False
