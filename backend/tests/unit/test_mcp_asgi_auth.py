"""Direct unit tests of ``_PatAuthApp`` (no DB, no httpx) — spec §3, §7.

``/mcp`` handler lines reached only over the httpx ASGITransport register no
diff coverage; this exercises the wrapper's ``__call__`` directly.
"""

from __future__ import annotations

import asyncio
from collections.abc import Callable
from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from sqlalchemy.exc import OperationalError
from sqlalchemy.exc import TimeoutError as PoolTimeoutError

from app.api.mcp import asgi_auth
from app.core.config import Settings
from app.schemas.mcp_auth import McpPrincipal

PRINCIPAL = McpPrincipal(
    user_sub=uuid4(),
    token_id=uuid4(),
    scope="read",
    token_expires_at=datetime(2099, 1, 1, tzinfo=UTC),
)


def _scope(headers: list[tuple[bytes, bytes]] | None = None) -> dict:
    return {
        "type": "http",
        "method": "POST",
        "path": "/mcp",
        "headers": headers or [],
        "client": ("1.2.3.4", 1),
    }


async def _receive() -> dict:
    return {"type": "http.request", "body": b"", "more_body": False}


class _Recorder:
    def __init__(self) -> None:
        self.calls: list[tuple[str, dict]] = []

    def warning(self, event: str, **kw: object) -> None:
        self.calls.append((event, kw))


@pytest.fixture(autouse=True)
def _fake_session_factory(monkeypatch: pytest.MonkeyPatch) -> None:
    def fake() -> object:
        class _Ctx:
            async def __aenter__(self) -> SimpleNamespace:
                return SimpleNamespace(commit=AsyncMock(), rollback=AsyncMock())

            async def __aexit__(self, *exc: object) -> None:
                return None

        return _Ctx()

    monkeypatch.setattr(asgi_auth.mcp_session, "session_factory", fake)


async def test_non_http_scope_passes_through(monkeypatch: pytest.MonkeyPatch) -> None:
    called = {"inner": False}

    async def inner(_scope: dict, _receive: object, _send: object) -> None:
        called["inner"] = True

    resolve = AsyncMock(return_value=PRINCIPAL)
    monkeypatch.setattr(asgi_auth, "resolve_principal", resolve)

    app = asgi_auth._PatAuthApp(inner)
    await app({"type": "lifespan"}, _receive, lambda _m: None)

    assert called["inner"] is True
    resolve.assert_not_awaited()


@pytest.mark.parametrize(
    "headers",
    [
        [],
        [(b"authorization", b"Basic abc")],
        [(b"authorization", b"Bearer ")],
    ],
    ids=["no-header", "wrong-scheme", "empty-secret"],
)
async def test_missing_or_malformed_header_is_401(
    monkeypatch: pytest.MonkeyPatch, headers: list[tuple[bytes, bytes]]
) -> None:
    inner_called = {"called": False}

    async def inner(_scope: dict, _receive: object, _send: object) -> None:
        inner_called["called"] = True

    resolve = AsyncMock(return_value=PRINCIPAL)
    monkeypatch.setattr(asgi_auth, "resolve_principal", resolve)

    sent: list[dict] = []

    async def send(message: dict) -> None:
        sent.append(message)

    app = asgi_auth._PatAuthApp(inner)
    await app(_scope(headers), _receive, send)

    assert sent[0]["status"] == 401
    assert (b"www-authenticate", b"Bearer") in sent[0]["headers"]
    assert inner_called["called"] is False
    resolve.assert_not_awaited()


