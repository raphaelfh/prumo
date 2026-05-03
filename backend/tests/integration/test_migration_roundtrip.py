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
            f"alembic {' '.join(args)} failed:\nstdout: {proc.stdout}\nstderr: {proc.stderr}"
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

    _run_alembic("downgrade", "0001_baseline_v1")
    try:
        # Below 0002 the legacy table + enum should exist again.
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
                text("SELECT 1 FROM pg_type WHERE typname = 'extraction_source'")
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
        await db_session.execute(text("SELECT 1 FROM pg_type WHERE typname = 'extraction_source'"))
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
    assert "0010_lock_handle_new_user" in out, (
        f"Expected head revision '0010_lock_handle_new_user', got:\n{out}"
    )


@pytest.mark.asyncio
async def test_alembic_history_chain_is_continuous() -> None:
    """Defence-in-depth on top of the explicit head pin: every migration
    file under ``alembic/versions/`` must form a single linear chain from
    ``0001_baseline_v1`` up to head, with each ``down_revision`` matching
    the previous file's ``revision``. Catches:

    - Orphan migrations (missing ``down_revision``).
    - Branch points (two files claiming the same parent).
    - Drift between filename ordering and the chain (e.g. someone
      reorders files but forgets to update ``down_revision``).
    """
    versions_dir = _BACKEND_DIR / "alembic" / "versions"
    revisions: list[tuple[str, str | None]] = []
    for path in sorted(versions_dir.glob("[0-9]*.py")):
        text_content = path.read_text()
        rev_line = next(
            (ln for ln in text_content.splitlines() if ln.strip().startswith("revision = ")),
            None,
        )
        down_line = next(
            (ln for ln in text_content.splitlines() if ln.strip().startswith("down_revision = ")),
            None,
        )
        assert rev_line is not None, f"{path.name}: missing 'revision = ...'"
        assert down_line is not None, f"{path.name}: missing 'down_revision = ...'"
        rev = rev_line.split("=", 1)[1].strip().strip('"').strip("'")
        down_raw = down_line.split("=", 1)[1].strip()
        down: str | None = None if down_raw == "None" else down_raw.strip('"').strip("'")
        revisions.append((rev, down))

    assert revisions, "No migration files discovered."
    # First migration must have no parent.
    assert revisions[0][1] is None, (
        f"First migration {revisions[0][0]} has down_revision {revisions[0][1]}, expected None."
    )
    # Each subsequent migration must point at its predecessor.
    for (rev, down), (prev_rev, _) in zip(revisions[1:], revisions[:-1], strict=True):
        assert down == prev_rev, (
            f"Migration {rev} points at {down}, but the previous file declared revision {prev_rev}."
        )
    # No two files may declare the same revision id.
    rev_ids = [r for r, _ in revisions]
    assert len(rev_ids) == len(set(rev_ids)), f"Duplicate revision id detected: {rev_ids}"
