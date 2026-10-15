"""ASGI plumbing for the OAuth routes: body buffering and THE rate-limit wrapper.

``Limited`` is the only rate limiter for OAuth routes (ADR 0022). It is a raw
ASGI class, not a slowapi decorator: the SDK handlers are plain request ->
response callables wrapped in its own CORS middleware, and a key derived from
a form body (``client_id``) needs the body before the handler runs.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import TYPE_CHECKING

from mcp.server.transport_security import DEFAULT_MAX_REQUEST_BODY_SIZE
from starlette.responses import JSONResponse

from app.utils.rate_limiter import client_ip, too_many

if TYPE_CHECKING:
    from limits import RateLimitItem
    from starlette.types import ASGIApp, Message, Receive, Scope, Send


async def read_body(
    receive: Receive, max_size: int = DEFAULT_MAX_REQUEST_BODY_SIZE
) -> bytes | None:
    """The whole request body, or ``None`` once it exceeds ``max_size``."""
    chunks: list[bytes] = []
    size = 0
    while True:
        message = await receive()
        if message["type"] != "http.request":
            break
        chunk = message.get("body", b"")
        size += len(chunk)
        if size > max_size:
            return None
        chunks.append(chunk)
        if not message.get("more_body", False):
            break
    return b"".join(chunks)


def replay(body: bytes, receive: Receive) -> Receive:
    """A ``receive`` that yields ``body`` once, then delegates to ``receive``."""
    sent = False

    async def replayed() -> Message:
        nonlocal sent
        if not sent:
            sent = True
            return {"type": "http.request", "body": body, "more_body": False}
        return await receive()

    return replayed


def ip_key(scope: Scope, body: bytes) -> str:  # noqa: ARG001 - the Limited key signature
    return client_ip(scope)


def _is_preflight(scope: Scope) -> bool:
    """A CORS preflight, as the SDK's CORS layer recognizes (and answers) one."""
    if scope["method"] != "OPTIONS":
        return False
    names = {name for name, _ in scope.get("headers") or []}
    return b"origin" in names and b"access-control-request-method" in names


class Limited:
    """Rate-limit ``app`` per ``key(scope, body)`` in ``bucket``.

    Non-http scopes and genuine CORS preflights (``OPTIONS`` with ``Origin`` and
    ``Access-Control-Request-Method``) pass straight through, uncounted; any
    other ``OPTIONS`` reaches the handler, so it is counted and capped.
    With ``reads_body`` the body is buffered (413 over the SDK's size cap,
    before the wrapped app runs) and replayed to ``app``.
    """

    def __init__(
        self,
        app: ASGIApp,
        *,
        limit: RateLimitItem,
        bucket: str,
        key: Callable[[Scope, bytes], str],
        reads_body: bool,
    ) -> None:
        self.app = app
        self.limit = limit
        self.bucket = bucket
        self.key = key
        self.reads_body = reads_body

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or _is_preflight(scope):
            await self.app(scope, receive, send)
            return

        body = b""
        if self.reads_body:
            buffered = await read_body(receive)
            if buffered is None:
                await JSONResponse({"error": "request_too_large"}, status_code=413)(
                    scope, receive, send
                )
                return
            body = buffered
            receive = replay(body, receive)

        refused = too_many(self.limit, self.bucket, self.key(scope, body))
        if refused is not None:
            await refused(scope, receive, send)
            return
        await self.app(scope, receive, send)
