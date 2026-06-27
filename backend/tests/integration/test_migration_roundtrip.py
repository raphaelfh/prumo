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


_COL_PRESENT = text(
    "SELECT 1 FROM information_schema.columns "
    "WHERE table_schema='public' AND table_name='extraction_instances' "
    "AND column_name='status'"
)
_ENUM_PRESENT = text("SELECT 1 FROM pg_type WHERE typname = 'extraction_instance_status'")


@pytest.mark.asyncio
async def test_migration_0030_round_trip(db_session: AsyncSession) -> None:
    """``0030_drop_instance_status`` removes ``extraction_instances.status`` and
    its enum at head; downgrading below 0030 (to its parent ``0029``) restores
    the schema (column + enum, not the data); ``upgrade head`` re-removes both.
    Downgrades to the explicit parent revision (not ``-1``) so the test stays
    correct as later migrations stack on top. Guards against drift between a
    fresh ``alembic upgrade head`` and ``baseline_v1.sql`` (which still ships the
    legacy column)."""
    assert (await db_session.execute(_COL_PRESENT)).scalar() is None, (
        "extraction_instances.status must be absent at HEAD"
    )
    assert (await db_session.execute(_ENUM_PRESENT)).scalar() is None, (
        "extraction_instance_status enum must be absent at HEAD"
    )

    _run_alembic("downgrade", "0029_reviewer_ready_flag")
    try:
        await db_session.commit()
        assert (await db_session.execute(_COL_PRESENT)).scalar() == 1, (
            "downgrade must restore the status column"
        )
        assert (await db_session.execute(_ENUM_PRESENT)).scalar() == 1, (
            "downgrade must recreate the extraction_instance_status enum"
        )
    finally:
        _run_alembic("upgrade", "head")

    await db_session.commit()
    assert (await db_session.execute(_COL_PRESENT)).scalar() is None, (
        "upgrade head must re-drop the status column"
    )
    assert (await db_session.execute(_ENUM_PRESENT)).scalar() is None, (
        "upgrade head must re-drop the extraction_instance_status enum"
    )


# Identify the manual_override CHECK by its CONTENT (it references the
# 'manual_override' mode), not its name: SQLAlchemy's naming convention
# prefixes the declared name to ``ck_extraction_consensus_decisions_*``, and we
# don't want the test coupled to that. The sibling select_existing CHECK does
# not mention 'manual_override', so this match is unambiguous in both states.
_OVERRIDE_CHECK_DEF = text(
    "SELECT pg_get_constraintdef(c.oid) "
    "FROM pg_constraint c "
    "JOIN pg_class t ON t.oid = c.conrelid "
    "JOIN pg_namespace n ON n.oid = t.relnamespace "
    "WHERE t.relname = 'extraction_consensus_decisions' "
    "AND n.nspname = 'public' "
    "AND c.contype = 'c' "
    "AND pg_get_constraintdef(c.oid) LIKE '%manual_override%'"
)


@pytest.mark.asyncio
async def test_migration_0032_round_trip(db_session: AsyncSession) -> None:
    """``0032_optional_rationale`` relaxes the CHECK ``manual_override_complete``
    to require only ``value`` (rationale optional). At head the constraint no
    longer mentions ``rationale``; downgrading to the explicit parent ``0031``
    restores the stricter expression; ``upgrade head`` relaxes it again.
    Downgrades to the explicit parent (not ``-1``) so the test stays correct as
    later migrations stack on top."""
    def_at_head = (await db_session.execute(_OVERRIDE_CHECK_DEF)).scalar()
    assert def_at_head is not None and "rationale" not in def_at_head, (
        f"manual_override_complete must not require rationale at HEAD, got: {def_at_head}"
    )

    _run_alembic("downgrade", "0031_unique_atb_idx")
    try:
        await db_session.commit()
        def_down = (await db_session.execute(_OVERRIDE_CHECK_DEF)).scalar()
        assert def_down is not None and "rationale" in def_down, (
            f"downgrade must restore the rationale requirement, got: {def_down}"
        )
    finally:
        _run_alembic("upgrade", "head")

    await db_session.commit()
    def_after = (await db_session.execute(_OVERRIDE_CHECK_DEF)).scalar()
    assert def_after is not None and "rationale" not in def_after, (
        f"upgrade head must re-relax the constraint, got: {def_after}"
    )


