"""The researcher MCP server served at the exact route /mcp (spec §3).

Streamable HTTP, stateless, JSON responses. build_mcp_asgi() is called once
per create_app(); each call builds a NEW session manager. The SDK overwrites
``mcp.session_manager`` on every build, so it is read here, once, right after
the build — nothing else may read it.
"""

from mcp.server import MCPServer
from mcp.server.streamable_http_manager import StreamableHTTPSessionManager
from mcp.server.transport_security import TransportSecuritySettings
from starlette.types import ASGIApp

from app.core.config import settings

mcp = MCPServer(name="prumo")


def build_mcp_asgi() -> tuple[ASGIApp, StreamableHTTPSessionManager]:
    app = mcp.streamable_http_app(
        streamable_http_path="/mcp",  # the SDK app's own Route matches the outer /mcp Route's path
        stateless_http=True,
        json_response=True,  # SSE would make TimingMiddleware log time-to-first-byte
        transport_security=TransportSecuritySettings(
            allowed_hosts=settings.mcp_allowed_hosts,
            allowed_origins=settings.mcp_allowed_origins,
        ),
    )
    return app, mcp.session_manager
