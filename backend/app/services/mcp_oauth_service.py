"""OAuth for ``/mcp``: the authorization server's domain rules (ADR 0022)."""

from __future__ import annotations

# The granting scopes: what a connection can hold (``read`` / ``read_write``).
OAUTH_SCOPES: tuple[str, ...] = ("read", "write")

# A no-op marker: accepted at registration and authorize so hosts that ask for
# refresh tokens by scope can connect; never granted (refresh tokens are always
# issued).
OFFLINE_ACCESS = "offline_access"
