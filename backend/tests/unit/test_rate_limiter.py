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
from starlette.requests import Request
from structlog.testing import capture_logs

from app.core.config import settings
from app.utils import rate_limiter
from app.utils.rate_limiter import (
    _principal_key,
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


def _peer(headers: list[tuple[bytes, bytes]] | None = None) -> dict:
    return {"type": "http", "headers": headers or [], "client": ("10.0.0.1", 9)}


_SPOOFED = [(b"x-real-ip", b"203.0.113.7")]


def test_client_ip_ignores_forwarding_headers_by_default(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "TRUSTED_CLIENT_IP_HEADER", None)
    assert client_ip(_peer(_SPOOFED)) == "10.0.0.1"  # type: ignore[arg-type]


@pytest.mark.parametrize("name", ["X-Real-IP", "x-real-ip", " X-Real-IP "])
def test_client_ip_reads_the_trusted_header(monkeypatch: pytest.MonkeyPatch, name: str) -> None:
    monkeypatch.setattr(settings, "TRUSTED_CLIENT_IP_HEADER", name)
    assert client_ip(_peer(_SPOOFED)) == "203.0.113.7"  # type: ignore[arg-type]


def test_client_ip_normalizes_an_ipv6_header(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "TRUSTED_CLIENT_IP_HEADER", "X-Real-IP")
    scope = _peer([(b"x-real-ip", b" 2001:DB8::0001 ")])
    assert client_ip(scope) == "2001:db8::1"  # type: ignore[arg-type]


@pytest.mark.parametrize(
    "headers",
    [
        [],
        [(b"x-real-ip", b"")],
        [(b"x-real-ip", b"not-an-ip")],
        [(b"x-real-ip", b"1.2.3.4, 5.6.7.8")],
    ],
    ids=["absent", "empty", "garbage", "list"],
)
def test_client_ip_falls_back_to_the_peer_on_a_bad_header(
    monkeypatch: pytest.MonkeyPatch, headers: list
) -> None:
    """A header that is not one IP literal never becomes a bucket key."""
    monkeypatch.setattr(settings, "TRUSTED_CLIENT_IP_HEADER", "X-Real-IP")
    assert client_ip(_peer(headers)) == "10.0.0.1"  # type: ignore[arg-type]


def test_client_ip_blank_setting_is_off(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "TRUSTED_CLIENT_IP_HEADER", "  ")
    assert client_ip(_peer(_SPOOFED)) == "10.0.0.1"  # type: ignore[arg-type]


def test_trusted_header_defaults_unset() -> None:
    from app.core.config import Settings

    assert Settings.model_fields["TRUSTED_CLIENT_IP_HEADER"].default is None


def test_principal_key_anonymous_uses_client_ip(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "TRUSTED_CLIENT_IP_HEADER", "X-Real-IP")
    assert _principal_key(Request(_peer(_SPOOFED))) == "ip:203.0.113.7"  # type: ignore[arg-type]
    monkeypatch.setattr(settings, "TRUSTED_CLIENT_IP_HEADER", None)
    assert _principal_key(Request(_peer(_SPOOFED))) == "ip:10.0.0.1"  # type: ignore[arg-type]


def test_principal_key_bearer_ignores_the_ip(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "TRUSTED_CLIENT_IP_HEADER", "X-Real-IP")
    request = Request(_peer([*_SPOOFED, (b"authorization", b"Bearer abc")]))  # type: ignore[arg-type]
    assert _principal_key(request).startswith("token:")
