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

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.deps import AsyncSessionLocal, get_supabase_client
from app.core.factories import create_storage_adapter
from app.infrastructure.storage import StorageAdapter

session_factory: async_sessionmaker[AsyncSession] = AsyncSessionLocal

_request_session: ContextVar[AsyncSession] = ContextVar("mcp_request_session")


@asynccontextmanager
async def request_session() -> AsyncIterator[AsyncSession]:
    """Open THE session of one /mcp request and bind it for ``current_session()``.

    Reads ``session_factory`` at call time, so a test's rebinding applies.
    Closing it discards whatever a tool left uncommitted.
    """
    async with session_factory() as db:
        token = _request_session.set(db)
        try:
            yield db
        finally:
            _request_session.reset(token)


def current_session() -> AsyncSession:
    """The one session of the current /mcp request; ``LookupError`` outside one."""
    return _request_session.get()


def _fresh_storage_adapter() -> StorageAdapter:
    """A new adapter per call; never cached (the app/core/deps.py event-loop note)."""
    return create_storage_adapter(get_supabase_client())


storage_factory: Callable[[], StorageAdapter] = _fresh_storage_adapter
