"""The one queue availability probe every enqueueing endpoint asks."""

from __future__ import annotations

from unittest.mock import patch

from app.worker import queue_health


def test_queue_is_available_when_the_ping_answers() -> None:
    with patch.object(queue_health, "Redis") as redis_cls:
        redis_cls.from_url.return_value.ping.return_value = True
        assert queue_health.is_queue_available() is True
    kwargs = redis_cls.from_url.call_args.kwargs
    assert kwargs == {"socket_connect_timeout": 0.25, "socket_timeout": 0.25}


def test_queue_is_unavailable_when_the_ping_raises() -> None:
    with patch.object(queue_health, "Redis") as redis_cls:
        redis_cls.from_url.return_value.ping.side_effect = ConnectionError("down")
        assert queue_health.is_queue_available() is False
