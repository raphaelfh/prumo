"""
Contract tests for the SAVEPOINT-isolated ``db_session`` fixture.

If any of these fail, every integration test that uses ``db_session`` is
suspect. Treat this file as the executable definition of what
``db_session`` guarantees.

Design notes:
- We DDL into a per-test table so the contract test does not couple to
  the app schema. ``CREATE TABLE`` inside a Postgres transaction is
  rolled back along with the rest, so the table disappears with the
  outer ``ROLLBACK`` at teardown.
- The "parallel-connection cannot see the data" assertion exercises both
  Postgres transaction isolation AND the SAVEPOINT property in one
  observation: if the outer transaction had committed (or the fixture
  forgot to ``BEGIN``), the fresh connection would see the row.
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.exc import ProgrammingError
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession

pytestmark = pytest.mark.asyncio


async def test_inner_commit_visible_to_same_session(db_session: AsyncSession) -> None:
    """A commit inside the test is immediately visible to the same session."""
    table = f"_probe_{uuid.uuid4().hex[:12]}"
    marker = uuid.uuid4().hex

    await db_session.execute(text(f'CREATE TABLE "{table}" (marker text PRIMARY KEY)'))
    await db_session.execute(
        text(f'INSERT INTO "{table}" (marker) VALUES (:m)'),
        {"m": marker},
    )
    await db_session.commit()

    result = await db_session.execute(
        text(f'SELECT marker FROM "{table}" WHERE marker = :m'),
        {"m": marker},
    )
    assert result.scalar_one() == marker


async def test_savepoint_isolation_from_other_connection(
    db_session: AsyncSession,
    _engine: AsyncEngine,
) -> None:
    """
    A row committed inside ``db_session`` must NOT be visible to a fresh
    connection that opens its own transaction.

    This is the load-bearing test for cross-test isolation: if it passes,
    the outer transaction is uncommitted, which means rollback at teardown
    will erase everything inner ``commit()`` calls produced.
    """
    table = f"_probe_{uuid.uuid4().hex[:12]}"
    marker = uuid.uuid4().hex

    await db_session.execute(text(f'CREATE TABLE "{table}" (marker text PRIMARY KEY)'))
    await db_session.execute(
        text(f'INSERT INTO "{table}" (marker) VALUES (:m)'),
        {"m": marker},
    )
    await db_session.commit()

    async with _engine.connect() as fresh_conn:
        # The table itself was created inside the uncommitted outer
        # transaction, so the fresh connection cannot even see it.
        # ``ProgrammingError: relation "_probe_..." does not exist`` is
        # the positive signal — it proves the outer transaction stays
        # uncommitted.
        with pytest.raises(ProgrammingError):
            await fresh_conn.execute(text(f'SELECT 1 FROM "{table}"'))


async def test_multiple_inner_commits_keep_session_alive(
    db_session: AsyncSession,
) -> None:
    """
    The ``after_transaction_end`` hook re-opens a fresh SAVEPOINT after
    every inner commit, so a test can call ``commit()`` repeatedly without
    the outer transaction collapsing.
    """
    table = f"_probe_{uuid.uuid4().hex[:12]}"
    marker_base = uuid.uuid4().hex

    await db_session.execute(text(f'CREATE TABLE "{table}" (marker text PRIMARY KEY)'))

    for i in range(3):
        await db_session.execute(
            text(f'INSERT INTO "{table}" (marker) VALUES (:m)'),
            {"m": f"{marker_base}-{i}"},
        )
        await db_session.commit()

    result = await db_session.execute(
        text(f'SELECT COUNT(*) FROM "{table}" WHERE marker LIKE :p'),
        {"p": f"{marker_base}-%"},
    )
    assert result.scalar_one() == 3


async def test_db_session_real_actually_commits(
    db_session_real: AsyncSession,
    _engine: AsyncEngine,
) -> None:
    """
    Sanity check: ``db_session_real`` writes survive a fresh connection
    in another transaction. We clean up explicitly because this fixture
    does not roll back.
    """
    table = f"_probe_real_{uuid.uuid4().hex[:12]}"
    marker = uuid.uuid4().hex

    try:
        await db_session_real.execute(text(f'CREATE TABLE "{table}" (marker text PRIMARY KEY)'))
        await db_session_real.execute(
            text(f'INSERT INTO "{table}" (marker) VALUES (:m)'),
            {"m": marker},
        )
        await db_session_real.commit()

        async with _engine.connect() as fresh_conn:
            result = await fresh_conn.execute(
                text(f'SELECT marker FROM "{table}" WHERE marker = :m'),
                {"m": marker},
            )
            assert result.scalar_one() == marker
    finally:
        # Real commits leak by design; the contract is that the test
        # cleans up after itself.
        await db_session_real.execute(text(f'DROP TABLE IF EXISTS "{table}"'))
        await db_session_real.commit()
