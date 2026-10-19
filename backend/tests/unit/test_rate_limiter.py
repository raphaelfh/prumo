"""The rate-limit helpers fail open, per process, when shared storage is down."""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path
from unittest.mock import Mock
from uuid import uuid4

import pytest
from limits import parse
from structlog.testing import capture_logs

from app.utils import rate_limiter
from app.utils.rate_limiter import (
    build_limiter,
    client_ip,
    hit_shared,
    log_storage_backend,
    retry_after,
    too_many,
)

_READ = parse("120/minute")
_TIGHT = parse("1/minute")


@pytest.fixture(autouse=True)
def _fresh_outage_state(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(rate_limiter, "_storage_down", False)
    rate_limiter._fallback.storage.reset()


def _broken(monkeypatch: pytest.MonkeyPatch):
    broken = build_limiter("memory://")
    monkeypatch.setattr(broken.limiter, "hit", Mock(side_effect=ConnectionError("down")))
    monkeypatch.setattr(
        broken.limiter, "get_window_stats", Mock(side_effect=ConnectionError("down"))
    )
    monkeypatch.setattr(rate_limiter, "limiter", broken)
    return broken


def test_storage_failure_falls_back_with_one_warning(monkeypatch: pytest.MonkeyPatch) -> None:
    _broken(monkeypatch)
    with capture_logs() as logs:
        assert hit_shared(_READ, "pat", "x") and hit_shared(_READ, "pat", "x")
    warnings = [e for e in logs if e["event"] == "rate_limit_storage_unavailable"]
    assert len(warnings) == 1
    assert warnings[0]["error_type"] == "ConnectionError"


def test_fallback_still_enforces_the_limit_per_process(monkeypatch: pytest.MonkeyPatch) -> None:
    _broken(monkeypatch)
    assert hit_shared(_TIGHT, "pat", "y") is True
    assert hit_shared(_TIGHT, "pat", "y") is False
    assert 1 <= retry_after(_TIGHT, "pat", "y") <= 60


def test_a_new_outage_after_recovery_warns_again(monkeypatch: pytest.MonkeyPatch) -> None:
    broken = _broken(monkeypatch)
    healthy = build_limiter("memory://")
    with capture_logs() as logs:
        hit_shared(_READ, "pat", "z")  # outage 1
        monkeypatch.setattr(rate_limiter, "limiter", healthy)
        hit_shared(_READ, "pat", "z")  # recovered
        monkeypatch.setattr(rate_limiter, "limiter", broken)
        hit_shared(_READ, "pat", "z")  # outage 2
    events = [e["event"] for e in logs]
    assert events.count("rate_limit_storage_unavailable") == 2


def test_retry_after_is_at_least_one_second(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(rate_limiter, "limiter", build_limiter("memory://"))
    assert hit_shared(_TIGHT, "pat", "w") is True
    assert hit_shared(_TIGHT, "pat", "w") is False
    assert 1 <= retry_after(_TIGHT, "pat", "w") <= 60


@pytest.mark.parametrize(
    ("uri", "backend"),
    [
        (None, "memory"),
        ("memory://", "memory"),
        ("redis://u:s3cret@redis.internal:6379/0", "redis"),
    ],
    ids=["unset", "memory", "redis"],
)
def test_log_storage_backend_logs_the_backend_never_the_uri(uri: str | None, backend: str) -> None:
    with capture_logs() as logs:
        log_storage_backend(uri)
    assert logs == [
        {"event": "rate_limit_storage_configured", "backend": backend, "log_level": "info"}
    ]
    assert "s3cret" not in repr(logs)


def test_build_limiter_logs_nothing() -> None:
    """It runs at import, before ``configure_logging``: a log there is a
    non-JSON stdout line. The backend is logged at app startup instead."""
    with capture_logs() as logs:
        built = build_limiter("redis://u:s3cret@redis.internal:6379/0")
    assert logs == []
    assert built._key_prefix == "prumo-rl"


def test_importing_the_module_writes_nothing_to_stdout() -> None:
    result = subprocess.run(
        [sys.executable, "-c", "import app.utils.rate_limiter"],
        capture_output=True,
        text=True,
        env={**os.environ},
        cwd=Path(__file__).resolve().parents[2],
        check=True,
    )
    assert result.stdout == ""


def test_storage_uri_defaults_unset() -> None:
    from app.core.config import Settings

    assert Settings.model_fields["RATE_LIMIT_STORAGE_URI"].default is None
    assert Settings.model_fields["REDIS_URL"].default == "redis://localhost:6379/0"


def test_redis_storage_has_short_socket_timeouts() -> None:
    built = build_limiter("redis://localhost:6390/0")
    kwargs = built._storage.storage.connection_pool.connection_kwargs
    assert 0 < kwargs["socket_connect_timeout"] <= 1
    assert 0 < kwargs["socket_timeout"] <= 1


def test_too_many_is_none_while_allowed_then_a_429(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(rate_limiter, "limiter", build_limiter("memory://"))
    bucket = f"t-{uuid4()}"
    assert too_many(_TIGHT, bucket, "k") is None

    refused = too_many(_TIGHT, bucket, "k")
    assert refused is not None
    assert refused.status_code == 429
    assert refused.body == b'{"error":"too_many_requests"}'
    assert 1 <= int(refused.headers["retry-after"]) <= 60


@pytest.mark.parametrize(
    ("scope", "expected"),
    [({"client": ("5.6.7.8", 9)}, "5.6.7.8"), ({}, "unknown"), ({"client": None}, "unknown")],
    ids=["client", "no-client-key", "client-none"],
)
def test_client_ip(scope: dict, expected: str) -> None:
    assert client_ip(scope) == expected  # type: ignore[arg-type]
