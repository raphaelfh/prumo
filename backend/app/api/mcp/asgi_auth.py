"""PAT bearer auth for the exact ``/mcp`` route (spec §3, §7).

Pure ASGI, not the SDK ``token_verifier`` — that forces OAuth
``resource_metadata`` 401s, which a PAT bearer is not. ``_PatAuthApp`` is a
class, not a closure: Starlette's ``Route`` runs a plain-function endpoint
as a request -> response handler, but a class instance is called as a raw
ASGI app — which is what the SDK's streamable-http app (a stateful,
long-lived ASGI app) requires as the thing it wraps.
"""

from __future__ import annotations

from contextvars import ContextVar
from typing import TYPE_CHECKING

from limits import parse
from starlette.responses import Response

from app.api.mcp import session as mcp_session
from app.core.logging import get_logger
from app.schemas.mcp_auth import McpPrincipal
from app.services.pat_service import resolve_principal, touch_last_used
from app.utils.rate_limiter import limiter

if TYPE_CHECKING:
    from starlette.types import ASGIApp, Receive, Scope, Send

logger = get_logger(__name__)

principal_var: ContextVar[McpPrincipal] = ContextVar("mcp_principal")

_UNAUTH_LIMIT = parse("30/minute")


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


async def _touch_last_used(token_id: object) -> None:
    """Best-effort last-used stamp, in its own session; a failure here never blocks auth."""
    try:
        async with mcp_session.session_factory() as db:
            await touch_last_used(db, token_id)  # type: ignore[arg-type]
            await db.commit()
    except Exception:  # noqa: BLE001 - auth must proceed regardless
        logger.warning("mcp_touch_last_used_failed", token_id=str(token_id))


class _PatAuthApp:
    """A class, not a closure: Starlette's Route runs a plain-function endpoint as
    request -> response; a class instance is called as a raw ASGI app."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        secret = _bearer(scope)
        principal = None
        if secret:
            async with mcp_session.session_factory() as db:
                principal = await resolve_principal(db, secret)

        if principal is None:
            client = scope.get("client")
            ip = client[0] if client else "unknown"
            # Only a failed lookup hits the per-IP bucket: a valid PAT never counts.
            ok = limiter.limiter.hit(_UNAUTH_LIMIT, "mcp401", ip)
            response = (
                Response(status_code=401, headers={"WWW-Authenticate": "Bearer"})
                if ok
                else Response(status_code=429, headers={"Retry-After": "60"})
            )
            await response(scope, receive, send)
            return

        await _touch_last_used(principal.token_id)
        reset = principal_var.set(principal)
        try:
            await self.app(scope, receive, send)
        finally:
            principal_var.reset(reset)


def with_pat_auth(app: ASGIApp) -> ASGIApp:
    return _PatAuthApp(app)
