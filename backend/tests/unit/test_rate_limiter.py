"""The rate-limit helpers fail open, per process, when shared storage is down."""

from __future__ import annotations

from unittest.mock import Mock

import pytest
from limits import parse
from structlog.testing import capture_logs

from app.utils import rate_limiter
from app.utils.rate_limiter import build_limiter, hit_shared, retry_after

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
    events = [e["event"] for e in logs]
    assert events.count("rate_limit_storage_unavailable") == 1


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
def test_build_limiter_logs_the_backend_never_the_uri(uri: str | None, backend: str) -> None:
    with capture_logs() as logs:
        built = build_limiter(uri)
    entry = next(e for e in logs if e["event"] == "rate_limit_storage_configured")
    assert entry["backend"] == backend
    assert "s3cret" not in repr(logs)
    assert built._key_prefix == "prumo-rl"


def test_storage_uri_defaults_unset() -> None:
    from app.core.config import Settings

    assert Settings.model_fields["RATE_LIMIT_STORAGE_URI"].default is None
    assert Settings.model_fields["REDIS_URL"].default == "redis://localhost:6379/0"
