"""
Rate Limiter.

SlowAPI configuration for rate limiting.

The key function prefers the authenticated principal (Authorization bearer
token) over the remote IP, so multiple users behind the same proxy or local
test workers do not share a single bucket. Falls back to remote IP for
unauthenticated requests. Every per-IP key reads ``client_ip``, which honours
``settings.TRUSTED_CLIENT_IP_HEADER`` behind the hosting proxy.

Counters live in ``settings.RATE_LIMIT_STORAGE_URI`` (Redis in production),
so budgets hold across processes and restarts; unset means per-process
``memory://``. ``hit_shared``/``retry_after`` are the direct (non-decorator)
entry points: when the shared storage raises they fall back to a
per-process memory limiter, failing open across processes during an outage.
``too_many`` wraps them for raw ASGI apps: one hit, then ``None`` or a 429.
"""

import hashlib
import ipaddress
import time
from math import ceil

from limits import RateLimitItem
from limits.storage import MemoryStorage
from slowapi import Limiter
from starlette.datastructures import Headers
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.types import Scope

from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)


def _principal_key(request: Request) -> str:
    """Return a stable rate-limit bucket key per authenticated principal.

    For authenticated requests we hash the Bearer token (truncated SHA-256) so
    different users — and different test workers — get separate buckets without
    leaking the raw token into logs. For anonymous requests we fall back to the
    remote IP so the limiter still throttles abusive callers.
    """

    auth_header = request.headers.get("authorization") or request.headers.get("Authorization")
    if auth_header and auth_header.lower().startswith("bearer "):
        token = auth_header.split(" ", 1)[1].strip()
        if token:
            digest = hashlib.sha256(token.encode("utf-8")).hexdigest()
            return f"token:{digest[:16]}"
    return f"ip:{client_ip(request.scope)}"


_REDIS_TIMEOUTS = {"socket_connect_timeout": 0.5, "socket_timeout": 0.5}


def _backend(storage_uri: str | None) -> str:
    """The storage scheme only: the URI can carry a password."""
    uri = storage_uri or "memory://"
    return "redis" if uri.split("://", 1)[0].startswith("redis") else "memory"


def log_storage_backend(storage_uri: str | None) -> None:
    """Log which counter storage is in use, never the URI. Called at app
    startup, after ``configure_logging``: ``build_limiter`` runs at import,
    where a log line would bypass the JSON renderer."""
    logger.info("rate_limit_storage_configured", backend=_backend(storage_uri))


def build_limiter(storage_uri: str | None) -> Limiter:
    """A slowapi ``Limiter`` over ``storage_uri`` (``memory://`` when unset)."""
    uri = storage_uri or "memory://"
    backend = _backend(uri)
    return Limiter(
        key_func=_principal_key,
        default_limits=[f"{settings.RATE_LIMIT_PER_MINUTE}/minute"],
        storage_uri=uri,
        # The limits client is synchronous and runs on the event loop: a
        # hanging Redis must fail fast into the per-process fallback.
        # slowapi annotates Dict[str, str] but forwards these as kwargs to
        # limits.storage_from_string (float | str | bool); redis-py needs
        # numeric timeouts, so the stub is narrower than the real contract.
        storage_options=_REDIS_TIMEOUTS if backend == "redis" else {},  # type: ignore[arg-type]
        key_prefix="prumo-rl",
        in_memory_fallback_enabled=True,
    )


limiter = build_limiter(settings.RATE_LIMIT_STORAGE_URI)

# Same strategy class as the shared limiter, over per-process memory.
_fallback = type(limiter.limiter)(MemoryStorage())
_storage_down = False


def _storage_failed(exc: Exception) -> None:
    global _storage_down
    if not _storage_down:
        _storage_down = True
        logger.warning("rate_limit_storage_unavailable", error_type=type(exc).__name__)


def _storage_ok() -> None:
    global _storage_down
    _storage_down = False


def hit_shared(limit: RateLimitItem, *keys: str) -> bool:
    """Consume one unit of ``limit`` for ``keys``; ``False`` when it is exhausted."""
    try:
        allowed = limiter.limiter.hit(limit, *keys)
    except Exception as exc:  # noqa: BLE001 - any storage failure fails open to memory
        _storage_failed(exc)
        return _fallback.hit(limit, *keys)
    _storage_ok()
    return allowed


def retry_after(limit: RateLimitItem, *keys: str) -> int:
    """Whole seconds (at least 1) until ``limit``'s window for ``keys`` resets."""
    try:
        stats = limiter.limiter.get_window_stats(limit, *keys)
    except Exception as exc:  # noqa: BLE001 - any storage failure fails open to memory
        _storage_failed(exc)
        stats = _fallback.get_window_stats(limit, *keys)
    else:
        _storage_ok()
    return max(1, ceil(stats.reset_time - time.time()))


def client_ip(scope: Scope) -> str:
    """The caller's IP: the ``TRUSTED_CLIENT_IP_HEADER`` value when that setting
    is on and the header holds one IP literal, else the ASGI scope's client
    host, or ``"unknown"`` when the server gave none."""
    name = (settings.TRUSTED_CLIENT_IP_HEADER or "").strip()
    if name:
        try:
            return str(ipaddress.ip_address(Headers(scope=scope).get(name, "").strip()))
        except ValueError:
            pass  # absent or not one IP literal: never an attacker-chosen key
    client = scope.get("client")
    return client[0] if client else "unknown"


def too_many(limit: RateLimitItem, *keys: str) -> Response | None:
    """Consume one unit of ``limit`` for ``keys``: ``None`` while allowed, else a
    429 JSON response carrying ``Retry-After``."""
    if hit_shared(limit, *keys):
        return None
    return JSONResponse(
        {"error": "too_many_requests"},
        status_code=429,
        headers={"Retry-After": str(retry_after(limit, *keys))},
    )
