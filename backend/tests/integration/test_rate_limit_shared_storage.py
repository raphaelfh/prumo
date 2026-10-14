"""Rate-limit budgets live in shared storage (Redis), not in one process.

Two limiter instances over the same storage URI stand in for two web
processes, and a fresh instance stands in for a restart.
"""

from __future__ import annotations

import os
from uuid import uuid4

import pytest
import redis
from limits import parse

from app.core.config import settings
from app.utils import rate_limiter
from app.utils.rate_limiter import build_limiter, hit_shared


def _redis_reachable(url: str) -> bool:
    try:
        return bool(redis.Redis.from_url(url, socket_connect_timeout=1).ping())
    except redis.RedisError:
        return False


_READ = parse("120/minute")


@pytest.fixture(scope="module")
def redis_uri() -> str:
    """The shared storage URI; a fixture (not a module guard) so collection
    never fails in jobs that deselect these tests (``-m e2e``)."""
    if not _redis_reachable(settings.REDIS_URL):
        if os.environ.get("CI"):
            pytest.fail(f"Redis is required in CI ({settings.REDIS_URL.split('@')[-1]})")
        pytest.skip("Redis not reachable at settings.REDIS_URL")
    return settings.REDIS_URL


def test_two_instances_share_one_budget(monkeypatch: pytest.MonkeyPatch, redis_uri: str) -> None:
    a, b = build_limiter(redis_uri), build_limiter(redis_uri)
    key = ("pat", str(uuid4()))
    for i in range(120):
        monkeypatch.setattr(rate_limiter, "limiter", a if i % 2 else b)
        assert hit_shared(_READ, *key)
    monkeypatch.setattr(rate_limiter, "limiter", a)
    assert hit_shared(_READ, *key) is False  # the 121st hit across both


def test_restart_keeps_hits_inside_the_window(
    monkeypatch: pytest.MonkeyPatch, redis_uri: str
) -> None:
    key = ("pat", str(uuid4()))
    monkeypatch.setattr(rate_limiter, "limiter", build_limiter(redis_uri))
    for _ in range(120):
        hit_shared(_READ, *key)
    monkeypatch.setattr(rate_limiter, "limiter", build_limiter(redis_uri))  # "restart"
    assert hit_shared(_READ, *key) is False
