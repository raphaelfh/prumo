"""Direct unit tests of the OAuth ASGI helpers and the path-scoped CORS
middleware (no DB, no httpx): ``__call__`` is driven with hand-built scopes and
a recorded ``send``, so the lines register diff coverage (ADR 0022)."""

from __future__ import annotations

from uuid import uuid4

from limits import parse
from mcp.server.transport_security import DEFAULT_MAX_REQUEST_BODY_SIZE

from app.api.mcp.oauth.asgi import Limited, ip_key, read_body, replay
from app.core.middleware import PathScopedCORSMiddleware

_TWO_PER_MINUTE = parse("2/minute")


def _receiver(*chunks: bytes):
    messages = [
        {"type": "http.request", "body": chunk, "more_body": i < len(chunks) - 1}
        for i, chunk in enumerate(chunks)
    ]

    async def receive() -> dict:
        return messages.pop(0)

    return receive


def _scope(method: str = "GET", path: str = "/x", headers: list | None = None) -> dict:
    return {
        "type": "http",
        "method": method,
        "path": path,
        "headers": headers or [],
        "client": ("9.8.7.6", 1),
    }


class _Inner:
    def __init__(self) -> None:
        self.calls = 0
        self.body: bytes | None = None

    async def __call__(self, scope: dict, receive, send) -> None:
        self.calls += 1
        if scope["type"] != "http":
            return
        message = await receive()
        self.body = message.get("body", b"")
        await send({"type": "http.response.start", "status": 200, "headers": []})
        await send({"type": "http.response.body", "body": b"inner"})


class _Sent:
    def __init__(self) -> None:
        self.messages: list[dict] = []

    async def __call__(self, message: dict) -> None:
        self.messages.append(message)

    @property
    def status(self) -> int:
        return self.messages[0]["status"]

    @property
    def headers(self) -> dict[bytes, bytes]:
        return dict(self.messages[0]["headers"])

    @property
    def body(self) -> bytes:
        return b"".join(m.get("body", b"") for m in self.messages[1:])


def _limited(inner: _Inner, *, reads_body: bool = False) -> Limited:
    return Limited(
        inner, limit=_TWO_PER_MINUTE, bucket=f"t-{uuid4()}", key=ip_key, reads_body=reads_body
    )


async def test_read_body_joins_chunks() -> None:
    assert await read_body(_receiver(b"ab", b"cd")) == b"abcd"


async def test_read_body_stops_at_a_disconnect() -> None:
    messages = [
        {"type": "http.request", "body": b"ab", "more_body": True},
        {"type": "http.disconnect"},
    ]

    async def receive() -> dict:
        return messages.pop(0)

    assert await read_body(receive) == b"ab"
    assert messages == []


async def test_read_body_over_the_cap_is_none() -> None:
    assert await read_body(_receiver(b"12345", b"67890"), max_size=8) is None


async def test_replay_yields_the_buffer_once_then_delegates() -> None:
    async def original() -> dict:
        return {"type": "http.disconnect"}

    receive = replay(b"buffered", original)
    assert await receive() == {"type": "http.request", "body": b"buffered", "more_body": False}
    assert await receive() == {"type": "http.disconnect"}


async def test_preflights_pass_through_uncounted() -> None:
    inner = _Inner()
    app = _limited(inner)
    for _ in range(5):
        sent = _Sent()
        await app(_scope("OPTIONS"), _receiver(b""), sent)
        assert sent.status == 200
    assert inner.calls == 5


async def test_the_third_get_is_429_and_skips_the_inner_app() -> None:
    inner = _Inner()
    app = _limited(inner)
    for _ in range(2):
        sent = _Sent()
        await app(_scope(), _receiver(b""), sent)
        assert sent.status == 200
    assert inner.calls == 2

    sent = _Sent()
    await app(_scope(), _receiver(b""), sent)
    assert sent.status == 429
    assert int(sent.headers[b"retry-after"]) >= 1
    assert b"too_many_requests" in sent.body
    assert inner.calls == 2


async def test_an_oversized_body_is_413_and_skips_the_inner_app() -> None:
    inner = _Inner()
    sent = _Sent()
    oversized = _receiver(b"x" * DEFAULT_MAX_REQUEST_BODY_SIZE, b"y")
    await _limited(inner, reads_body=True)(_scope("POST"), oversized, sent)
    assert sent.status == 413
    assert b"request_too_large" in sent.body
    assert inner.calls == 0


async def test_a_small_body_reaches_the_inner_app_intact() -> None:
    inner = _Inner()
    sent = _Sent()
    await _limited(inner, reads_body=True)(_scope("POST"), _receiver(b"grant_", b"type=x"), sent)
    assert sent.status == 200
    assert inner.body == b"grant_type=x"


async def test_a_lifespan_scope_passes_straight_through() -> None:
    inner = _Inner()
    await _limited(inner)({"type": "lifespan"}, _receiver(b""), _Sent())
    assert inner.calls == 1


def test_ip_key_is_the_client_host() -> None:
    assert ip_key(_scope(), b"") == "9.8.7.6"


_PREFLIGHT_HEADERS = [
    (b"origin", b"https://unlisted.example"),
    (b"access-control-request-method", b"GET"),
]


def _cors(inner: _Inner) -> PathScopedCORSMiddleware:
    return PathScopedCORSMiddleware(
        inner,
        bypass_paths=frozenset({"/token"}),
        allow_origins=["https://listed.example"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )


async def test_a_bypass_path_reaches_the_app_untouched() -> None:
    inner = _Inner()
    sent = _Sent()
    await _cors(inner)(_scope("OPTIONS", "/token", _PREFLIGHT_HEADERS), _receiver(b""), sent)
    assert inner.calls == 1
    assert b"access-control-allow-origin" not in sent.headers


async def test_any_other_path_is_answered_by_cors() -> None:
    inner = _Inner()
    sent = _Sent()
    await _cors(inner)(_scope("OPTIONS", "/api/v1/x", _PREFLIGHT_HEADERS), _receiver(b""), sent)
    assert inner.calls == 0
    assert sent.status == 400
    assert b"access-control-allow-origin" not in sent.headers
