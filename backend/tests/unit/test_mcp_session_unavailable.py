"""Which failures mean "the database is unavailable" for one /mcp request,
and the per-request mark the auth wrapper turns into a 503."""

import asyncio
from types import SimpleNamespace

import asyncpg
import pytest
from sqlalchemy.exc import DBAPIError, IntegrityError, InterfaceError, OperationalError
from sqlalchemy.exc import TimeoutError as PoolTimeoutError

from app.api.mcp import session as mcp_session


def _invalidated() -> DBAPIError:
    return DBAPIError("SELECT 1", {}, Exception("gone"), connection_invalidated=True)


def _wrapped(cls: type[DBAPIError], cause: BaseException) -> DBAPIError:
    """A driver error as SQLAlchemy's asyncpg dialect raises it: the DBAPI
    adapter error (``orig``) chained ``from`` the asyncpg exception."""
    orig = Exception(str(cause))
    orig.__cause__ = cause
    return cls("SELECT 1", {}, orig)


@pytest.mark.parametrize(
    ("exc", "unavailable"),
    [
        (PoolTimeoutError(), True),
        (_invalidated(), True),
        (ConnectionRefusedError("connection refused"), True),
        (asyncpg.exceptions.TooManyConnectionsError("too many clients"), True),
        (asyncpg.exceptions.CannotConnectNowError("starting up"), True),
        (asyncpg.exceptions.ConnectionDoesNotExistError("closed"), True),
        (_wrapped(OperationalError, asyncpg.exceptions.TooManyConnectionsError("x")), True),
        (_wrapped(InterfaceError, asyncpg.exceptions.ConnectionDoesNotExistError("x")), True),
        (_wrapped(InterfaceError, ConnectionRefusedError("refused")), True),
        (InterfaceError("x", {}, Exception()), False),
        (OperationalError("x", {}, Exception()), False),
        (IntegrityError("x", {}, Exception()), False),
        (asyncpg.exceptions.InterfaceError("another operation is in progress"), False),
        (FileNotFoundError("missing.pdf"), False),
        (PermissionError("denied"), False),
        (OSError("disk"), False),
        (TimeoutError(), False),
        (asyncio.TimeoutError(), False),
        (RuntimeError("bug"), False),
    ],
    ids=[
        "pool-timeout",
        "invalidated",
        "connection-refused",
        "too-many-clients",
        "cannot-connect-now",
        "connection-gone",
        "wrapped-too-many-clients",
        "wrapped-connection-gone",
        "wrapped-connection-refused",
        "interface-no-connection-cause",
        "operational-live-connection",
        "integrity",
        "asyncpg-interface-misuse",
        "file-not-found",
        "permission",
        "os-error",
        "timeout",
        "asyncio-timeout",
        "bug",
    ],
)
def test_is_database_unavailable(exc: BaseException, unavailable: bool) -> None:
    assert mcp_session.is_database_unavailable(exc) is unavailable


async def test_mark_is_scoped_to_the_request(monkeypatch: pytest.MonkeyPatch) -> None:
    class _Ctx:
        async def __aenter__(self) -> SimpleNamespace:
            return SimpleNamespace()

        async def __aexit__(self, *exc: object) -> None:
            return None

    monkeypatch.setattr(mcp_session, "session_factory", _Ctx)

    async with mcp_session.request_session():
        assert mcp_session.database_marked_unavailable() is False
        mcp_session.mark_database_unavailable()
        assert mcp_session.database_marked_unavailable() is True

    async with mcp_session.request_session():
        assert mcp_session.database_marked_unavailable() is False

    mcp_session.mark_database_unavailable()  # outside a request: a no-op
    assert mcp_session.database_marked_unavailable() is False