_ARTICLE_FILES_COLS = text(
    "SELECT column_name FROM information_schema.columns "
    "WHERE table_schema = 'public' AND table_name = 'article_files' "
    "AND column_name IN ('content_markdown', 'content_version', 'text_raw', 'text_html')"
)


@pytest.mark.asyncio
async def test_migration_0033_round_trip(db_session: AsyncSession) -> None:
    """``0033_article_markdown_cols`` adds ``content_markdown`` + ``content_version``
    and drops the dead ``text_raw`` / ``text_html`` columns. Downgrading to the
    explicit parent ``0032_optional_rationale`` inverts the operation; upgrading to
    head applies it again. Downgrades to the explicit parent (not ``-1``) so the
    test stays correct as later migrations stack on top."""
    cols_at_head = set((await db_session.execute(_ARTICLE_FILES_COLS)).scalars().all())
    assert "content_markdown" in cols_at_head, "content_markdown must exist at HEAD"
    assert "content_version" in cols_at_head, "content_version must exist at HEAD"
    assert "text_raw" not in cols_at_head, "text_raw must be dropped at HEAD"
    assert "text_html" not in cols_at_head, "text_html must be dropped at HEAD"

    _run_alembic("downgrade", "0032_optional_rationale")
    try:
        await db_session.commit()
        cols_down = set((await db_session.execute(_ARTICLE_FILES_COLS)).scalars().all())
        assert "text_raw" in cols_down, "downgrade must restore text_raw"
        assert "text_html" in cols_down, "downgrade must restore text_html"
        assert "content_markdown" not in cols_down, "downgrade must drop content_markdown"
        assert "content_version" not in cols_down, "downgrade must drop content_version"
    finally:
        _run_alembic("upgrade", "head")

    await db_session.commit()
    cols_after = set((await db_session.execute(_ARTICLE_FILES_COLS)).scalars().all())
    assert "content_markdown" in cols_after, "upgrade head must restore content_markdown"
    assert "content_version" in cols_after, "upgrade head must restore content_version"
    assert "text_raw" not in cols_after, "upgrade head must re-drop text_raw"
    assert "text_html" not in cols_after, "upgrade head must re-drop text_html"


_EVIDENCE_ATTR_LABEL_COL = text(
    "SELECT 1 FROM information_schema.columns "
    "WHERE table_schema = 'public' AND table_name = 'extraction_evidence' "
    "AND column_name = 'attribution_label'"
)


@pytest.mark.asyncio
async def test_migration_0034_round_trip(db_session: AsyncSession) -> None:
    """``0034_evidence_attr_label`` adds ``extraction_evidence.attribution_label``.
    Downgrading to the explicit parent ``0033_article_markdown_cols`` drops it;
    upgrading to head restores it. Downgrades to the explicit parent (not ``-1``)
    so the test stays correct as later migrations stack on top."""
    assert (await db_session.execute(_EVIDENCE_ATTR_LABEL_COL)).scalar() == 1, (
        "attribution_label must exist at HEAD"
    )

    _run_alembic("downgrade", "0033_article_markdown_cols")
    try:
        await db_session.commit()
        assert (await db_session.execute(_EVIDENCE_ATTR_LABEL_COL)).scalar() is None, (
            "downgrade must drop attribution_label"
        )
    finally:
        _run_alembic("upgrade", "head")

    await db_session.commit()
    assert (await db_session.execute(_EVIDENCE_ATTR_LABEL_COL)).scalar() == 1, (
        "upgrade head must restore attribution_label"
    )


@pytest.mark.asyncio
async def test_alembic_head_is_expected_revision() -> None:
    """Pin the head revision id. If a future migration is added without
    updating this assertion, the test reminds us the squash window is
    moving — which is the signal to consider the next squash."""
    out = _run_alembic("current")
    # ``alembic current`` prints either ``<revision> (head)`` or just the id;
    # match the revision we expect to live at head.
    assert "0034_evidence_attr_label" in out, (
        f"Expected head revision '0034_evidence_attr_label', got:\n{out}"
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
