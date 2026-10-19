"""The SDK's OAuth provider protocol, adapted onto ``mcp_oauth_service`` (ADR 0022).

The SDK handlers call these methods outside any FastAPI dependency, so each
opens its own session through ``mcp_session.session_factory`` (read through
the module so tests rebind it) and commits its writes.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable

from mcp.server.auth.provider import (
    AccessToken,
    AuthorizationCode,
    AuthorizationParams,
    OAuthAuthorizationServerProvider,
    RefreshToken,
    TokenError,
)
from mcp.shared.auth import OAuthClientInformationFull, OAuthToken
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.mcp import session as mcp_session
from app.core.config import settings
from app.services import mcp_oauth_service


async def _grant(issue: Callable[[AsyncSession], Awaitable[OAuthToken]]) -> OAuthToken:
    """Run a token grant and commit; a refusal commits too, so the connection
    revocation that reuse detection wrote persists, then re-raises.

    The refusal is re-raised after the session closes: ``TokenError`` is a
    frozen dataclass, so a context manager that sets ``__traceback__`` on an
    exception passing through it would fail on it.
    """
    async with mcp_session.session_factory() as db:
        outcome: OAuthToken | TokenError
        try:
            outcome = await issue(db)
        except TokenError as refusal:
            outcome = refusal
        await db.commit()
    if isinstance(outcome, TokenError):
        raise outcome
    return outcome


class PrumoOAuthProvider(
    OAuthAuthorizationServerProvider[AuthorizationCode, RefreshToken, AccessToken]
):
    async def get_client(self, client_id: str) -> OAuthClientInformationFull | None:
        async with mcp_session.session_factory() as db:
            return await mcp_oauth_service.get_client(db, client_id)

    async def register_client(self, client_info: OAuthClientInformationFull) -> None:
        async with mcp_session.session_factory() as db:
            await mcp_oauth_service.register_client(db, client_info)
            await mcp_oauth_service.prune(db)
            await db.commit()

    async def authorize(
        self, client: OAuthClientInformationFull, params: AuthorizationParams
    ) -> str:
        """The consent page URL for a freshly stored pending request."""
        async with mcp_session.session_factory() as db:
            request_id = await mcp_oauth_service.create_request(db, client=client, params=params)
            await db.commit()
        return f"{settings.PUBLIC_APP_URL.rstrip('/')}/oauth/consent?request={request_id}"

    async def load_authorization_code(
        self, client: OAuthClientInformationFull, authorization_code: str
    ) -> AuthorizationCode | None:
        async with mcp_session.session_factory() as db:
            return await mcp_oauth_service.load_code(
                db, client_id=client.client_id, code=authorization_code
            )

    async def exchange_authorization_code(
        self, client: OAuthClientInformationFull, authorization_code: AuthorizationCode
    ) -> OAuthToken:
        return await _grant(
            lambda db: mcp_oauth_service.exchange_code(
                db, client_id=client.client_id, code=authorization_code.code
            )
        )

    async def load_refresh_token(
        self, client: OAuthClientInformationFull, refresh_token: str
    ) -> RefreshToken | None:
        async with mcp_session.session_factory() as db:
            return await mcp_oauth_service.load_refresh(
                db, client_id=client.client_id, token=refresh_token
            )

    async def exchange_refresh_token(
        self,
        client: OAuthClientInformationFull,
        refresh_token: RefreshToken,
        scopes: list[str],  # noqa: ARG002 - the new pair always carries the granted scope
    ) -> OAuthToken:
        return await _grant(
            lambda db: mcp_oauth_service.rotate_refresh(
                db, client_id=client.client_id, token=refresh_token.token
            )
        )

    async def load_access_token(self, token: str) -> AccessToken | None:
        async with mcp_session.session_factory() as db:
            return await mcp_oauth_service.load_access(db, token)

    async def revoke_token(self, token: AccessToken | RefreshToken) -> None:
        async with mcp_session.session_factory() as db:
            await mcp_oauth_service.revoke_connection_by_token(db, token.token)
            await db.commit()
