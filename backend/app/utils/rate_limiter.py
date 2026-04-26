"""
Rate Limiter.

Configuracao do SlowAPI for rate limiting.

The key function prefers the authenticated principal (Authorization bearer
token) over the remote IP, so multiple users behind the same proxy or local
test workers do not share a single bucket. Falls back to remote IP for
unauthenticated requests.
"""

import hashlib

from slowapi import Limiter
from slowapi.util import get_remote_address
from starlette.requests import Request

from app.core.config import settings


def _principal_key(request: Request) -> str:
    """Return a stable rate-limit bucket key per authenticated principal.

    For authenticated requests we hash the Bearer token (truncated SHA-256) so
    different users — and different test workers — get separate buckets without
    leaking the raw token into logs. For anonymous requests we fall back to the
    remote IP so the limiter still throttles abusive callers.
    """

    auth_header = request.headers.get("authorization") or request.headers.get(
        "Authorization"
    )
    if auth_header and auth_header.lower().startswith("bearer "):
        token = auth_header.split(" ", 1)[1].strip()
        if token:
            digest = hashlib.sha256(token.encode("utf-8")).hexdigest()
            return f"token:{digest[:16]}"
    return f"ip:{get_remote_address(request)}"


limiter = Limiter(
    key_func=_principal_key,
    default_limits=[f"{settings.RATE_LIMIT_PER_MINUTE}/minute"],
)
