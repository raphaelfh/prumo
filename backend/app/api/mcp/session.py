"""Injectable DB-session and storage factories for the /mcp mount (spec §3).

One session per tool call. Tests rebind ``session_factory`` to the test's
SAVEPOINT connection; ``db_client`` overrides only ``get_db``, so without this
module tools would read outside the seed and commit for real. Read both
factories through the module, never by ``from … import``.
"""

from collections.abc import Callable

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.deps import AsyncSessionLocal, get_supabase_client
from app.core.factories import create_storage_adapter
from app.infrastructure.storage import StorageAdapter

session_factory: async_sessionmaker[AsyncSession] = AsyncSessionLocal


def _fresh_storage_adapter() -> StorageAdapter:
    """A new adapter per call; never cached (the app/core/deps.py event-loop note)."""
    return create_storage_adapter(get_supabase_client())


storage_factory: Callable[[], StorageAdapter] = _fresh_storage_adapter
