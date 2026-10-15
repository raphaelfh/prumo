"""Direct unit tests of ``server._dispatch``'s error mapping (no DB, no httpx).

Only database unavailability becomes the retryable "database busy" result; a
tool's own I/O or timeout failure is an INTERNAL_ERROR logged with its
traceback. A rollback that itself fails never replaces the original mapping.
"""

from __future__ import annotations

import asyncio
from collections.abc import Iterator
from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import asyncpg
import pytest
from sqlalchemy.exc import TimeoutError as PoolTimeoutError

from app.api.mcp import asgi_auth, server
from app.api.mcp import session as mcp_session
from app.schemas.mcp_auth import McpPrincipal

_RULE = server._ToolRule(requires="read", project_arg=None)


class _Recorder:
    def __init__(self) -> None:
        self.warnings: list[str] = []
        self.exceptions: list[str] = []

    def warning(self, event: str, **_kw: object) -> None:
        self.warnings.append(event)

    def exception(self, event: str, **_kw: object) -> None:
        self.exceptions.append(event)


@pytest.fixture
def recorder(monkeypatch: pytest.MonkeyPatch) -> _Recorder:
    rec = _Recorder()
    monkeypatch.setattr(server, "logger", rec)
    monkeypatch.setattr(server, "hit_shared", lambda *_a: True)
    return rec


@pytest.fixture(autouse=True)
def _principal() -> Iterator[None]:
    reset = asgi_auth.principal_var.set(
        McpPrincipal(
            user_sub=uuid4(),
            token_id=uuid4(),
            scope="read",
            token_expires_at=datetime(2099, 1, 1, tzinfo=UTC),
            project_ids=None,
        )
    )
    yield
    asgi_auth.principal_var.reset(reset)


def _bind_session(monkeypatch: pytest.MonkeyPatch, rollback: AsyncMock) -> None:
    class _Ctx:
        async def __aenter__(self) -> SimpleNamespace:
            return SimpleNamespace(rollback=rollback)

        async def __aexit__(self, *exc: object) -> None:
            return None

    monkeypatch.setattr(mcp_session, "session_factory", _Ctx)


async def _call(exc: BaseException) -> tuple[object, bool]:
    async def tool(_db: object) -> None:
        raise exc

    async with mcp_session.request_session():
        result = await server._dispatch("t", _RULE, tool, {})
        marked = mcp_session.database_marked_unavailable()
    return result, marked


@pytest.mark.parametrize(
    "exc",
    [FileNotFoundError("a.pdf"), PermissionError("denied"), asyncio.TimeoutError()],
    ids=["file-not-found", "permission", "asyncio-timeout"],
)
async def test_a_tool_io_or_timeout_failure_is_an_internal_error(
    monkeypatch: pytest.MonkeyPatch, recorder: _Recorder, exc: BaseException
) -> None:
    _bind_session(monkeypatch, AsyncMock())

    result, marked = await _call(exc)

    assert result.structured_content["code"] == "INTERNAL_ERROR"  # type: ignore[attr-defined]
    assert marked is False
    assert recorder.exceptions == ["mcp_tool_internal_error"]
    assert recorder.warnings == []


@pytest.mark.parametrize(
    "exc",
    [PoolTimeoutError(), asyncpg.exceptions.TooManyConnectionsError("too many clients")],
    ids=["pool-timeout", "too-many-clients"],
)
async def test_database_unavailability_is_a_retry(
    monkeypatch: pytest.MonkeyPatch, recorder: _Recorder, exc: BaseException
) -> None:
    _bind_session(monkeypatch, AsyncMock())

    result, marked = await _call(exc)

    body = result.structured_content  # type: ignore[attr-defined]
    assert body["code"] == "RATE_LIMITED"
    assert body["retry_after_seconds"] == 2
    assert marked is True
    assert recorder.exceptions == []


@pytest.mark.parametrize(
    ("exc", "code", "marked_expected"),
    [(PoolTimeoutError(), "RATE_LIMITED", True), (RuntimeError("bug"), "INTERNAL_ERROR", False)],
    ids=["unavailable", "bug"],
)
async def test_a_failing_rollback_keeps_the_original_mapping(
    monkeypatch: pytest.MonkeyPatch,
    recorder: _Recorder,
    exc: BaseException,
    code: str,
    marked_expected: bool,
) -> None:
    _bind_session(monkeypatch, AsyncMock(side_effect=PoolTimeoutError()))

    result, marked = await _call(exc)

    assert result.structured_content["code"] == code  # type: ignore[attr-defined]
    assert marked is marked_expected
    assert "mcp_tool_rollback_failed" in recorder.warnings
