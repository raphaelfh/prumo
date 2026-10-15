"""The SDK's OAuth provider protocol, adapted onto ``mcp_oauth_service`` (ADR 0022).

The SDK handlers call these methods outside any FastAPI dependency, so each
opens its own session through ``mcp_session.session_factory`` (read through
the module so tests rebind it) and commits its writes.
"""

from __future__ import annotations

from mcp.server.auth.provider import AuthorizationParams
from mcp.shared.auth import OAuthClientInformationFull

from app.api.mcp import session as mcp_session
from app.core.config import settings
from app.services import mcp_oauth_service


class PrumoOAuthProvider:
    async def get_client(self, client_id: str) -> OAuthClientInformationFull | None:
        async with mcp_session.session_factory() as db:
            return await mcp_oauth_service.get_client(db, client_id)

    async def register_client(self, client_info: OAuthClientInformationFull) -> None:
        async with mcp_session.session_factory() as db:
            await mcp_oauth_service.register_client(db, client_info)
            await db.commit()

    async def authorize(
        self, client: OAuthClientInformationFull, params: AuthorizationParams
    ) -> str:
        """The consent page URL for a freshly stored pending request."""
        async with mcp_session.session_factory() as db:
            request_id = await mcp_oauth_service.create_request(db, client=client, params=params)
            await db.commit()
        return f"{settings.PUBLIC_APP_URL.rstrip('/')}/oauth/consent?request={request_id}"
