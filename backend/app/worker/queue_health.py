"""The one queue availability probe: every endpoint that enqueues asks it first."""

from __future__ import annotations

from redis import Redis

from app.core.config import settings


def is_queue_available() -> bool:
    """True when the broker answers a ping within a quarter second."""
    try:
        Redis.from_url(
            settings.REDIS_URL,
            socket_connect_timeout=0.25,
            socket_timeout=0.25,
        ).ping()
        return True
    except Exception:
        return False
