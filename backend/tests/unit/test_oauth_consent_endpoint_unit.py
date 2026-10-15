"""The /oauth/requests consent handler coroutines, called directly.

The integration suite reaches these lines through httpx ASGITransport, which
diff-cover does not attribute to them, so the handlers' own branches (the
OAuth-off refusal, the trace-id fallback, the commit/no-commit split) need a
direct call to be covered. The service is faked here; it is covered
unmocked by ``tests/integration/test_mcp_oauth_service.py``.
"""

from __future__ import annotations

from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import UUID, uuid4

import pytest

from app.api.v1.endpoints import oauth_consent
from app.core.config import settings
from app.schemas.mcp_oauth import OAuthConsentDecisionRequest, OAuthConsentRequestRead
from app.services.mcp_oauth_service import (
    ConsentRequestDecidedError,
    ConsentRequestNotFoundError,
)

#: The handler bodies, without ``@limiter.limit``'s wrapper.
_get = oauth_consent.read_consent_request.__wrapped__
_decide = oauth_consent.decide_consent_request.__wrapped__

CALLER: UUID = uuid4()
REQUEST_ID: UUID = uuid4()


def _request(trace_id: object = "t1") -> SimpleNamespace:
    state = SimpleNamespace() if trace_id is None else SimpleNamespace(trace_id=trace_id)
    return SimpleNamespace(state=state)


def _view() -> OAuthConsentRequestRead:
    return OAuthConsentRequestRead(
        client_name="Claude",
        redirect_host="claude.ai",
        requested_scopes=["read", "write"],
        offers_write=True,
        expires_at=datetime.now(UTC),
    )


@pytest.fixture
def oauth_on(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "PUBLIC_API_URL", "http://localhost:8000")


async def test_oauth_off_refuses_both_without_calling_the_service(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "PUBLIC_API_URL", "")
    service = AsyncMock()
    monkeypatch.setattr(oauth_consent, "get_consent_request", service)
    monkeypatch.setattr(oauth_consent, "decide_request", service)
    db = SimpleNamespace(commit=AsyncMock())

    with pytest.raises(ConsentRequestNotFoundError):
        await _get(request_id=REQUEST_ID, request=_request(), db=db)
    with pytest.raises(ConsentRequestNotFoundError):
        await _decide(
            request_id=REQUEST_ID,
            body=OAuthConsentDecisionRequest(approve=True, write=True),
            request=_request(),
            db=db,
            user_id=CALLER,
        )
    service.assert_not_awaited()
    db.commit.assert_not_awaited()


@pytest.mark.usefixtures("oauth_on")
async def test_get_returns_the_view_with_the_trace_id(monkeypatch: pytest.MonkeyPatch) -> None:
    view = _view()
    seen: dict[str, object] = {}

    async def _fake(_db: object, *, request_id: UUID) -> OAuthConsentRequestRead:
        seen["request_id"] = request_id
        return view

    monkeypatch.setattr(oauth_consent, "get_consent_request", _fake)
    db = SimpleNamespace(commit=AsyncMock())

    result = await _get(request_id=REQUEST_ID, request=_request("t1"), db=db)
    assert result.ok is True
    assert result.data is view
    assert result.trace_id == "t1"
    assert seen["request_id"] == REQUEST_ID

    untraced = await _get(request_id=REQUEST_ID, request=_request(None), db=db)
    assert untraced.trace_id is None
    db.commit.assert_not_awaited()


@pytest.mark.usefixtures("oauth_on")
async def test_post_decides_for_the_caller_and_commits_once(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    seen: dict[str, object] = {}

    async def _fake(_db: object, **kwargs: object) -> str:
        seen.update(kwargs)
        return "https://claude.ai/cb?code=c&state=st"

    monkeypatch.setattr(oauth_consent, "decide_request", _fake)
    db = SimpleNamespace(commit=AsyncMock())

    result = await _decide(
        request_id=REQUEST_ID,
        body=OAuthConsentDecisionRequest(approve=True, write=False),
        request=_request("t2"),
        db=db,
        user_id=CALLER,
    )

    assert seen == {"request_id": REQUEST_ID, "user_id": CALLER, "approve": True, "write": False}
    db.commit.assert_awaited_once()
    assert result.data is not None
    assert result.data.redirect_url == "https://claude.ai/cb?code=c&state=st"
    assert result.trace_id == "t2"


@pytest.mark.usefixtures("oauth_on")
async def test_post_refusal_propagates_without_commit(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _fake(_db: object, **_kwargs: object) -> str:
        raise ConsentRequestDecidedError()

    monkeypatch.setattr(oauth_consent, "decide_request", _fake)
    db = SimpleNamespace(commit=AsyncMock())

    with pytest.raises(ConsentRequestDecidedError):
        await _decide(
            request_id=REQUEST_ID,
            body=OAuthConsentDecisionRequest(approve=False, write=False),
            request=_request(None),
            db=db,
            user_id=CALLER,
        )
    db.commit.assert_not_awaited()