async def test_scheme_is_case_insensitive_and_principal_is_set_then_reset(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    resolve = AsyncMock(return_value=PRINCIPAL)
    monkeypatch.setattr(asgi_auth, "resolve_principal", resolve)
    monkeypatch.setattr(asgi_auth, "touch_last_used", AsyncMock(return_value=True))

    recorded: dict[str, object] = {}

    async def inner(_scope: dict, _receive: object, _send: object) -> None:
        try:
            recorded["principal"] = asgi_auth.current_principal()
        except LookupError as exc:
            recorded["error"] = exc

    app = asgi_auth._PatAuthApp(inner)
    secret = "prumo_pat_" + "a" * 43
    await app(_scope([(b"authorization", f"bearer {secret}".encode())]), _receive, lambda _m: None)

    resolve.assert_awaited_once()
    assert resolve.await_args is not None
    assert resolve.await_args.args[1] == secret
    assert recorded["principal"] is PRINCIPAL

    with pytest.raises(LookupError):
        asgi_auth.current_principal()


async def test_unknown_token_is_401_then_429_when_the_bucket_is_spent(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(asgi_auth, "resolve_principal", AsyncMock(return_value=None))

    async def inner(_scope: dict, _receive: object, _send: object) -> None:
        raise AssertionError("inner must not be called")

    sent: list[dict] = []

    async def send(message: dict) -> None:
        sent.append(message)

    app = asgi_auth._PatAuthApp(inner)
    secret = "prumo_pat_" + "a" * 43
    await app(_scope([(b"authorization", f"Bearer {secret}".encode())]), _receive, send)
    assert sent[0]["status"] == 401

    monkeypatch.setattr(asgi_auth, "hit_shared", lambda *_a, **_k: False)
    sent.clear()
    await app(_scope([(b"authorization", f"Bearer {secret}".encode())]), _receive, send)
    assert sent[0]["status"] == 429
    assert (b"retry-after", b"60") in sent[0]["headers"]


async def test_touch_failure_still_serves(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(asgi_auth, "resolve_principal", AsyncMock(return_value=PRINCIPAL))

    async def _raise_touch(*_args: object, **_kwargs: object) -> bool:
        raise RuntimeError("boom")

    monkeypatch.setattr(asgi_auth, "touch_last_used", _raise_touch)

    recorder = _Recorder()
    monkeypatch.setattr(asgi_auth, "logger", recorder)

    recorded: dict[str, object] = {}

    async def inner(_scope: dict, _receive: object, _send: object) -> None:
        recorded["principal"] = asgi_auth.current_principal()

    app = asgi_auth._PatAuthApp(inner)
    secret = "prumo_pat_" + "a" * 43
    await app(_scope([(b"authorization", f"Bearer {secret}".encode())]), _receive, lambda _m: None)

    assert recorded["principal"] is PRINCIPAL
    assert len(recorder.calls) == 1
    event, kw = recorder.calls[0]
    assert event == "mcp_touch_last_used_failed"
    assert "token_id" in kw


async def test_contextvar_reset_when_inner_raises(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(asgi_auth, "resolve_principal", AsyncMock(return_value=PRINCIPAL))
    monkeypatch.setattr(asgi_auth, "touch_last_used", AsyncMock(return_value=True))

    async def inner(_scope: dict, _receive: object, _send: object) -> None:
        raise RuntimeError("tool blew up")

    app = asgi_auth._PatAuthApp(inner)
    secret = "prumo_pat_" + "a" * 43

    with pytest.raises(RuntimeError, match="tool blew up"):
        await app(
            _scope([(b"authorization", f"Bearer {secret}".encode())]), _receive, lambda _m: None
        )

    with pytest.raises(LookupError):
        asgi_auth.current_principal()


@pytest.mark.parametrize(
    "exc",
    [
        OperationalError("x", {}, Exception()),
        PoolTimeoutError(),
        OSError("connection refused"),
        TimeoutError(),
    ],
    ids=["operational", "pool-timeout", "os-error", "timeout"],
)
async def test_database_unavailable_during_lookup_is_503(
    monkeypatch: pytest.MonkeyPatch, exc: Exception
) -> None:
    monkeypatch.setattr(asgi_auth, "resolve_principal", AsyncMock(side_effect=exc))
    recorder = _Recorder()
    monkeypatch.setattr(asgi_auth, "logger", recorder)

    async def inner(_scope: dict, _receive: object, _send: object) -> None:
        raise AssertionError("inner must not be called")

    sent: list[dict] = []

    async def send(message: dict) -> None:
        sent.append(message)

    secret = "prumo_pat_" + "s" * 43
    app = asgi_auth._PatAuthApp(inner)
    await app(_scope([(b"authorization", f"Bearer {secret}".encode())]), _receive, send)

    assert sent[0]["status"] == 503
    assert (b"retry-after", b"2") in sent[0]["headers"]
    body = b"".join(m.get("body", b"") for m in sent[1:])
    assert b'"ok"' not in body  # not the REST envelope

    assert recorder.calls == [("mcp_auth_unavailable", {"error": type(exc).__name__})]
    assert secret not in repr(recorder.calls)


async def test_one_session_serves_lookup_touch_and_dispatch(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    opened: list[SimpleNamespace] = []

    def counting_factory() -> object:
        class _Ctx:
            async def __aenter__(self) -> SimpleNamespace:
                db = SimpleNamespace(commit=AsyncMock(), rollback=AsyncMock())
                opened.append(db)
                return db

            async def __aexit__(self, *exc: object) -> None:
                return None

        return _Ctx()

    monkeypatch.setattr(asgi_auth.mcp_session, "session_factory", counting_factory)
    resolve = AsyncMock(return_value=PRINCIPAL)
    touch = AsyncMock(return_value=True)
    monkeypatch.setattr(asgi_auth, "resolve_principal", resolve)
    monkeypatch.setattr(asgi_auth, "touch_last_used", touch)

    seen: dict[str, object] = {}

    async def inner(_scope: dict, _receive: object, _send: object) -> None:
        seen["db"] = asgi_auth.mcp_session.current_session()
        seen["committed_before_dispatch"] = opened[0].commit.await_count

    app = asgi_auth._PatAuthApp(inner)
    secret = "prumo_pat_" + "a" * 43
    await app(_scope([(b"authorization", f"Bearer {secret}".encode())]), _receive, lambda _m: None)

    assert len(opened) == 1
    db = opened[0]
    assert resolve.await_args is not None and resolve.await_args.args[0] is db
    assert touch.await_args is not None and touch.await_args.args[0] is db
    assert seen["db"] is db
    assert seen["committed_before_dispatch"] == 1
    assert db.commit.await_count == 1  # the wrapper never commits after dispatch
    with pytest.raises(LookupError):
        asgi_auth.mcp_session.current_session()


async def test_noop_touch_skips_the_commit(monkeypatch: pytest.MonkeyPatch) -> None:
    opened: list[SimpleNamespace] = []

    def factory() -> object:
        class _Ctx:
            async def __aenter__(self) -> SimpleNamespace:
                db = SimpleNamespace(commit=AsyncMock(), rollback=AsyncMock())
                opened.append(db)
                return db

            async def __aexit__(self, *exc: object) -> None:
                return None

        return _Ctx()

    monkeypatch.setattr(asgi_auth.mcp_session, "session_factory", factory)
    monkeypatch.setattr(asgi_auth, "resolve_principal", AsyncMock(return_value=PRINCIPAL))
    monkeypatch.setattr(asgi_auth, "touch_last_used", AsyncMock(return_value=False))

    async def inner(_scope: dict, _receive: object, _send: object) -> None:
        return None

    app = asgi_auth._PatAuthApp(inner)
    secret = "prumo_pat_" + "a" * 43
    await app(_scope([(b"authorization", f"Bearer {secret}".encode())]), _receive, lambda _m: None)

    assert len(opened) == 1
    opened[0].commit.assert_not_awaited()


def test_inflight_cap_default_is_eight() -> None:
    assert Settings.model_fields["MCP_MAX_INFLIGHT_PER_TOKEN"].default == 8


def _bearer_scope(secret: str) -> dict:
    return _scope([(b"authorization", f"Bearer {secret}".encode())])


async def _noop_send(_message: dict) -> None:
    return None


async def _wait_for(predicate: Callable[[], bool], timeout: float = 2.0) -> None:
    async def poll() -> None:
        while not predicate():
            await asyncio.sleep(0)

    await asyncio.wait_for(poll(), timeout)


async def test_inflight_cap_admits_eight_per_token_and_refuses_the_ninth(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(asgi_auth.settings, "MCP_MAX_INFLIGHT_PER_TOKEN", 8)
    resolve = AsyncMock(return_value=PRINCIPAL)
    monkeypatch.setattr(asgi_auth, "resolve_principal", resolve)
    monkeypatch.setattr(asgi_auth, "touch_last_used", AsyncMock(return_value=False))

    release = asyncio.Event()
    entered: list[str] = []

    async def inner(_scope: dict, _receive: object, _send: object) -> None:
        entered.append("in")
        await release.wait()

    app = asgi_auth._PatAuthApp(inner)
    token_a = "prumo_pat_" + "a" * 43
    token_b = "prumo_pat_" + "b" * 43

    held = [
        asyncio.create_task(app(_bearer_scope(token_a), _receive, _noop_send)) for _ in range(8)
    ]
    try:
        await _wait_for(lambda: len(entered) == 8)

        sent: list[dict] = []

        async def send(message: dict) -> None:
            sent.append(message)

        await app(_bearer_scope(token_a), _receive, send)
        assert sent[0]["status"] == 429
        assert (b"retry-after", b"1") in sent[0]["headers"]
        assert resolve.await_count == 8  # refused before any session lookup

        held.append(asyncio.create_task(app(_bearer_scope(token_b), _receive, _noop_send)))
        await _wait_for(lambda: len(entered) == 9)  # another token is admitted meanwhile
    finally:
        release.set()
        await asyncio.gather(*held)

    assert asgi_auth._inflight == {}


async def test_inflight_slot_is_released_when_the_app_raises(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(asgi_auth.settings, "MCP_MAX_INFLIGHT_PER_TOKEN", 1)
    monkeypatch.setattr(asgi_auth, "resolve_principal", AsyncMock(return_value=PRINCIPAL))
    monkeypatch.setattr(asgi_auth, "touch_last_used", AsyncMock(return_value=False))

    async def inner(_scope: dict, _receive: object, _send: object) -> None:
        raise RuntimeError("tool blew up")

    app = asgi_auth._PatAuthApp(inner)
    secret = "prumo_pat_" + "c" * 43

    for _ in range(2):  # a leaked slot would turn the second call into a 429
        with pytest.raises(RuntimeError, match="tool blew up"):
            await app(_bearer_scope(secret), _receive, _noop_send)

    assert asgi_auth._inflight == {}
