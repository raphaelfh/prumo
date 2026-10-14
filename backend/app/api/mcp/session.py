"""Injectable DB-session and storage factories for the /mcp mount (spec §3).

One session per /mcp request: ``request_session()`` opens it (principal
lookup, last-used touch and the tool call all run on it) and binds it for
``current_session()``. Tests rebind ``session_factory`` to the test's
SAVEPOINT connection; ``db_client`` overrides only ``get_db``, so without this
module tools would read outside the seed and commit for real. Read both
factories through the module, never by ``from … import``.
"""

from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager
from contextvars import ContextVar
from dataclasses import dataclass

import asyncpg
from sqlalchemy.exc import DBAPIError, InterfaceError
from sqlalchemy.exc import TimeoutError as PoolTimeoutError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.deps import AsyncSessionLocal, get_supabase_client
from app.core.factories import create_storage_adapter
from app.infrastructure.storage import StorageAdapter

session_factory: async_sessionmaker[AsyncSession] = AsyncSessionLocal

# Failures that mean "no usable connection", not a bug: a pool checkout that
# timed out, a dropped or refused connection, a server refusing new clients.
# asyncpg's connect-time errors reach us raw, not wrapped in a DBAPIError.
_UNAVAILABLE: tuple[type[BaseException], ...] = (
    PoolTimeoutError,
    InterfaceError,
    OSError,
    TimeoutError,
    asyncpg.exceptions.TooManyConnectionsError,
    asyncpg.exceptions.CannotConnectNowError,
    asyncpg.exceptions.PostgresConnectionError,
    asyncpg.exceptions.InterfaceError,
)


@dataclass
class _RequestBinding:
    """Mutable on purpose: the SDK runs the tool in a task holding a COPY of
    the request's context, so a flag must be set on this shared object."""

    db: AsyncSession
    database_unavailable: bool = False


_request: ContextVar[_RequestBinding] = ContextVar("mcp_request")


@asynccontextmanager
async def request_session() -> AsyncIterator[AsyncSession]:
    """Open THE session of one /mcp request and bind it for ``current_session()``.

    Reads ``session_factory`` at call time, so a test's rebinding applies.
    Closing it discards whatever a tool left uncommitted.
    """
    async with session_factory() as db:
        token = _request.set(_RequestBinding(db))
        try:
            yield db
        finally:
            _request.reset(token)


def current_session() -> AsyncSession:
    """The one session of the current /mcp request; ``LookupError`` outside one."""
    return _request.get().db


def is_database_unavailable(exc: BaseException) -> bool:
    """True when ``exc`` means the database could not serve the call (retry
    later), never for a query or data error on a live connection."""
    if isinstance(exc, DBAPIError) and exc.connection_invalidated:
        return True
    return isinstance(exc, _UNAVAILABLE)


def mark_database_unavailable() -> None:
    """Flag the current /mcp request so the auth wrapper answers 503; a no-op
    outside a request (the in-memory test client has no HTTP response)."""
    binding = _request.get(None)
    if binding is not None:
        binding.database_unavailable = True


def database_marked_unavailable() -> bool:
    binding = _request.get(None)
    return binding is not None and binding.database_unavailable


def _fresh_storage_adapter() -> StorageAdapter:
    """A new adapter per call; never cached (the app/core/deps.py event-loop note)."""
    return create_storage_adapter(get_supabase_client())


storage_factory: Callable[[], StorageAdapter] = _fresh_storage_adapter
