"""Session/storage factory injection tests for /mcp (spec §3, §8, task 2a).

Proves mcp_session.session_factory can be rebound to the test's SAVEPOINT
connection (default, via the autouse bind_mcp_session_factory fixture) or to
its own NullPool connections (@pytest.mark.mcp_real_sessions), and that the
production defaults are the real app.core.deps singletons.
"""

from unittest.mock import MagicMock

import pytest
from sqlalchemy import text

from app.api.mcp import session as mcp_session
from app.core.deps import AsyncSessionLocal
from tests.integration.conftest import SEED


async def test_factory_session_joins_the_test_transaction(db_session) -> None:  # type: ignore[no-untyped-def]
    await db_session.execute(
        text("UPDATE public.projects SET name = 'mcp-binding-probe' WHERE id = :p"),
        {"p": str(SEED.primary_project)},
    )

    async with mcp_session.session_factory() as s:
        result = await s.execute(
            text("SELECT name FROM public.projects WHERE id = :p"), {"p": str(SEED.primary_project)}
        )
        assert result.scalar_one() == "mcp-binding-probe"

        factory_pid = (await s.execute(text("SELECT pg_backend_pid()"))).scalar_one()

    db_session_pid = (await db_session.execute(text("SELECT pg_backend_pid()"))).scalar_one()
    assert factory_pid == db_session_pid


@pytest.mark.mcp_real_sessions
async def test_marked_test_gets_its_own_connections() -> None:
    async with mcp_session.session_factory() as s1, mcp_session.session_factory() as s2:
        pid1 = (await s1.execute(text("SELECT pg_backend_pid()"))).scalar_one()
        pid2 = (await s2.execute(text("SELECT pg_backend_pid()"))).scalar_one()

    assert pid1 != pid2


def test_default_factories_are_the_production_ones(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.undo()
    assert mcp_session.session_factory is AsyncSessionLocal

    monkeypatch.setattr(mcp_session, "get_supabase_client", lambda: MagicMock())
    first = mcp_session.storage_factory()
    second = mcp_session.storage_factory()
    assert first is not second
