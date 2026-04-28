"""Integration test: alembic migrations are reversible end-to-end.

Drives ``alembic downgrade -1 → upgrade head`` against the live dev DB
to verify that ``0002_drop_extracted_values`` (and any future migration
on top of the squash baseline) round-trips without leaving the schema
in a different state than where it started.

Skipped automatically if the DB is unreachable (e.g., CI without
Supabase boot)."""

import subprocess
from pathlib import Path

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

# Repo root is two levels up from this file; alembic must run with cwd=backend/
_BACKEND_DIR = Path(__file__).resolve().parents[2]


def _run_alembic(*args: str) -> str:
    """Run ``uv run alembic <args>`` synchronously from backend/."""
    proc = subprocess.run(
        ["uv", "run", "alembic", *args],
        cwd=str(_BACKEND_DIR),
        capture_output=True,
        text=True,
        check=False,
    )
    if proc.returncode != 0:
        raise RuntimeError(
            f"alembic {' '.join(args)} failed:\n"
            f"stdout: {proc.stdout}\nstderr: {proc.stderr}"
        )
    return proc.stdout


@pytest.mark.asyncio
async def test_migration_0002_round_trip(db_session: AsyncSession) -> None:
    """Downgrade one revision then upgrade to head; assert the dropped
    objects are restored mid-trip and re-removed by the time we're back
    at head.

    This exercises both branches of ``0002_drop_extracted_values.upgrade``
    and ``downgrade``, which protects against silent schema drift between
    fresh ``alembic upgrade head`` runs (used in CI) and the one we
    captured in ``baseline_v1.sql``.
    """
    pre = (
        await db_session.execute(
            text(
                "SELECT 1 FROM information_schema.tables "
                "WHERE table_schema='public' AND table_name='extracted_values'"
            )
        )
    ).scalar()
    assert pre is None, "extracted_values must be absent at HEAD"

    _run_alembic("downgrade", "-1")
    try:
        # After downgrade -1 the legacy table + enum should exist.
        await db_session.commit()
        post_down = (
            await db_session.execute(
                text(
                    "SELECT 1 FROM information_schema.tables "
                    "WHERE table_schema='public' AND table_name='extracted_values'"
                )
            )
        ).scalar()
        assert post_down == 1, "extracted_values must be restored by downgrade"

        enum_row = (
            await db_session.execute(
                text(
                    "SELECT 1 FROM pg_type WHERE typname = 'extraction_source'"
                )
            )
        ).scalar()
        assert enum_row == 1, "extraction_source enum must be restored by downgrade"
    finally:
        _run_alembic("upgrade", "head")

    await db_session.commit()
    after = (
        await db_session.execute(
            text(
                "SELECT 1 FROM information_schema.tables "
                "WHERE table_schema='public' AND table_name='extracted_values'"
            )
        )
    ).scalar()
    assert after is None, "extracted_values must be re-dropped after upgrade head"

    enum_after = (
        await db_session.execute(
            text("SELECT 1 FROM pg_type WHERE typname = 'extraction_source'")
        )
    ).scalar()
    assert enum_after is None, "extraction_source enum must be re-dropped"


@pytest.mark.asyncio
async def test_alembic_head_is_expected_revision() -> None:
    """Pin the head revision id. If a future migration is added without
    updating this assertion, the test reminds us the squash window is
    moving — which is the signal to consider the next squash."""
    out = _run_alembic("current")
    # ``alembic current`` prints either ``<revision> (head)`` or just the id;
    # match the revision we expect to live at head.
    assert "0002_drop_extracted_values" in out, (
        f"Expected head revision '0002_drop_extracted_values', got:\n{out}"
    )
