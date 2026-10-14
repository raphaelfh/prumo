"""
Rate Limiter.

SlowAPI configuration for rate limiting.

The key function prefers the authenticated principal (Authorization bearer
token) over the remote IP, so multiple users behind the same proxy or local
test workers do not share a single bucket. Falls back to remote IP for
unauthenticated requests.

Counters live in ``settings.RATE_LIMIT_STORAGE_URI`` (Redis in production),
so budgets hold across processes and restarts; unset means per-process
``memory://``. ``hit_shared``/``retry_after`` are the direct (non-decorator)
entry points: when the shared storage raises they fall back to a
per-process memory limiter, failing open across processes during an outage.
"""

import hashlib
import time
from math import ceil

from limits import RateLimitItem
from limits.storage import MemoryStorage
from slowapi import Limiter
from slowapi.util import get_remote_address
from starlette.requests import Request

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
    return f"ip:{get_remote_address(request)}"


_REDIS_TIMEOUTS = {"socket_connect_timeout": 0.5, "socket_timeout": 0.5}


def build_limiter(storage_uri: str | None) -> Limiter:
    """A slowapi ``Limiter`` over ``storage_uri`` (``memory://`` when unset)."""
    uri = storage_uri or "memory://"
    # The scheme only: the URI can carry a password.
    backend = "redis" if uri.split("://", 1)[0].startswith("redis") else "memory"
    built = Limiter(
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
    logger.info("rate_limit_storage_configured", backend=backend)
    return built


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
