"""OAuth 2.1 for ``/mcp`` with prumo as the authorization server (ADR 0022).

Mounted only when ``settings.oauth_enabled`` (``PUBLIC_API_URL`` set): the
discovery documents and the authorization-server routes, each rate-limited
through ``asgi.Limited``.
"""
