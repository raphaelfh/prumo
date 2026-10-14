"""PAT bearer auth for the exact ``/mcp`` route (spec §3, §7).

Pure ASGI, not the SDK ``token_verifier`` — that forces OAuth
``resource_metadata`` 401s, which a PAT bearer is not. ``_PatAuthApp`` is a
class, not a closure: Starlette's ``Route`` runs a plain-function endpoint
as a request -> response handler, but a class instance is called as a raw
ASGI app — which is what the SDK's streamable-http app (a stateful,
long-lived ASGI app) requires as the thing it wraps.
"""

from __future__ import annotations

from collections import Counter
from contextvars import ContextVar
from typing import TYPE_CHECKING

from limits import parse
from sqlalchemy.exc import SQLAlchemyError
from starlette.responses import Response

from app.api.mcp import session as mcp_session
from app.core.config import settings
from app.core.logging import get_logger
from app.schemas.mcp_auth import McpPrincipal
from app.services.pat_service import hash_secret, resolve_principal, touch_last_used
from app.utils.rate_limiter import hit_shared

if TYPE_CHECKING:
    from starlette.types import ASGIApp, Message, Receive, Scope, Send

logger = get_logger(__name__)

principal_var: ContextVar[McpPrincipal] = ContextVar("mcp_principal")

_UNAUTH_LIMIT = parse("30/minute")

# Requests in flight per token digest, in this process (the event loop is
# single-threaded, so check-then-increment needs no lock).
_inflight: Counter[str] = Counter()


def current_principal() -> McpPrincipal:
    """The verified principal for the current ``/mcp`` request.

    Raises ``LookupError`` outside an authenticated request — there is no
    default identity to fall back to.
    """
    return principal_var.get()


def _bearer(scope: Scope) -> str | None:
    """The bearer secret from the request's ``authorization`` header.

    ``None`` for a missing header, another scheme, or an empty secret.
    """
    headers = dict(scope.get("headers") or [])
    raw = headers.get(b"authorization")
    if raw is None:
        return None
    value = raw.decode("latin-1")
    scheme, _, secret = value.partition(" ")
    if scheme.lower() != "bearer":
        return None
    secret = secret.strip()
    return secret or None


class _PatAuthApp:
    """A class, not a closure: Starlette's Route runs a plain-function endpoint as
    request -> response; a class instance is called as a raw ASGI app.

    One /mcp request runs on ONE session (``mcp_session.request_session``):
    principal lookup, the last-used touch (committed before dispatch, so the
    PAT row lock never spans the tool call) and the tool. Nothing commits after
    dispatch -- a write tool commits its own writes.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        secret = _bearer(scope)
        if not secret:
            await _unauthorized(scope, receive, send)
            return

        # Keyed by a prefix of the token's stored hash (never the secret) and
        # checked before any DB checkout. The default cap is half the web pool,
        # so one token's burst leaves connections for other callers. An unknown
        # bearer counts too, and is then refused with 401.
        key = hash_secret(secret)[:16]
        if _inflight[key] >= settings.MCP_MAX_INFLIGHT_PER_TOKEN:
            await Response(status_code=429, headers={"Retry-After": "1"})(scope, receive, send)
            return
        _inflight[key] += 1
        try:
            await self._serve(secret, scope, receive, send)
        finally:
            _inflight[key] -= 1
            if _inflight[key] <= 0:
                del _inflight[key]

    async def _serve(self, secret: str, scope: Scope, receive: Receive, send: Send) -> None:
        async with mcp_session.request_session() as db:
            try:
                principal = await resolve_principal(db, secret)
            except Exception as exc:
                if not (
                    isinstance(exc, SQLAlchemyError) or mcp_session.is_database_unavailable(exc)
                ):
                    raise
                logger.warning("mcp_auth_unavailable", error=type(exc).__name__)
                await _service_unavailable(scope, receive, send)
                return

            if principal is None:
                await _unauthorized(scope, receive, send)
                return

            try:
                if await touch_last_used(db, principal.token_id):
                    await db.commit()
            except Exception:  # noqa: BLE001 - best-effort stamp; auth must proceed regardless
                logger.warning("mcp_touch_last_used_failed", token_id=str(principal.token_id))
                await db.rollback()

            replaced = False

            async def send_or_503(message: Message) -> None:
                # json_response=True: the tool has finished before the response
                # starts, so a dispatch that found the database unavailable
                # swaps the tool's 200 for the same 503 the lookup answers.
                nonlocal replaced
                if replaced:
                    return  # the swapped-out response's body
                if (
                    message["type"] == "http.response.start"
                    and mcp_session.database_marked_unavailable()
                ):
                    replaced = True
                    await _service_unavailable(scope, receive, send)
                    return
                await send(message)

            reset = principal_var.set(principal)
            try:
                await self.app(scope, receive, send_or_503)
            finally:
                principal_var.reset(reset)


async def _service_unavailable(scope: Scope, receive: Receive, send: Send) -> None:
    await Response(status_code=503, headers={"Retry-After": "2"})(scope, receive, send)


async def _unauthorized(scope: Scope, receive: Receive, send: Send) -> None:
    client = scope.get("client")
    ip = client[0] if client else "unknown"
    # Only a failed lookup hits the per-IP bucket: a valid PAT never counts.
    ok = hit_shared(_UNAUTH_LIMIT, "mcp401", ip)
    response = (
        Response(status_code=401, headers={"WWW-Authenticate": "Bearer"})
        if ok
        else Response(status_code=429, headers={"Retry-After": "60"})
    )
    await response(scope, receive, send)


def with_pat_auth(app: ASGIApp) -> ASGIApp:
    return _PatAuthApp(app)
