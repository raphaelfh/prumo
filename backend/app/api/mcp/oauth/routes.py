"""The OAuth routes for ``/mcp`` (ADR 0022), mounted only when OAuth is on.

RFC 9728 protected-resource metadata and RFC 8414 authorization-server
metadata, both built by the SDK and served through its credential-less CORS
(``allow_origins="*"``); the SDK's authorize, token, dynamic-registration and
revocation endpoints over ``PrumoOAuthProvider``. ``OAUTH_CORS_PATHS`` is what
``main.py`` exempts from the global allow-list CORS so that route-level CORS
answers.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable

from limits import parse
from mcp.server.auth.handlers.metadata import MetadataHandler, ProtectedResourceMetadataHandler
from mcp.server.auth.routes import (
    build_metadata,
    cors_middleware,
    create_auth_routes,
    validate_issuer_url,
)
from mcp.server.auth.settings import ClientRegistrationOptions, RevocationOptions
from mcp.shared.auth import ProtectedResourceMetadata
from pydantic import AnyHttpUrl
from starlette.requests import Request
from starlette.responses import Response
from starlette.routing import Route

from app.api.mcp.oauth.asgi import Limited, PublicClientDefault, client_id_key, ip_key
from app.api.mcp.oauth.provider import PrumoOAuthProvider
from app.core.config import settings
from app.services.mcp_oauth_service import OAUTH_SCOPES, OFFLINE_ACCESS

PRM_PATH = "/.well-known/oauth-protected-resource/mcp"
AS_METADATA_PATH = "/.well-known/oauth-authorization-server"

# The credential-less OAuth paths: they bypass the global allow-list CORS.
# /authorize is a browser redirect and keeps the allow-list.
OAUTH_CORS_PATHS: frozenset[str] = frozenset(
    {PRM_PATH, AS_METADATA_PATH, "/token", "/register", "/revoke"}
)

_PER_IP_60 = parse("60/minute")


def resource_metadata_url() -> str:
    """The PRM document's absolute URL, for the ``/mcp`` 401 challenge."""
    return settings.public_api_url + PRM_PATH


def build_oauth_routes() -> list[Route]:
    issuer = AnyHttpUrl(settings.public_api_url)
    validate_issuer_url(issuer)
    scopes = list(OAUTH_SCOPES)
    # offline_access: accepted no-op marker (listed in AS metadata, never granted).
    registration = ClientRegistrationOptions(
        enabled=True, valid_scopes=[*scopes, OFFLINE_ACCESS], default_scopes=scopes
    )
    revocation = RevocationOptions(enabled=True)
    # Public clients only: the SDK hardcodes the client-secret methods.
    as_metadata = build_metadata(issuer, None, registration, revocation).model_copy(
        update={
            "token_endpoint_auth_methods_supported": ["none"],
            "revocation_endpoint_auth_methods_supported": ["none"],
        }
    )
    prm = ProtectedResourceMetadata(
        resource=AnyHttpUrl(settings.mcp_resource_url),
        authorization_servers=[issuer],
        scopes_supported=scopes,
    )
    sdk = {
        route.path: route.endpoint
        for route in create_auth_routes(
            PrumoOAuthProvider(),
            issuer,
            client_registration_options=registration,
            revocation_options=revocation,
        )
    }
    return [
        _metadata_route(PRM_PATH, ProtectedResourceMetadataHandler(prm).handle, "oauth-prm"),
        _metadata_route(AS_METADATA_PATH, MetadataHandler(as_metadata).handle, "oauth-as-meta"),
        Route(
            "/authorize",
            endpoint=Limited(
                sdk["/authorize"],
                limit=parse("30/minute"),
                bucket="oauth-authorize",
                key=client_id_key,
                reads_body=True,
            ),
            methods=["GET", "POST"],
        ),
        Route(
            "/register",
            endpoint=Limited(
                PublicClientDefault(sdk["/register"]),
                limit=parse("10/minute"),
                bucket="oauth-register",
                key=ip_key,
                reads_body=False,
            ),
            methods=["POST", "OPTIONS"],
        ),
        Route(
            "/token",
            endpoint=Limited(
                sdk["/token"],
                limit=parse("60/minute"),
                bucket="oauth-token",
                key=client_id_key,
                reads_body=True,
            ),
            methods=["POST", "OPTIONS"],
        ),
        Route(
            "/revoke",
            endpoint=Limited(
                sdk["/revoke"],
                limit=_PER_IP_60,
                bucket="oauth-revoke",
                key=ip_key,
                reads_body=False,
            ),
            methods=["POST", "OPTIONS"],
        ),
    ]


def _metadata_route(
    path: str, handler: Callable[[Request], Awaitable[Response]], bucket: str
) -> Route:
    endpoint = Limited(
        cors_middleware(handler, ["GET", "OPTIONS"]),
        limit=_PER_IP_60,
        bucket=bucket,
        key=ip_key,
        reads_body=False,
    )
    return Route(path, endpoint=endpoint, methods=["GET", "OPTIONS"])
