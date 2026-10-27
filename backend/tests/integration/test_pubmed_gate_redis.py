"""The efetch throttle gate on a real Redis: separate clients share one budget.

Two ``RedisIntervalGate`` instances over separate connections stand in for
two worker processes.
"""

from __future__ import annotations

import asyncio
import os
import time

import pytest
import redis
from redis.asyncio import Redis

from app.core.config import settings
from app.services.pubmed_client import MIN_REQUEST_INTERVAL_S, RedisIntervalGate


@pytest.fixture(scope="module")
def redis_uri() -> str:
    try:
        reachable = bool(redis.Redis.from_url(settings.REDIS_URL, socket_connect_timeout=1).ping())
    except redis.RedisError:
        reachable = False
    if not reachable:
        if os.environ.get("CI"):
            pytest.fail(f"Redis is required in CI ({settings.REDIS_URL.split('@')[-1]})")
        pytest.skip("Redis not reachable at settings.REDIS_URL")
    return settings.REDIS_URL


async def test_two_processes_start_requests_one_interval_apart(redis_uri: str) -> None:
    a, b = Redis.from_url(redis_uri), Redis.from_url(redis_uri)
    starts: list[float] = []

    async def request(gate: RedisIntervalGate) -> None:
        async with gate.slot():
            starts.append(time.monotonic())

    try:
        await asyncio.gather(
            request(RedisIntervalGate(a)),
            request(RedisIntervalGate(b)),
            request(RedisIntervalGate(a)),
        )
    finally:
        await a.aclose()
        await b.aclose()

    starts.sort()
    gaps = [later - earlier for earlier, later in zip(starts, starts[1:], strict=False)]
    assert len(gaps) == 2
    assert all(gap >= MIN_REQUEST_INTERVAL_S - 0.01 for gap in gaps), gaps
