"""The /me/tokens handler coroutines, called directly.

The integration suite reaches these lines through httpx ASGITransport, which
diff-cover does not attribute to them, so the handlers' own branches (the
trace-id fallback, the commit/no-commit split, the 404 translation) need a
direct call to be covered at all. Everything the handler depends on is
faked: ``pat_service`` itself is covered unmocked by
``test_pat_service.py``.
"""

from __future__ import annotations

from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import UUID, uuid4

import pytest
from fastapi import HTTPException

from app.api.v1.endpoints import personal_access_tokens as pat_endpoints
from app.schemas.personal_access_token import (
    PersonalAccessTokenCreated,
    PersonalAccessTokenCreateRequest,
    PersonalAccessTokenRead,
)
from app.services.pat_service import TokenLimitReachedError, TokenNotFoundError

#: The handler bodies, without ``@limiter.limit``'s wrapper. slowapi refuses
#: anything that is not a real starlette ``Request``.
_create = pat_endpoints.create_my_token.__wrapped__
_list = pat_endpoints.list_my_tokens.__wrapped__
_revoke = pat_endpoints.revoke_my_token.__wrapped__

CALLER: UUID = uuid4()


def _payload() -> PersonalAccessTokenCreateRequest:
    return PersonalAccessTokenCreateRequest(name="cli", scope="read", expires_in_days=30)


def _read(token_id: UUID | None = None) -> PersonalAccessTokenRead:
    return PersonalAccessTokenRead(
        id=token_id or uuid4(),
        name="cli",
        token_prefix="prumo_pat_abcdef",
        scope="read",
        status="active",
        expires_at=datetime.now(UTC),
        last_used_at=None,
        revoked_at=None,
        created_at=datetime.now(UTC),
    )


def _request(trace_id: object = "t1") -> SimpleNamespace:
    state = SimpleNamespace() if trace_id is None else SimpleNamespace(trace_id=trace_id)
    return SimpleNamespace(state=state)


@pytest.mark.asyncio
async def test_create_commits_and_carries_trace_id(monkeypatch: pytest.MonkeyPatch) -> None:
    created = PersonalAccessTokenCreated(token=_read(), secret="prumo_pat_fakefake")

    async def _fake_create_token(_db: object, **_kwargs: object) -> PersonalAccessTokenCreated:
        return created

    monkeypatch.setattr(pat_endpoints, "create_token", _fake_create_token)
    db = SimpleNamespace(commit=AsyncMock())

    result = await _create(body=_payload(), request=_request("t1"), db=db, user_id=CALLER)
    assert result.data is created
    assert result.trace_id == "t1"
    db.commit.assert_awaited_once()

    db2 = SimpleNamespace(commit=AsyncMock())
    result2 = await _create(body=_payload(), request=_request(None), db=db2, user_id=CALLER)
    assert result2.trace_id is None


@pytest.mark.asyncio
async def test_create_limit_propagates_without_commit(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _fake_create_token(_db: object, **_kwargs: object) -> PersonalAccessTokenCreated:
        raise TokenLimitReachedError()

    monkeypatch.setattr(pat_endpoints, "create_token", _fake_create_token)
    db = SimpleNamespace(commit=AsyncMock())

    with pytest.raises(TokenLimitReachedError):
        await _create(body=_payload(), request=_request(), db=db, user_id=CALLER)
    db.commit.assert_not_awaited()


@pytest.mark.asyncio
async def test_list_returns_rows(monkeypatch: pytest.MonkeyPatch) -> None:
    rows = [_read(), _read()]

    async def _fake_list_tokens(_db: object, **_kwargs: object) -> list[PersonalAccessTokenRead]:
        return rows

    monkeypatch.setattr(pat_endpoints, "list_tokens", _fake_list_tokens)
    db = SimpleNamespace(commit=AsyncMock())

    result = await _list(request=_request(), db=db, user_id=CALLER)
    assert result.data == rows


@pytest.mark.asyncio
async def test_revoke_not_found_is_404_without_commit(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _fake_revoke_token(_db: object, **_kwargs: object) -> PersonalAccessTokenRead:
        raise TokenNotFoundError()

    monkeypatch.setattr(pat_endpoints, "revoke_token", _fake_revoke_token)
    db = SimpleNamespace(commit=AsyncMock())

    with pytest.raises(HTTPException) as exc:
        await _revoke(token_id=uuid4(), request=_request(), db=db, user_id=CALLER)
    assert exc.value.status_code == 404
    assert exc.value.detail == "Token not found"
    db.commit.assert_not_awaited()

    revoked = _read()

    async def _fake_revoke_ok(_db: object, **_kwargs: object) -> PersonalAccessTokenRead:
        return revoked

    monkeypatch.setattr(pat_endpoints, "revoke_token", _fake_revoke_ok)
    db2 = SimpleNamespace(commit=AsyncMock())
    result = await _revoke(token_id=revoked.id, request=_request(), db=db2, user_id=CALLER)
    assert result.data is revoked
    db2.commit.assert_awaited_once()
