"""Integration test: alembic migrations are reversible end-to-end.

Drives ``alembic downgrade <parent> → upgrade head`` to verify that every
DDL migration on top of the squash baseline round-trips without leaving the
schema in a different state than where it started.

The round-trips run against an ephemeral database
(``prumo_migration_test_<pid>``) created per test session on the same
Postgres server — never against the shared dev database. Replaying the chain drops and re-adds columns, and
every dropped column leaves a permanent ``pg_attribute`` tombstone that
counts toward Postgres's 1600-column table limit until the table is
recreated (VACUUM FULL does not clear them), so repeated runs against the
dev DB eventually die with ``TooManyColumnsError``; the downgrades also
destroy real data in the columns they drop. The scratch DB is built exactly
like CI builds its test database: ``supabase_stub.sql`` onto a fresh
database, then ``alembic upgrade head``.
"""

import os
import re
import subprocess
from collections.abc import AsyncGenerator
from pathlib import Path
from typing import NamedTuple
from uuid import UUID, uuid4

import asyncpg
import pytest
import pytest_asyncio
from sqlalchemy import text
from sqlalchemy.engine import make_url
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.core.config import settings

# Repo root is two levels up from this file; alembic must run with cwd=backend/
_BACKEND_DIR = Path(__file__).resolve().parents[2]

# Same stub CI applies to its scratch postgres before `alembic upgrade head`:
# auth schema + auth.uid()/auth.role() GUC readers (baseline RLS policies
# reference them at CREATE POLICY time), Supabase roles, storage.objects.
_STUB_SQL = Path(__file__).with_name("supabase_stub.sql")

# Unique per pytest process. A fixed name was NOT safe: the local Postgres is
# one server shared by every worktree/session, so a second run's setup
# `DROP DATABASE ... WITH (FORCE)` deleted this run's scratch DB mid-flight —
# surfacing as InvalidCatalogNameError here, or ConnectionDoesNotExistError in
# whichever test held a connection when FORCE terminated it. Both were read as
# "the suite is flaky" across two sessions on 2026-08-23. The previous comment
# rested on "concurrent pytest sessions are already forbidden for this suite";
# nothing enforces that, and parallel agent worktrees violate it routinely.
# This removes the scratch-DB hazard ONLY — cross-session advisory-lock
# contention elsewhere in the suite is unchanged, so concurrent full runs are
# still not endorsed.
_SCRATCH_DB_PREFIX = "prumo_migration_test_"
_SCRATCH_DB_NAME = f"{_SCRATCH_DB_PREFIX}{os.getpid()}"
# Databases from the old fixed-name scheme are deliberately NOT matched by the
# sweep below: a peer session still running the old code owns that exact name.
_STALE_SCRATCH_RE = re.compile(rf"^{_SCRATCH_DB_PREFIX}(\d+)$")


def _pid_is_alive(pid: int) -> bool:
    """True if a process with this pid exists (signal 0 probes, never kills)."""
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        # Alive, owned by another user.
        return True
    return True


async def _drop_stale_scratch_dbs(admin: asyncpg.Connection) -> None:
    """Reclaim scratch DBs leaked by hard-killed runs.

    Per-pid naming means a crashed run no longer has its database reclaimed by
    the next run's DROP, so sweep them here. Only databases whose embedded pid
    is gone are dropped, which is what keeps a concurrently-running session's
    scratch DB untouched — the exact failure this naming scheme fixes.
    """
    rows = await admin.fetch(
        "SELECT datname FROM pg_database WHERE datname LIKE $1",
        f"{_SCRATCH_DB_PREFIX}%",
    )
    for row in rows:
        datname = row["datname"]
        match = _STALE_SCRATCH_RE.match(datname)
        if match is None or _pid_is_alive(int(match.group(1))):
            continue
        # datname is regex-validated above, so it is safe to interpolate.
        try:
            await admin.execute(f"DROP DATABASE IF EXISTS {datname} WITH (FORCE)")
        except asyncpg.exceptions.InvalidCatalogNameError:
            # Two sessions can sweep the same orphan at once: IF EXISTS is not
            # atomic against a concurrent drop, so the loser sees "database
            # does not exist". Someone reclaimed it; that is the goal.
            continue


def _run_alembic(*args: str, database_url: str) -> str:
    """Run ``uv run alembic <args>`` from backend/ against ``database_url``.

    Overrides BOTH URL env vars: alembic's env.py prefers DIRECT_DATABASE_URL
    over DATABASE_URL, and OS env beats backend/.env in pydantic-settings —
    overriding only one would leak the round-trip onto the dev database.
    """
    env = {**os.environ, "DATABASE_URL": database_url, "DIRECT_DATABASE_URL": database_url}
    proc = subprocess.run(
        ["uv", "run", "alembic", *args],
        cwd=str(_BACKEND_DIR),
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )
    if proc.returncode != 0:
        raise RuntimeError(
            f"alembic {' '.join(args)} failed:\nstdout: {proc.stdout}\nstderr: {proc.stderr}"
        )
    return proc.stdout


@pytest_asyncio.fixture(scope="session", loop_scope="session")
async def migration_db_url() -> AsyncGenerator[str, None]:
    """Ephemeral scratch database the round-trips run against; yields its URL.

    DROP/CREATE DATABASE cannot run inside a transaction, so a raw asyncpg
    connection (autocommit outside explicit transactions) drives the admin
    statements; ``WITH (FORCE)`` kicks any connection a crashed prior run
    leaked. The multi-statement stub file goes through asyncpg's simple-query
    protocol (no-args ``execute``), which allows several statements per call.
    """
    admin_dsn = make_url(str(settings.DATABASE_URL)).render_as_string(hide_password=False)
    scratch_dsn = (
        make_url(admin_dsn).set(database=_SCRATCH_DB_NAME).render_as_string(hide_password=False)
    )

    admin = await asyncpg.connect(dsn=admin_dsn)
    try:
        await _drop_stale_scratch_dbs(admin)
        await admin.execute(f"DROP DATABASE IF EXISTS {_SCRATCH_DB_NAME} WITH (FORCE)")
        await admin.execute(f"CREATE DATABASE {_SCRATCH_DB_NAME}")
    finally:
        await admin.close()

    scratch = await asyncpg.connect(dsn=scratch_dsn)
    try:
        await scratch.execute(_STUB_SQL.read_text())
    finally:
        await scratch.close()

    _run_alembic("upgrade", "head", database_url=scratch_dsn)
    yield scratch_dsn

    admin = await asyncpg.connect(dsn=admin_dsn)
    try:
        await admin.execute(f"DROP DATABASE IF EXISTS {_SCRATCH_DB_NAME} WITH (FORCE)")
    finally:
        await admin.close()


@pytest_asyncio.fixture
async def migration_session(migration_db_url: str) -> AsyncGenerator[AsyncSession, None]:
    """Session bound to the scratch DB, for the schema-state assertions.

    Fresh NullPool engine per test, disposed before teardown, so no pooled
    connection outlives the test and blocks the session-end DROP DATABASE.
    """
    url = make_url(migration_db_url).set(drivername="postgresql+asyncpg")
    # Same sslmode -> ssl rename Settings.async_database_url applies: the
    # asyncpg driver rejects libpq's sslmode as a connect() kwarg.
    query = dict(url.query)
    if "sslmode" in query and "ssl" not in query:
        query["ssl"] = query.pop("sslmode")
    engine = create_async_engine(url.set(query=query), echo=False, poolclass=NullPool)
    sessionmaker = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    try:
        async with sessionmaker() as session:
            yield session
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_migration_0002_round_trip(
    migration_db_url: str, migration_session: AsyncSession
) -> None:
    """Downgrade one revision then upgrade to head; assert the dropped
    objects are restored mid-trip and re-removed by the time we're back
    at head.

    This exercises both branches of ``0002_drop_extracted_values.upgrade``
    and ``downgrade``, which protects against silent schema drift between
    fresh ``alembic upgrade head`` runs (used in CI) and the one we
    captured in ``baseline_v1.sql``.
    """
    pre = (
        await migration_session.execute(
            text(
                "SELECT 1 FROM information_schema.tables "
                "WHERE table_schema='public' AND table_name='extracted_values'"
            )
        )
    ).scalar()
    assert pre is None, "extracted_values must be absent at HEAD"

    _run_alembic("downgrade", "0001_baseline_v1", database_url=migration_db_url)
    try:
        # Below 0002 the legacy table + enum should exist again.
        await migration_session.commit()
        post_down = (
            await migration_session.execute(
                text(
                    "SELECT 1 FROM information_schema.tables "
                    "WHERE table_schema='public' AND table_name='extracted_values'"
                )
            )
        ).scalar()
        assert post_down == 1, "extracted_values must be restored by downgrade"

        enum_row = (
            await migration_session.execute(
                text("SELECT 1 FROM pg_type WHERE typname = 'extraction_source'")
            )
        ).scalar()
        assert enum_row == 1, "extraction_source enum must be restored by downgrade"
    finally:
        _run_alembic("upgrade", "head", database_url=migration_db_url)

    await migration_session.commit()
    after = (
        await migration_session.execute(
            text(
                "SELECT 1 FROM information_schema.tables "
                "WHERE table_schema='public' AND table_name='extracted_values'"
            )
        )
    ).scalar()
    assert after is None, "extracted_values must be re-dropped after upgrade head"

    enum_after = (
        await migration_session.execute(
            text("SELECT 1 FROM pg_type WHERE typname = 'extraction_source'")
        )
    ).scalar()
    assert enum_after is None, "extraction_source enum must be re-dropped"


_COL_PRESENT = text(
    "SELECT 1 FROM information_schema.columns "
    "WHERE table_schema='public' AND table_name='extraction_instances' "
    "AND column_name='status'"
)
_ENUM_PRESENT = text("SELECT 1 FROM pg_type WHERE typname = 'extraction_instance_status'")


@pytest.mark.asyncio
async def test_migration_0030_round_trip(
    migration_db_url: str, migration_session: AsyncSession
) -> None:
    """``0030_drop_instance_status`` removes ``extraction_instances.status`` and
    its enum at head; downgrading below 0030 (to its parent ``0029``) restores
    the schema (column + enum, not the data); ``upgrade head`` re-removes both.
    Downgrades to the explicit parent revision (not ``-1``) so the test stays
    correct as later migrations stack on top. Guards against drift between a
    fresh ``alembic upgrade head`` and ``baseline_v1.sql`` (which still ships the
    legacy column)."""
    assert (await migration_session.execute(_COL_PRESENT)).scalar() is None, (
        "extraction_instances.status must be absent at HEAD"
    )
    assert (await migration_session.execute(_ENUM_PRESENT)).scalar() is None, (
        "extraction_instance_status enum must be absent at HEAD"
    )

    _run_alembic("downgrade", "0029_reviewer_ready_flag", database_url=migration_db_url)
    try:
        await migration_session.commit()
        assert (await migration_session.execute(_COL_PRESENT)).scalar() == 1, (
            "downgrade must restore the status column"
        )
        assert (await migration_session.execute(_ENUM_PRESENT)).scalar() == 1, (
            "downgrade must recreate the extraction_instance_status enum"
        )
    finally:
        _run_alembic("upgrade", "head", database_url=migration_db_url)

    await migration_session.commit()
    assert (await migration_session.execute(_COL_PRESENT)).scalar() is None, (
        "upgrade head must re-drop the status column"
    )
    assert (await migration_session.execute(_ENUM_PRESENT)).scalar() is None, (
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
async def test_migration_0032_round_trip(
    migration_db_url: str, migration_session: AsyncSession
) -> None:
    """``0032_optional_rationale`` relaxes the CHECK ``manual_override_complete``
    to require only ``value`` (rationale optional). At head the constraint no
    longer mentions ``rationale``; downgrading to the explicit parent ``0031``
    restores the stricter expression; ``upgrade head`` relaxes it again.
    Downgrades to the explicit parent (not ``-1``) so the test stays correct as
    later migrations stack on top."""
    def_at_head = (await migration_session.execute(_OVERRIDE_CHECK_DEF)).scalar()
    assert def_at_head is not None and "rationale" not in def_at_head, (
        f"manual_override_complete must not require rationale at HEAD, got: {def_at_head}"
    )

    _run_alembic("downgrade", "0031_unique_atb_idx", database_url=migration_db_url)
    try:
        await migration_session.commit()
        def_down = (await migration_session.execute(_OVERRIDE_CHECK_DEF)).scalar()
        assert def_down is not None and "rationale" in def_down, (
            f"downgrade must restore the rationale requirement, got: {def_down}"
        )
    finally:
        _run_alembic("upgrade", "head", database_url=migration_db_url)

    await migration_session.commit()
    def_after = (await migration_session.execute(_OVERRIDE_CHECK_DEF)).scalar()
    assert def_after is not None and "rationale" not in def_after, (
        f"upgrade head must re-relax the constraint, got: {def_after}"
    )


_ARTICLE_FILES_COLS = text(
    "SELECT column_name FROM information_schema.columns "
    "WHERE table_schema = 'public' AND table_name = 'article_files' "
    "AND column_name IN ('content_markdown', 'content_version', 'text_raw', 'text_html')"
)


@pytest.mark.asyncio
async def test_migration_0033_round_trip(
    migration_db_url: str, migration_session: AsyncSession
) -> None:
    """``0033_article_markdown_cols`` adds ``content_markdown`` + ``content_version``
    and drops the dead ``text_raw`` / ``text_html`` columns. Downgrading to the
    explicit parent ``0032_optional_rationale`` inverts the operation; upgrading to
    head applies it again. Downgrades to the explicit parent (not ``-1``) so the
    test stays correct as later migrations stack on top."""
    cols_at_head = set((await migration_session.execute(_ARTICLE_FILES_COLS)).scalars().all())
    assert "content_markdown" in cols_at_head, "content_markdown must exist at HEAD"
    assert "content_version" in cols_at_head, "content_version must exist at HEAD"
    assert "text_raw" not in cols_at_head, "text_raw must be dropped at HEAD"
    assert "text_html" not in cols_at_head, "text_html must be dropped at HEAD"

    _run_alembic("downgrade", "0032_optional_rationale", database_url=migration_db_url)
    try:
        await migration_session.commit()
        cols_down = set((await migration_session.execute(_ARTICLE_FILES_COLS)).scalars().all())
        assert "text_raw" in cols_down, "downgrade must restore text_raw"
        assert "text_html" in cols_down, "downgrade must restore text_html"
        assert "content_markdown" not in cols_down, "downgrade must drop content_markdown"
        assert "content_version" not in cols_down, "downgrade must drop content_version"
    finally:
        _run_alembic("upgrade", "head", database_url=migration_db_url)

    await migration_session.commit()
    cols_after = set((await migration_session.execute(_ARTICLE_FILES_COLS)).scalars().all())
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
async def test_migration_0034_round_trip(
    migration_db_url: str, migration_session: AsyncSession
) -> None:
    """``0034_evidence_attr_label`` adds ``extraction_evidence.attribution_label``.
    Downgrading to the explicit parent ``0033_article_markdown_cols`` drops it;
    upgrading to head restores it. Downgrades to the explicit parent (not ``-1``)
    so the test stays correct as later migrations stack on top."""
    assert (await migration_session.execute(_EVIDENCE_ATTR_LABEL_COL)).scalar() == 1, (
        "attribution_label must exist at HEAD"
    )

    _run_alembic("downgrade", "0033_article_markdown_cols", database_url=migration_db_url)
    try:
        await migration_session.commit()
        assert (await migration_session.execute(_EVIDENCE_ATTR_LABEL_COL)).scalar() is None, (
            "downgrade must drop attribution_label"
        )
    finally:
        _run_alembic("upgrade", "head", database_url=migration_db_url)

    await migration_session.commit()
    assert (await migration_session.execute(_EVIDENCE_ATTR_LABEL_COL)).scalar() == 1, (
        "upgrade head must restore attribution_label"
    )


_EVIDENCE_RANK_COL = text(
    "SELECT 1 FROM information_schema.columns "
    "WHERE table_schema = 'public' AND table_name = 'extraction_evidence' "
    "AND column_name = 'rank'"
)


@pytest.mark.asyncio
async def test_migration_0035_round_trip(
    migration_db_url: str, migration_session: AsyncSession
) -> None:
    """0035 adds extraction_evidence.rank (server_default '0', backfilling
    legacy rows to 0). Downgrade to the explicit parent 0034_evidence_attr_label
    drops it; upgrade head restores it. Backfill is proven by the server_default
    at the column level (no data: SEED seeds no evidence rows and a raw INSERT
    would violate the NOT NULL FKs + workflow_target_present CHECK)."""
    assert (await migration_session.execute(_EVIDENCE_RANK_COL)).scalar() == 1, (
        "rank must exist at HEAD"
    )

    _run_alembic("downgrade", "0034_evidence_attr_label", database_url=migration_db_url)
    try:
        await migration_session.commit()
        assert (await migration_session.execute(_EVIDENCE_RANK_COL)).scalar() is None, (
            "downgrade must drop rank"
        )
    finally:
        _run_alembic("upgrade", "head", database_url=migration_db_url)

    await migration_session.commit()
    assert (await migration_session.execute(_EVIDENCE_RANK_COL)).scalar() == 1, (
        "upgrade head must restore rank"
    )


_FIELD_DISPOSITION_COLS = text(
    "SELECT column_name FROM information_schema.columns "
    "WHERE table_schema='public' AND table_name='extraction_fields' "
    "AND column_name IN ('allows_not_applicable', 'allows_not_evaluated')"
)


@pytest.mark.asyncio
async def test_migration_0038_round_trip(
    migration_db_url: str, migration_session: AsyncSession
) -> None:
    """``0038_field_disposition_flags`` adds ``allows_not_applicable`` +
    ``allows_not_evaluated`` (NOT NULL, server_default false). Downgrading to the
    explicit parent ``0037_block_type_figure`` drops both; upgrading to head
    restores them. Downgrades to the explicit parent (not ``-1``) so the test
    stays correct as later migrations stack on top."""
    cols_at_head = set((await migration_session.execute(_FIELD_DISPOSITION_COLS)).scalars().all())
    assert cols_at_head == {"allows_not_applicable", "allows_not_evaluated"}, (
        "both disposition flag columns must exist at HEAD"
    )

    _run_alembic("downgrade", "0037_block_type_figure", database_url=migration_db_url)
    try:
        await migration_session.commit()
        cols_down = set((await migration_session.execute(_FIELD_DISPOSITION_COLS)).scalars().all())
        assert cols_down == set(), "downgrade must drop both disposition flag columns"
    finally:
        _run_alembic("upgrade", "head", database_url=migration_db_url)

    await migration_session.commit()
    cols_after = set((await migration_session.execute(_FIELD_DISPOSITION_COLS)).scalars().all())
    assert cols_after == {"allows_not_applicable", "allows_not_evaluated"}, (
        "upgrade head must restore both disposition flag columns"
    )


_NO_INFORMATION_COL = text(
    "SELECT column_default FROM information_schema.columns "
    "WHERE table_schema='public' AND table_name='extraction_fields' "
    "AND column_name='allows_no_information'"
)


@pytest.mark.asyncio
async def test_migration_0062_round_trip(
    migration_db_url: str, migration_session: AsyncSession
) -> None:
    """``0062_allows_no_information`` adds the third disposition flag.

    Its server_default is ``true`` — the OPPOSITE of 0038's two — because the
    marker was universal before the column existed, so every pre-existing row
    must backfill to "available". Asserting the default (not just the column's
    presence) is what pins that; a copy-paste of 0038 would silently retire the
    marker on every field in the database.

    Downgrades to the explicit parent ``0061_rls_initplan_config_reads`` (not
    ``-1``) so the test stays correct as later migrations stack on top.
    """
    assert "true" in ((await migration_session.execute(_NO_INFORMATION_COL)).scalar() or ""), (
        "the column must exist at HEAD with a TRUE server_default"
    )

    _run_alembic("downgrade", "0061_rls_initplan_config_reads", database_url=migration_db_url)
    try:
        await migration_session.commit()
        assert (await migration_session.execute(_NO_INFORMATION_COL)).scalar() is None, (
            "downgrade must drop the column"
        )
    finally:
        _run_alembic("upgrade", "head", database_url=migration_db_url)

    await migration_session.commit()
    assert "true" in ((await migration_session.execute(_NO_INFORMATION_COL)).scalar() or ""), (
        "upgrade head must restore the column with its TRUE default"
    )


@pytest.mark.asyncio
async def test_migration_0063_deletes_the_orphaned_probast_ai_v1_row(
    migration_db_url: str, migration_session: AsyncSession
) -> None:
    """``0063_drop_probast_ai_v1`` removes the catalogue row #693 stranded.

    Driven through alembic rather than by re-issuing the statement, so it is
    the migration's own SQL under test: seed the orphan while downgraded to
    the parent, then upgrade and watch it go — together with its catalogue
    sections and fields, which follow on CASCADE.

    The scratch DB is built by ``alembic upgrade head`` and never seeded, so
    the row cannot be there already and the delete cannot be a coincidence.
    """
    _run_alembic("downgrade", "0062_allows_no_information", database_url=migration_db_url)
    try:
        await migration_session.execute(
            text(
                "INSERT INTO public.extraction_templates_global "
                "(id, name, description, framework, version, kind, is_global, schema) "
                "VALUES ('00ba0000-0000-0000-0000-000000000001', 'PROBAST+AI', NULL, "
                "        'CUSTOM', '1.0.0', 'quality_assessment', true, '{}'::jsonb)"
            )
        )
        await migration_session.execute(
            text(
                "INSERT INTO public.extraction_entity_types "
                "(id, template_id, name, label, role, cardinality, sort_order) "
                "VALUES ('00ba0000-0000-0000-0000-0000000000aa', "
                "        '00ba0000-0000-0000-0000-000000000001', 'dev_d1', 'D1', "
                # This INSERT runs at a 0002-era schema, where `role` still
                # exists — 0069 is far above it in the chain.
                "        'study_section', 'one', 0)"
            )
        )
        await migration_session.commit()
    finally:
        _run_alembic("upgrade", "head", database_url=migration_db_url)

    await migration_session.commit()
    assert (
        await migration_session.execute(
            text(
                "SELECT count(*) FROM public.extraction_templates_global "
                "WHERE id = '00ba0000-0000-0000-0000-000000000001'"
            )
        )
    ).scalar() == 0, "the orphaned v1 catalogue row must be gone at head"
    assert (
        await migration_session.execute(
            text(
                "SELECT count(*) FROM public.extraction_entity_types "
                "WHERE id = '00ba0000-0000-0000-0000-0000000000aa'"
            )
        )
    ).scalar() == 0, "its catalogue sections must follow on CASCADE"


@pytest.mark.asyncio
async def test_migration_0039_round_trip(
    migration_db_url: str, migration_session: AsyncSession
) -> None:
    """``0039_absent_reason_backfill`` is a data-only migration (no schema
    change), so its roundtrip guard is exercised with data in
    ``test_migration_0039_backfill`` (which stays on the main DB inside a
    rolled-back savepoint). Here we assert the chain is reversible:
    downgrade to the explicit parent ``0038_field_disposition_flags`` and back
    to head both succeed without error — this cycle also exercises
    ``0040_published_state_restrict``'s FK flip (DDL) in both directions."""
    _run_alembic("downgrade", "0038_field_disposition_flags", database_url=migration_db_url)
    try:
        await migration_session.commit()
    finally:
        _run_alembic("upgrade", "head", database_url=migration_db_url)
    await migration_session.commit()
    # Head columns from 0038 are still present after the up/down/up cycle.
    cols = set((await migration_session.execute(_FIELD_DISPOSITION_COLS)).scalars().all())
    assert cols == {"allows_not_applicable", "allows_not_evaluated"}


_ARTICLE_BLOB_COLS = text(
    "SELECT column_name FROM information_schema.columns "
    "WHERE table_schema = 'public' AND table_name = 'articles' "
    "AND column_name IN "
    "('pdf_extracted_text', 'semantic_abstract_text', 'semantic_fulltext_text')"
)


@pytest.mark.asyncio
async def test_migration_0042_round_trip(
    migration_db_url: str, migration_session: AsyncSession
) -> None:
    """``0042_drop_article_blob_columns`` drops the three dead BLOB columns
    from ``articles`` (spec 2026-06-20, decision 2). Downgrading to the
    explicit parent ``0041_reviewer_ready_select_rls`` restores the columns
    (structure only, not the data); ``upgrade head`` re-drops them.
    Downgrades to the explicit parent (not ``-1``) so the test stays correct
    as later migrations stack on top."""
    cols_at_head = set((await migration_session.execute(_ARTICLE_BLOB_COLS)).scalars().all())
    assert cols_at_head == set(), "the three blob columns must be absent at HEAD"

    _run_alembic("downgrade", "0041_reviewer_ready_select_rls", database_url=migration_db_url)
    try:
        await migration_session.commit()
        cols_down = set((await migration_session.execute(_ARTICLE_BLOB_COLS)).scalars().all())
        assert cols_down == {
            "pdf_extracted_text",
            "semantic_abstract_text",
            "semantic_fulltext_text",
        }, "downgrade must restore all three blob columns"
    finally:
        _run_alembic("upgrade", "head", database_url=migration_db_url)

    await migration_session.commit()
    cols_after = set((await migration_session.execute(_ARTICLE_BLOB_COLS)).scalars().all())
    assert cols_after == set(), "upgrade head must re-drop all three blob columns"


_MIN_MANAGER_TRIGGER = text(
    "SELECT 1 FROM pg_trigger "
    "WHERE tgname = 'trg_project_members_min_one_manager' AND NOT tgisinternal"
)
_MIN_MANAGER_FUNC = text("SELECT 1 FROM pg_proc WHERE proname = 'enforce_min_one_manager'")


@pytest.mark.asyncio
async def test_migration_0043_round_trip(
    migration_db_url: str, migration_session: AsyncSession
) -> None:
    """``0043_min_one_manager_guard`` creates the ``enforce_min_one_manager``
    function + its ``trg_project_members_min_one_manager`` trigger (and heals
    zero-manager projects). Downgrading to the explicit parent
    ``0042_drop_article_blob_columns`` drops the trigger + function (the heal
    is intentionally not reverted); ``upgrade head`` re-creates them
    idempotently. Downgrades to the explicit parent (not ``-1``) so the test
    stays correct as later migrations stack on top."""
    assert (await migration_session.execute(_MIN_MANAGER_FUNC)).scalar() == 1, (
        "enforce_min_one_manager function must exist at HEAD"
    )
    assert (await migration_session.execute(_MIN_MANAGER_TRIGGER)).scalar() == 1, (
        "trg_project_members_min_one_manager trigger must exist at HEAD"
    )

    _run_alembic("downgrade", "0042_drop_article_blob_columns", database_url=migration_db_url)
    try:
        await migration_session.commit()
        assert (await migration_session.execute(_MIN_MANAGER_TRIGGER)).scalar() is None, (
            "downgrade must drop the trigger"
        )
        assert (await migration_session.execute(_MIN_MANAGER_FUNC)).scalar() is None, (
            "downgrade must drop the function"
        )
    finally:
        _run_alembic("upgrade", "head", database_url=migration_db_url)

    await migration_session.commit()
    assert (await migration_session.execute(_MIN_MANAGER_FUNC)).scalar() == 1, (
        "upgrade head must restore the function"
    )
    assert (await migration_session.execute(_MIN_MANAGER_TRIGGER)).scalar() == 1, (
        "upgrade head must restore the trigger"
    )


_LLM_INSTRUCTION_COLS = text(
    "SELECT table_name FROM information_schema.columns "
    "WHERE table_schema = 'public' "
    "AND table_name IN ('extraction_templates_global', 'project_extraction_templates') "
    "AND column_name = 'llm_template_instruction'"
)


@pytest.mark.asyncio
async def test_migration_0047_round_trip(
    migration_db_url: str, migration_session: AsyncSession
) -> None:
    """``0047_llm_template_instruction`` adds ``llm_template_instruction``
    to both template tables (structure only on downgrade — the text is
    dropped with the column). Downgrading to the explicit parent
    ``0046_revoke_min_mgr_exec`` drops both; upgrading to head restores
    them. Downgrades to the explicit parent (not ``-1``) so the test
    stays correct as later migrations stack on top."""
    both_tables = {"extraction_templates_global", "project_extraction_templates"}
    cols_at_head = set((await migration_session.execute(_LLM_INSTRUCTION_COLS)).scalars().all())
    assert cols_at_head == both_tables, (
        f"llm_template_instruction must exist on both tables at HEAD, got {cols_at_head}"
    )

    _run_alembic("downgrade", "0046_revoke_min_mgr_exec", database_url=migration_db_url)
    try:
        await migration_session.commit()
        cols_down = set((await migration_session.execute(_LLM_INSTRUCTION_COLS)).scalars().all())
        assert cols_down == set(), "downgrade must drop the column from both tables"
    finally:
        _run_alembic("upgrade", "head", database_url=migration_db_url)

    await migration_session.commit()
    cols_after = set((await migration_session.execute(_LLM_INSTRUCTION_COLS)).scalars().all())
    assert cols_after == both_tables, "upgrade head must restore both columns"


_DRAFT_MARKER_COL = text(
    "SELECT column_name FROM information_schema.columns "
    "WHERE table_schema = 'public' "
    "AND table_name = 'project_extraction_templates' "
    "AND column_name = 'config_draft_since'"
)
_DRAFT_MARKER_TRIGGERS = text(
    "SELECT tgname FROM pg_trigger "
    "WHERE tgname IN ('trg_extraction_entity_types_mark_draft', "
    "'trg_extraction_fields_mark_draft') AND NOT tgisinternal"
)
_DRAFT_MARKER_FUNC = text("SELECT 1 FROM pg_proc WHERE proname = 'mark_template_config_draft'")
_BOTH_DRAFT_TRIGGERS = {
    "trg_extraction_entity_types_mark_draft",
    "trg_extraction_fields_mark_draft",
}


@pytest.mark.asyncio
async def test_migration_0048_round_trip(
    migration_db_url: str, migration_session: AsyncSession
) -> None:
    """``0048_config_draft_marker`` adds ``config_draft_since`` +
    the two mark-draft triggers and their SECURITY DEFINER function.
    Downgrading to the explicit parent ``0047_llm_template_instruction``
    drops all four; ``upgrade head`` re-creates them idempotently.
    Downgrades to the explicit parent (not ``-1``) so the test stays
    correct as later migrations stack on top."""
    assert (await migration_session.execute(_DRAFT_MARKER_COL)).scalar() is not None, (
        "config_draft_since must exist at HEAD"
    )
    assert (await migration_session.execute(_DRAFT_MARKER_FUNC)).scalar() == 1, (
        "mark_template_config_draft function must exist at HEAD"
    )
    triggers_at_head = set(
        (await migration_session.execute(_DRAFT_MARKER_TRIGGERS)).scalars().all()
    )
    assert triggers_at_head == _BOTH_DRAFT_TRIGGERS, (
        f"both mark-draft triggers must exist at HEAD, got {triggers_at_head}"
    )

    _run_alembic("downgrade", "0047_llm_template_instruction", database_url=migration_db_url)
    try:
        await migration_session.commit()
        assert (await migration_session.execute(_DRAFT_MARKER_COL)).scalar() is None, (
            "downgrade must drop the column"
        )
        assert (await migration_session.execute(_DRAFT_MARKER_FUNC)).scalar() is None, (
            "downgrade must drop the function"
        )
        triggers_down = set(
            (await migration_session.execute(_DRAFT_MARKER_TRIGGERS)).scalars().all()
        )
        assert triggers_down == set(), "downgrade must drop both triggers"
    finally:
        _run_alembic("upgrade", "head", database_url=migration_db_url)

    await migration_session.commit()
    assert (await migration_session.execute(_DRAFT_MARKER_COL)).scalar() is not None, (
        "upgrade head must restore the column"
    )
    triggers_after = set((await migration_session.execute(_DRAFT_MARKER_TRIGGERS)).scalars().all())
    assert triggers_after == _BOTH_DRAFT_TRIGGERS, "upgrade head must restore both triggers"


# The four template-config write policies 0049 rewrites. pg_policies
# pretty-prints qual/with_check via pg_get_expr (re-quoted, re-nested), so
# every assertion below is SUBSTRING matching — never string equality.
_CONFIG_WRITE_POLICY_NAMES = {
    "extraction_entity_types_project_insert",
    "extraction_entity_types_project_update",
    "extraction_fields_project_insert",
    "extraction_fields_project_update",
}
_CONFIG_WRITE_POLICIES = text(
    "SELECT policyname, cmd, qual, with_check FROM pg_policies "
    "WHERE schemaname = 'public' "
    "AND tablename IN ('extraction_entity_types', 'extraction_fields') "
    "AND policyname IN ("
    "'extraction_entity_types_project_insert', "
    "'extraction_entity_types_project_update', "
    "'extraction_fields_project_insert', "
    "'extraction_fields_project_update')"
)
_ENTITY_TYPE_POLICY_NAMES = (
    "extraction_entity_types_project_insert",
    "extraction_entity_types_project_update",
)
_UPDATE_POLICY_NAMES = (
    "extraction_entity_types_project_update",
    "extraction_fields_project_update",
)


async def _config_write_policies(session: AsyncSession) -> dict:
    rows = (await session.execute(_CONFIG_WRITE_POLICIES)).all()
    return {row.policyname: row for row in rows}


def _assert_0049_policies(policies: dict) -> None:
    """The manager-gated shape 0049 installs."""
    assert set(policies) == _CONFIG_WRITE_POLICY_NAMES, (
        f"all four write policies must exist, got {set(policies)}"
    )
    for name, row in policies.items():
        combined = (row.qual or "") + (row.with_check or "")
        assert "is_project_manager" in combined, (
            f"{name} must gate on is_project_manager, got: {combined}"
        )
        assert "is_project_member" not in combined, (
            f"{name} must no longer mention is_project_member, got: {combined}"
        )
    # The blocking global-lineage predicate (panel decision 1) on the
    # entity-types pair — in EVERY expression each policy carries.
    for name in _ENTITY_TYPE_POLICY_NAMES:
        row = policies[name]
        for expr in (row.qual, row.with_check):
            if expr is not None:
                assert "template_id IS NULL" in expr, (
                    f"{name} must pin template_id IS NULL, got: {expr}"
                )
    # Both UPDATEs carry an explicit WITH CHECK (panel decision 3).
    for name in _UPDATE_POLICY_NAMES:
        assert policies[name].with_check is not None, (
            f"{name} must carry an explicit WITH CHECK at head"
        )


def _assert_baseline_policies(policies: dict) -> None:
    """The four ASYMMETRIC baseline originals the downgrade restores."""
    assert set(policies) == _CONFIG_WRITE_POLICY_NAMES
    for name, row in policies.items():
        combined = (row.qual or "") + (row.with_check or "")
        assert "is_project_member" in combined, (
            f"downgrade must restore is_project_member on {name}, got: {combined}"
        )
        assert "is_project_manager" not in combined, (
            f"downgrade must remove is_project_manager from {name}, got: {combined}"
        )
    # The lazy-downgrade catch (panel decision 8): baseline UPDATEs were
    # USING-only — a downgrade that keeps the WITH CHECK is wrong.
    for name in _UPDATE_POLICY_NAMES:
        assert policies[name].with_check is None, (
            f"downgrade must drop the WITH CHECK from {name} (baseline is USING-only)"
        )
    # Baseline entity-types INSERT keeps its lineage guard but never the
    # 0049 template_id IS NULL predicate ("project_template_id IS NOT
    # NULL" does not contain the "template_id IS NULL" substring).
    et_insert = policies["extraction_entity_types_project_insert"].with_check
    assert et_insert is not None and "project_template_id IS NOT NULL" in et_insert
    assert "template_id IS NULL" not in et_insert, (
        f"downgrade must restore the baseline INSERT verbatim, got: {et_insert}"
    )


@pytest.mark.asyncio
async def test_migration_0049_round_trip(
    migration_db_url: str, migration_session: AsyncSession
) -> None:
    """``0049_config_write_rls_manager`` rewrites the four template-config
    write policies: member → manager, explicit WITH CHECK on both UPDATEs,
    and ``template_id IS NULL`` on the entity-types pair (the global-
    catalogue injection floor). Downgrading to the explicit parent
    ``0048_config_draft_marker`` restores the asymmetric baseline originals
    verbatim (member predicates, USING-only UPDATEs); ``upgrade head``
    re-installs the manager shape. Downgrades to the explicit parent (not
    ``-1``) so the test stays correct as later migrations stack on top."""
    _assert_0049_policies(await _config_write_policies(migration_session))
    # pg_policies deparses qual/with_check via pg_get_expr, which takes an
    # AccessShare lock on the policies' TABLES — unlike the sibling tests'
    # information_schema reads. End the transaction before every alembic
    # subprocess or its DROP POLICY (AccessExclusive) waits on this session
    # forever.
    await migration_session.rollback()

    _run_alembic("downgrade", "0048_config_draft_marker", database_url=migration_db_url)
    try:
        _assert_baseline_policies(await _config_write_policies(migration_session))
    finally:
        await migration_session.rollback()
        _run_alembic("upgrade", "head", database_url=migration_db_url)

    _assert_0049_policies(await _config_write_policies(migration_session))


# --- 0050: per-section field-name unique index + duplicate-name heal ---
# Fixed fixture ids (0050-prefixed, hex-only) so assertions can name rows.
_H_PROFILE = "00500000-0000-4000-8000-00000000000a"
_H_PROJECT = "00500000-0000-4000-8000-00000000000b"
_H_TEMPLATE = "00500000-0000-4000-8000-00000000000c"
_H_GLOBAL_TPL = "00500000-0000-4000-8000-00000000000d"
_H_SECTION = "00500000-0000-4000-8000-00000000000e"
_H_GLOBAL_SECTION = "00500000-0000-4000-8000-00000000000f"
_H_F_KEEP = "00500000-0000-4000-8000-000000000001"
_H_F_DUP2 = "00500000-0000-4000-8000-000000000002"
_H_F_DUP3 = "00500000-0000-4000-8000-000000000003"
_H_F_TAKEN = "00500000-0000-4000-8000-000000000004"
_H_G_KEEP = "00500000-0000-4000-8000-000000000005"
_H_G_DUP = "00500000-0000-4000-8000-000000000006"

# The deterministic heal outcome (panel decision 6): keeper = earliest
# created_at per (section, name); rn>1 rows renamed in rn order to the
# first FREE suffix — the pre-existing dup_probe_2 forces _3/_4.
_HEALED_PROJECT_NAMES = {
    _H_F_KEEP: "dup_probe",
    _H_F_DUP2: "dup_probe_3",
    _H_F_DUP3: "dup_probe_4",
    _H_F_TAKEN: "dup_probe_2",
}
_HEALED_GLOBAL_NAMES = {_H_G_KEEP: "g_dup", _H_G_DUP: "g_dup_2"}

_FIELD_UNIQUE_INDEX = text(
    "SELECT 1 FROM pg_indexes "
    "WHERE schemaname = 'public' AND tablename = 'extraction_fields' "
    "AND indexname = 'uq_extraction_fields_entity_type_name'"
)
_SECTION_FIELD_NAMES = text(
    "SELECT id::text, name FROM public.extraction_fields WHERE entity_type_id = :sid"
)
_HEAL_MARKER = text(
    "SELECT config_draft_since FROM public.project_extraction_templates WHERE id = :tid"
)
_CLEAR_HEAL_MARKER = text(
    "UPDATE public.project_extraction_templates SET config_draft_since = NULL WHERE id = :tid"
)

# Duplicate names are only representable at 0049 (pre-index). Mirrors the
# minimal FK graph of test_one_live_run_guard_migration; created_at is
# staggered explicitly because it is the heal's rank key.
_HEAL_FIXTURE_STATEMENTS = (
    "INSERT INTO auth.users (id, email, instance_id, aud, role) VALUES "
    f"('{_H_PROFILE}', 'heal-0050@integration-test.prumo.local', "
    "'00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated')",
    "INSERT INTO public.profiles (id, email, full_name) VALUES "
    f"('{_H_PROFILE}', 'heal-0050@integration-test.prumo.local', 'Heal 0050')",
    "INSERT INTO public.projects (id, name, created_by_id, is_active) VALUES "
    f"('{_H_PROJECT}', 'Heal 0050 Project', '{_H_PROFILE}', true)",
    "INSERT INTO public.project_extraction_templates "
    "(id, project_id, name, framework, version, kind, schema, is_active, created_by) VALUES "
    f"('{_H_TEMPLATE}', '{_H_PROJECT}', 'heal-0050-template', 'CUSTOM', '1.0', "
    f"'extraction', '{{}}'::jsonb, true, '{_H_PROFILE}')",
    # Deferred 0004 invariant: an ACTIVE project template needs an active
    # version row by COMMIT time.
    "INSERT INTO public.extraction_template_versions "
    "(id, project_template_id, version, schema, published_by, is_active) VALUES "
    f"('00500000-0000-4000-8000-0000000000aa', '{_H_TEMPLATE}', 1, "
    f"'{{\"entity_types\": []}}'::jsonb, '{_H_PROFILE}', true)",
    "INSERT INTO public.extraction_templates_global "
    "(id, name, framework, version, kind, is_global, schema) VALUES "
    f"('{_H_GLOBAL_TPL}', 'heal-0050-global', 'CUSTOM', '1.0', 'extraction', "
    "true, '{}'::jsonb)",
    # Era-correct `role`: inserted at a 0050-era schema, where it is NOT NULL.
    "INSERT INTO public.extraction_entity_types "
    "(id, project_template_id, name, label, role, cardinality,"
    " parent_entity_type_id, sort_order, is_required) VALUES "
    f"('{_H_SECTION}', '{_H_TEMPLATE}', 'heal_section', 'Heal Section', "
    "'study_section', 'one', NULL, 0, false)",
    "INSERT INTO public.extraction_entity_types "
    "(id, template_id, name, label, role, cardinality,"
    " parent_entity_type_id, sort_order, is_required) VALUES "
    f"('{_H_GLOBAL_SECTION}', '{_H_GLOBAL_TPL}', 'heal_global_section', "
    "'Heal Global Section', 'study_section', 'one', NULL, 0, false)",
    # Project section: three 'dup_probe' rows + a pre-existing 'dup_probe_2'
    # that must NOT collide with the healed names (collision-proof case).
    "INSERT INTO public.extraction_fields "
    "(id, entity_type_id, name, label, field_type, is_required, sort_order, created_at) VALUES "
    f"('{_H_F_KEEP}', '{_H_SECTION}', 'dup_probe', 'Dup Probe', 'text', false, 0, "
    "now() - interval '3 hours'), "
    f"('{_H_F_DUP2}', '{_H_SECTION}', 'dup_probe', 'Dup Probe', 'text', false, 1, "
    "now() - interval '2 hours'), "
    f"('{_H_F_DUP3}', '{_H_SECTION}', 'dup_probe', 'Dup Probe', 'text', false, 2, "
    "now() - interval '1 hour'), "
    f"('{_H_F_TAKEN}', '{_H_SECTION}', 'dup_probe_2', 'Dup Probe 2', 'text', false, 3, "
    "now() - interval '4 hours')",
    # Global lineage: the heal covers BOTH lineages (plain per-section scan).
    "INSERT INTO public.extraction_fields "
    "(id, entity_type_id, name, label, field_type, is_required, sort_order, created_at) VALUES "
    f"('{_H_G_KEEP}', '{_H_GLOBAL_SECTION}', 'g_dup', 'G Dup', 'text', false, 0, "
    "now() - interval '2 hours'), "
    f"('{_H_G_DUP}', '{_H_GLOBAL_SECTION}', 'g_dup', 'G Dup', 'text', false, 1, "
    "now() - interval '1 hour')",
)


async def _section_names(session: AsyncSession, section_id: str) -> dict[str, str]:
    rows = (await session.execute(_SECTION_FIELD_NAMES, {"sid": section_id})).all()
    return {row[0]: row[1] for row in rows}


@pytest.mark.asyncio
async def test_migration_0050_round_trip(
    migration_db_url: str, migration_session: AsyncSession
) -> None:
    """``0050_field_name_unique_heal`` heals duplicate per-section field
    names (deterministic first-free-suffix rename, 0048 trigger ENABLED)
    and creates the ``uq_extraction_fields_entity_type_name`` unique
    index. Downgrading to the explicit parent ``0049`` drops the INDEX
    ONLY — healed names persist (permanent data repair) — and a second
    upgrade renames nothing (idempotency). Duplicate fixtures are
    inserted while downgraded (the only state that can represent them);
    the healed project template must carry a stamped draft marker (the
    trigger-enabled proof, panel decision 6). Every alembic subprocess is
    preceded by ``rollback()``: the data reads above take AccessShare
    locks on ``extraction_fields`` that would deadlock the DDL."""
    assert (await migration_session.execute(_FIELD_UNIQUE_INDEX)).scalar() == 1, (
        "uq_extraction_fields_entity_type_name must exist at HEAD"
    )
    await migration_session.rollback()

    _run_alembic("downgrade", "0049_config_write_rls_manager", database_url=migration_db_url)
    try:
        assert (await migration_session.execute(_FIELD_UNIQUE_INDEX)).scalar() is None, (
            "downgrade must drop the unique index"
        )
        for statement in _HEAL_FIXTURE_STATEMENTS:
            await migration_session.execute(text(statement))
        # The fixture INSERTs fired the (still-present) 0048 trigger and
        # stamped the template; reset so the upgrade's heal must re-stamp.
        await migration_session.execute(_CLEAR_HEAL_MARKER, {"tid": _H_TEMPLATE})
        await migration_session.commit()
    finally:
        await migration_session.rollback()
        _run_alembic("upgrade", "head", database_url=migration_db_url)

    assert await _section_names(migration_session, _H_SECTION) == _HEALED_PROJECT_NAMES, (
        "heal must rename rn>1 rows to the first FREE suffix (skipping the "
        "pre-existing dup_probe_2), keeping the earliest-created row's name"
    )
    assert await _section_names(migration_session, _H_GLOBAL_SECTION) == _HEALED_GLOBAL_NAMES, (
        "heal must cover the GLOBAL lineage too"
    )
    assert (await migration_session.execute(_HEAL_MARKER, {"tid": _H_TEMPLATE})).scalar() is not (
        None
    ), "the heal must stamp config_draft_since — the 0048 trigger stays ENABLED (panel 6)"
    assert (await migration_session.execute(_FIELD_UNIQUE_INDEX)).scalar() == 1, (
        "upgrade head must create the unique index"
    )
    await migration_session.rollback()

    # Idempotency leg: downgrade drops the index only; healed names
    # persist; a re-upgrade selects no rn>1 rows and renames nothing.
    _run_alembic("downgrade", "0049_config_write_rls_manager", database_url=migration_db_url)
    try:
        assert (await migration_session.execute(_FIELD_UNIQUE_INDEX)).scalar() is None
        assert await _section_names(migration_session, _H_SECTION) == _HEALED_PROJECT_NAMES, (
            "healed names must persist through the downgrade (index-only)"
        )
        # NULL the marker again: if the second heal renamed anything the
        # trigger would re-stamp it, so a still-NULL marker after the
        # upgrade is the no-op proof.
        await migration_session.execute(_CLEAR_HEAL_MARKER, {"tid": _H_TEMPLATE})
        await migration_session.commit()
    finally:
        await migration_session.rollback()
        _run_alembic("upgrade", "head", database_url=migration_db_url)

    assert await _section_names(migration_session, _H_SECTION) == _HEALED_PROJECT_NAMES, (
        "re-running the heal must rename nothing (idempotent)"
    )
    assert await _section_names(migration_session, _H_GLOBAL_SECTION) == _HEALED_GLOBAL_NAMES
    assert (await migration_session.execute(_HEAL_MARKER, {"tid": _H_TEMPLATE})).scalar() is None, (
        "an idempotent re-heal performs no DML, so the trigger must not re-stamp"
    )
    assert (await migration_session.execute(_FIELD_UNIQUE_INDEX)).scalar() == 1
    await migration_session.rollback()
    # Fixture rows are left in place: the scratch DB is dropped at session
    # end, and the healed names are unique so later round-trips no-op.


# --- 0051: group entry noun column + container backfill (B-8) ---
# Fixed fixture ids (0051-prefixed, hex-only) so assertions can name rows.
_B8_PROFILE = "00510000-0000-4000-8000-00000000000a"
_B8_PROJECT = "00510000-0000-4000-8000-00000000000b"
_B8_TEMPLATE = "00510000-0000-4000-8000-00000000000c"
_B8_GLOBAL_TPL = "00510000-0000-4000-8000-00000000000d"
_B8_CONTAINER = "00510000-0000-4000-8000-000000000001"
_B8_SECTION = "00510000-0000-4000-8000-000000000002"
_B8_GLOBAL_CONTAINER = "00510000-0000-4000-8000-000000000003"

_ENTRY_LABEL_COL = text(
    "SELECT 1 FROM information_schema.columns "
    "WHERE table_schema = 'public' AND table_name = 'extraction_entity_types' "
    "AND column_name = 'entry_label'"
)
_B8_ENTRY_LABELS = text(
    "SELECT id::text, entry_label FROM public.extraction_entity_types "
    f"WHERE id IN ('{_B8_CONTAINER}', '{_B8_SECTION}', '{_B8_GLOBAL_CONTAINER}')"
)

# Rows are inserted while downgraded to 0050 (pre-column state) so the
# upgrade's backfill has to stamp them. Mirrors the 0050 heal fixture's
# minimal FK graph; the containers live on BOTH lineages because the
# backfill predicate is role-only and must stay that way.
_B8_FIXTURE_STATEMENTS = (
    "INSERT INTO auth.users (id, email, instance_id, aud, role) VALUES "
    f"('{_B8_PROFILE}', 'entry-label-0051@integration-test.prumo.local', "
    "'00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated')",
    "INSERT INTO public.profiles (id, email, full_name) VALUES "
    f"('{_B8_PROFILE}', 'entry-label-0051@integration-test.prumo.local', 'Entry Label 0051')",
    "INSERT INTO public.projects (id, name, created_by_id, is_active) VALUES "
    f"('{_B8_PROJECT}', 'Entry Label 0051 Project', '{_B8_PROFILE}', true)",
    "INSERT INTO public.project_extraction_templates "
    "(id, project_id, name, framework, version, kind, schema, is_active, created_by) VALUES "
    f"('{_B8_TEMPLATE}', '{_B8_PROJECT}', 'entry-label-0051-template', 'CUSTOM', '1.0', "
    f"'extraction', '{{}}'::jsonb, true, '{_B8_PROFILE}')",
    # Deferred 0004 invariant: an ACTIVE project template needs an active
    # version row by COMMIT time.
    "INSERT INTO public.extraction_template_versions "
    "(id, project_template_id, version, schema, published_by, is_active) VALUES "
    f"('00510000-0000-4000-8000-0000000000aa', '{_B8_TEMPLATE}', 1, "
    f"'{{\"entity_types\": []}}'::jsonb, '{_B8_PROFILE}', true)",
    "INSERT INTO public.extraction_templates_global "
    "(id, name, framework, version, kind, is_global, schema) VALUES "
    f"('{_B8_GLOBAL_TPL}', 'entry-label-0051-global', 'CUSTOM', '1.0', 'extraction', "
    "true, '{}'::jsonb)",
    # `role` is spelled out here on purpose: these rows are inserted at a
    # 0050/0051-era schema, where the column is NOT NULL and 0051's backfill
    # KEYS on `role = 'model_container'`. 0069 drops it far above them.
    "INSERT INTO public.extraction_entity_types "
    "(id, project_template_id, name, label, role, cardinality,"
    " parent_entity_type_id, sort_order, is_required) VALUES "
    f"('{_B8_CONTAINER}', '{_B8_TEMPLATE}', 'prediction_models', 'Prediction Models', "
    "'model_container', 'many', NULL, 0, false)",
    "INSERT INTO public.extraction_entity_types "
    "(id, project_template_id, name, label, role, cardinality,"
    " parent_entity_type_id, sort_order, is_required) VALUES "
    f"('{_B8_SECTION}', '{_B8_TEMPLATE}', 'population', 'Population', "
    "'study_section', 'one', NULL, 1, false)",
    "INSERT INTO public.extraction_entity_types "
    "(id, template_id, name, label, role, cardinality,"
    " parent_entity_type_id, sort_order, is_required) VALUES "
    f"('{_B8_GLOBAL_CONTAINER}', '{_B8_GLOBAL_TPL}', 'prediction_models', "
    "'Prediction Models', 'model_container', 'many', NULL, 0, false)",
)


async def _entry_labels(session: AsyncSession) -> dict[str, str | None]:
    rows = (await session.execute(_B8_ENTRY_LABELS)).all()
    return {row[0]: row[1] for row in rows}


@pytest.mark.asyncio
async def test_migration_0051_round_trip(
    migration_db_url: str, migration_session: AsyncSession
) -> None:
    """``0051_entity_entry_label`` adds ``extraction_entity_types.entry_label``
    and backfills ``'model'`` where ``role='model_container'`` — the role-only
    predicate covers BOTH lineages (global and project) and must stay
    role-only, so the fixture plants a container on each. The backfill runs
    with the 0048 mark-draft trigger DISABLED (0048 docstring WARNING: an
    every-row backfill would stamp every project template), proven by the
    still-NULL draft marker after upgrade. Downgrading to the explicit parent
    ``0050`` drops the column; a second upgrade re-backfills idempotently.
    Every alembic subprocess is preceded by ``rollback()`` so no data-read
    lock outlives the transaction and deadlocks the DDL."""
    assert (await migration_session.execute(_ENTRY_LABEL_COL)).scalar() == 1, (
        "entry_label must exist at HEAD"
    )
    await migration_session.rollback()

    _run_alembic("downgrade", "0050_field_name_unique_heal", database_url=migration_db_url)
    try:
        assert (await migration_session.execute(_ENTRY_LABEL_COL)).scalar() is None, (
            "downgrade must drop entry_label"
        )
        for statement in _B8_FIXTURE_STATEMENTS:
            await migration_session.execute(text(statement))
        # The fixture INSERTs fired the (present-since-0048) mark-draft
        # trigger; reset so a stamped marker after upgrade could only come
        # from the backfill UPDATE. (_CLEAR_HEAL_MARKER/_HEAL_MARKER are
        # generic project_extraction_templates marker queries — reused.)
        await migration_session.execute(_CLEAR_HEAL_MARKER, {"tid": _B8_TEMPLATE})
        await migration_session.commit()
    finally:
        await migration_session.rollback()
        _run_alembic("upgrade", "head", database_url=migration_db_url)

    labels = await _entry_labels(migration_session)
    assert labels[_B8_CONTAINER] == "model", (
        "backfill must stamp 'model' on the project-lineage container"
    )
    assert labels[_B8_GLOBAL_CONTAINER] == "model", (
        "backfill must cover the GLOBAL lineage too (role-only predicate)"
    )
    assert labels[_B8_SECTION] is None, "study_section rows must stay NULL"
    assert (await migration_session.execute(_HEAL_MARKER, {"tid": _B8_TEMPLATE})).scalar() is (
        None
    ), "the backfill must not stamp config_draft_since (0048 trigger disabled)"
    await migration_session.rollback()

    # Downgrade drops the column; the second upgrade re-adds it and the
    # backfill re-stamps the containers (idempotent re-run).
    _run_alembic("downgrade", "0050_field_name_unique_heal", database_url=migration_db_url)
    try:
        assert (await migration_session.execute(_ENTRY_LABEL_COL)).scalar() is None, (
            "second downgrade must drop entry_label again"
        )
    finally:
        await migration_session.rollback()
        _run_alembic("upgrade", "head", database_url=migration_db_url)

    labels = await _entry_labels(migration_session)
    assert labels[_B8_CONTAINER] == "model", "second upgrade must re-backfill the container"
    assert labels[_B8_GLOBAL_CONTAINER] == "model"
    assert labels[_B8_SECTION] is None
    assert (await migration_session.execute(_HEAL_MARKER, {"tid": _B8_TEMPLATE})).scalar() is (
        None
    ), "the re-backfill must not stamp config_draft_since either"
    await migration_session.rollback()


_PROPOSAL_PROVENANCE_COL = text(
    "SELECT 1 FROM information_schema.columns "
    "WHERE table_schema = 'public' AND table_name = 'extraction_proposal_records' "
    "AND column_name = 'provenance'"
)

# `authenticated` must never be able to UPDATE the provenance column: it is the
# audit record of HOW a value was produced, and the baseline grants that role a
# table-wide UPDATE it can drive straight through PostgREST. NOTE the shape —
# a bare `REVOKE UPDATE (provenance) ... FROM authenticated` is a silent NO-OP
# against a table-level grant (verified empirically); 0056 revokes the table-wide
# UPDATE and re-grants the remaining columns explicitly.
_AUTHENTICATED_CAN_UPDATE_PROVENANCE = text(
    "SELECT has_column_privilege("
    "'authenticated', 'public.extraction_proposal_records', 'provenance', 'UPDATE')"
)
_AUTHENTICATED_CAN_UPDATE_VALUE = text(
    "SELECT has_column_privilege("
    "'authenticated', 'public.extraction_proposal_records', 'proposed_value', 'UPDATE')"
)
# INSERT matters as much as UPDATE: DELETE stays granted and ``id`` is
# client-suppliable, so a revoke that closed only UPDATE would still let
# delete-then-insert reproduce a row with a forged engine record.
_AUTHENTICATED_CAN_INSERT_PROVENANCE = text(
    "SELECT has_column_privilege("
    "'authenticated', 'public.extraction_proposal_records', 'provenance', 'INSERT')"
)


@pytest.mark.asyncio
async def test_migration_0056_round_trip(
    migration_db_url: str, migration_session: AsyncSession
) -> None:
    """``0056_proposal_provenance`` adds ``extraction_proposal_records.provenance``.
    Downgrading to the explicit parent ``0055_project_llm_endpoints`` drops it and
    restores the table-wide UPDATE grant; upgrading to head restores both."""
    assert (await migration_session.execute(_PROPOSAL_PROVENANCE_COL)).scalar() == 1, (
        "provenance must exist at HEAD"
    )

    _run_alembic("downgrade", "0055_project_llm_endpoints", database_url=migration_db_url)
    try:
        await migration_session.commit()
        assert (await migration_session.execute(_PROPOSAL_PROVENANCE_COL)).scalar() is None, (
            "downgrade must drop provenance"
        )
        assert (
            await migration_session.execute(_AUTHENTICATED_CAN_UPDATE_VALUE)
        ).scalar() is True, "downgrade must restore the table-wide grant it narrowed"
    finally:
        _run_alembic("upgrade", "head", database_url=migration_db_url)

    await migration_session.commit()
    assert (await migration_session.execute(_PROPOSAL_PROVENANCE_COL)).scalar() == 1, (
        "upgrade head must restore provenance"
    )


@pytest.mark.asyncio
async def test_0056_makes_provenance_server_only(migration_session: AsyncSession) -> None:
    """The provenance column is server-written and client-read-only.

    Guards the exact failure this hardening was written against: a column-level
    REVOKE layered on a table-level GRANT does nothing, so the protection can
    look present in the migration and be absent in the database. The column
    grants 0056 left on the other columns were later revoked
    (``0081_revoke_member_writes``): every proposal write goes through the API.
    """
    assert (
        await migration_session.execute(_AUTHENTICATED_CAN_UPDATE_PROVENANCE)
    ).scalar() is False, (
        "authenticated must NOT be able to UPDATE extraction_proposal_records.provenance"
    )
    assert (await migration_session.execute(_AUTHENTICATED_CAN_UPDATE_VALUE)).scalar() is False, (
        "authenticated has no UPDATE on any proposal-record column: writes go through the API"
    )
    assert (
        await migration_session.execute(_AUTHENTICATED_CAN_INSERT_PROVENANCE)
    ).scalar() is False, "authenticated must NOT be able to INSERT a forged provenance either"


@pytest.mark.asyncio
async def test_alembic_head_is_expected_revision(migration_db_url: str) -> None:
    """Pin the head revision id. If a future migration is added without
    updating this assertion, the test reminds us the squash window is
    moving — which is the signal to consider the next squash."""
    out = _run_alembic("current", database_url=migration_db_url)
    # ``alembic current`` prints either ``<revision> (head)`` or just the id;
    # match the revision we expect to live at head.
    expected_head = "0096_screening_full_text"
    assert expected_head in out, f"Expected head revision {expected_head!r}, got:\n{out}"


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


# --- scratch-DB isolation ------------------------------------------------
# These are pure unit tests (no database); they live here because they guard
# the naming/sweep logic defined above. The invariant they protect is the
# whole point of per-pid naming: the sweep must never drop a database that a
# concurrently-running session still owns.


class _FakeAdmin:
    """Minimal ``asyncpg.Connection`` stand-in for ``_drop_stale_scratch_dbs``."""

    def __init__(self, datnames: list[str]) -> None:
        self._datnames = datnames
        self.dropped: list[str] = []

    async def fetch(self, _query: str, pattern: str) -> list[dict[str, str]]:
        prefix = pattern.rstrip("%")
        return [{"datname": name} for name in self._datnames if name.startswith(prefix)]

    async def execute(self, sql: str) -> None:
        self.dropped.append(sql)


def test_scratch_db_name_is_unique_per_process() -> None:
    expected = f"{_SCRATCH_DB_PREFIX}{os.getpid()}"
    assert expected == _SCRATCH_DB_NAME
    assert _SCRATCH_DB_NAME != "prumo_migration_test"


def test_legacy_fixed_name_is_never_swept() -> None:
    """A peer session on the old code still owns the unsuffixed name."""
    assert _STALE_SCRATCH_RE.match("prumo_migration_test") is None


def test_pid_is_alive_for_this_process() -> None:
    assert _pid_is_alive(os.getpid()) is True


async def test_sweep_drops_only_dead_pid_databases(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The safety property: a live session's scratch DB survives the sweep."""
    live, dead = 4242, 4243
    monkeypatch.setattr(
        "tests.integration.test_migration_roundtrip._pid_is_alive",
        lambda pid: pid == live,
    )
    admin = _FakeAdmin(
        [
            f"{_SCRATCH_DB_PREFIX}{live}",
            f"{_SCRATCH_DB_PREFIX}{dead}",
            "prumo_migration_test",  # legacy fixed name, owned by old-code runs
            "postgres",
        ]
    )

    await _drop_stale_scratch_dbs(admin)

    assert admin.dropped == [f"DROP DATABASE IF EXISTS {_SCRATCH_DB_PREFIX}{dead} WITH (FORCE)"]


async def test_sweep_is_a_noop_when_every_pid_is_alive(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        "tests.integration.test_migration_roundtrip._pid_is_alive",
        lambda _pid: True,
    )
    admin = _FakeAdmin([f"{_SCRATCH_DB_PREFIX}1", f"{_SCRATCH_DB_PREFIX}2"])

    await _drop_stale_scratch_dbs(admin)

    assert admin.dropped == []


async def test_sweep_tolerates_a_concurrent_sweeper(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """`DROP DATABASE IF EXISTS` is not atomic against a concurrent drop, so
    the loser of a sweep race must not fail the whole session."""
    monkeypatch.setattr(
        "tests.integration.test_migration_roundtrip._pid_is_alive",
        lambda _pid: False,
    )

    class _RacingAdmin(_FakeAdmin):
        async def execute(self, sql: str) -> None:
            self.dropped.append(sql)
            raise asyncpg.exceptions.InvalidCatalogNameError("database does not exist")

    admin = _RacingAdmin([f"{_SCRATCH_DB_PREFIX}1", f"{_SCRATCH_DB_PREFIX}2"])

    await _drop_stale_scratch_dbs(admin)

    # Both attempted, neither raised out of the sweep.
    assert len(admin.dropped) == 2


# --- 0072: llm_connections + user_project_engines -------------------------
_CONN_CHECK_DEF = text("SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = :name")


@pytest.mark.asyncio
async def test_llm_connections_checks_match_the_registry_at_head(
    migration_session: AsyncSession,
) -> None:
    """The live CHECKs name exactly the registry's providers / project
    scopes — the migration is hand-written literals, so this is the only
    thing tying it to ``app.llm.registry``. Names carry the ``ck_`` prefix
    the naming convention adds (models/base.py)."""
    import re

    from app.llm.registry import REGISTRY, provider_ids

    provider_def = (
        await migration_session.execute(
            _CONN_CHECK_DEF, {"name": "ck_llm_connections_provider_check"}
        )
    ).scalar()
    assert provider_def is not None, "ck_llm_connections_provider_check must exist at head"
    assert set(re.findall(r"'([a-z_]+)'", provider_def)) == set(provider_ids())

    scopes_def = (
        await migration_session.execute(
            _CONN_CHECK_DEF, {"name": "ck_llm_connections_scopes_check"}
        )
    ).scalar()
    assert scopes_def is not None, "ck_llm_connections_scopes_check must exist at head"
    expected = {spec.id for spec in REGISTRY if "project" in spec.scopes}
    assert set(re.findall(r"'([a-z_]+)'", scopes_def)) - {"user"} == expected


@pytest.mark.asyncio
async def test_0072_tables_are_deny_all_and_revoked(migration_session: AsyncSession) -> None:
    for table in ("llm_connections", "user_project_engines"):
        policies = (
            (
                await migration_session.execute(
                    text("SELECT polname FROM pg_policy WHERE polrelid = CAST(:t AS regclass)"),
                    {"t": f"public.{table}"},
                )
            )
            .scalars()
            .all()
        )
        assert policies == ["deny_all"], table
        grants = (
            await migration_session.execute(
                text(
                    "SELECT count(*) FROM information_schema.role_table_grants "
                    "WHERE table_schema = 'public' AND table_name = :t "
                    "AND grantee IN ('authenticated', 'anon')"
                ),
                {"t": table},
            )
        ).scalar()
        assert grants == 0, table


# --- 0073: drop user_api_keys / project_llm_endpoints, strip alternates -----
_R73_PROFILE = "00730000-0000-4000-8000-00000000000a"
_R73_WITH = "00730000-0000-4000-8000-000000000001"
_R73_WITHOUT = "00730000-0000-4000-8000-000000000002"
_R73_SEED = (
    "INSERT INTO auth.users (id, email, instance_id, aud, role) VALUES "
    f"('{_R73_PROFILE}', 'legacy-0073@integration-test.prumo.local', "
    "'00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated')",
    "INSERT INTO public.profiles (id, email, full_name) VALUES "
    f"('{_R73_PROFILE}', 'legacy-0073@integration-test.prumo.local', 'Legacy 0073')",
    "INSERT INTO public.projects (id, name, created_by_id, is_active, settings) VALUES "
    f"('{_R73_WITH}', 'Alternates 0073', '{_R73_PROFILE}', true, "
    '\'{"parsing": {"type": "standard"}, "llm_engine": {"provider": "openai", '
    '"model": "gpt-5.6-terra", "mode": "fast", "alternates": [{"provider": "anthropic", '
    '"model": "claude-sonnet-5"}]}}\'::jsonb)',
    "INSERT INTO public.projects (id, name, created_by_id, is_active, settings) VALUES "
    f"('{_R73_WITHOUT}', 'No alternates 0073', '{_R73_PROFILE}', true, "
    '\'{"llm_engine": {"provider": "openai", "model": "gpt-5.6-terra", "mode": "verified"}}\'::jsonb)',
)
_R73_SETTINGS = text("SELECT settings::text FROM public.projects WHERE id = :pid")
_R73_TABLE_EXISTS = text("SELECT to_regclass(:name) IS NOT NULL")


@pytest.mark.asyncio
async def test_migration_0073_drops_the_legacy_tables_and_strips_alternates(
    migration_db_url: str, migration_session: AsyncSession
) -> None:
    """§2 + §7.5: driven through alembic. Seeded while downgraded to 0072,
    upgraded to head: ``alternates`` is gone from the row that carried it,
    the row without it is byte-identical, both legacy tables and the
    orphaned trigger function are gone; the downgrade re-creates the
    tables' schema and never resurrects ``alternates``."""
    _run_alembic("downgrade", "0072_llm_connections", database_url=migration_db_url)
    try:
        for stmt in _R73_SEED:
            await migration_session.execute(text(stmt))
        await migration_session.commit()
        before_without = (
            await migration_session.execute(_R73_SETTINGS, {"pid": _R73_WITHOUT})
        ).scalar_one()
        assert (
            await migration_session.execute(_R73_TABLE_EXISTS, {"name": "public.user_api_keys"})
        ).scalar() is True
        # Release the AccessShare locks the reads above took: the alembic
        # subprocess below needs ACCESS EXCLUSIVE to DROP those tables and
        # would block forever behind an open read transaction (file rule).
        await migration_session.rollback()
    finally:
        _run_alembic("upgrade", "head", database_url=migration_db_url)
    await migration_session.commit()

    with_settings = (
        await migration_session.execute(_R73_SETTINGS, {"pid": _R73_WITH})
    ).scalar_one()
    assert "alternates" not in with_settings and '"parsing"' in with_settings
    assert (
        await migration_session.execute(_R73_SETTINGS, {"pid": _R73_WITHOUT})
    ).scalar_one() == before_without
    for name in ("public.user_api_keys", "public.project_llm_endpoints"):
        assert (
            await migration_session.execute(_R73_TABLE_EXISTS, {"name": name})
        ).scalar() is False, name
    assert (
        await migration_session.execute(
            text("SELECT count(*) FROM pg_proc WHERE proname = 'ensure_single_default_api_key'")
        )
    ).scalar() == 0

    await migration_session.rollback()
    _run_alembic("downgrade", "0072_llm_connections", database_url=migration_db_url)
    try:
        await migration_session.commit()
        assert (
            await migration_session.execute(_R73_TABLE_EXISTS, {"name": "public.user_api_keys"})
        ).scalar() is True
        assert (
            "alternates"
            not in (await migration_session.execute(_R73_SETTINGS, {"pid": _R73_WITH})).scalar_one()
        )
        await migration_session.rollback()
    finally:
        _run_alembic("upgrade", "head", database_url=migration_db_url)
    await migration_session.commit()


# --- 0074: ollama provider ------------------------------------------------
async def _conn_check_ids(session: AsyncSession, name: str) -> set[str]:
    import re

    definition = (await session.execute(_CONN_CHECK_DEF, {"name": name})).scalar()
    assert definition is not None, f"{name} must exist"
    await session.rollback()
    return set(re.findall(r"'([a-z_]+)'", definition))


@pytest.mark.asyncio
async def test_migration_0074_adds_ollama_to_both_checks_and_downgrade_removes_it(
    migration_db_url: str, migration_session: AsyncSession
) -> None:
    """Driven through alembic: at head both CHECKs name ``ollama``; downgraded
    to 0073 neither does (its DELETE ran before re-adding the narrower CHECK)."""
    assert "ollama" in await _conn_check_ids(migration_session, "ck_llm_connections_provider_check")
    assert "ollama" in await _conn_check_ids(migration_session, "ck_llm_connections_scopes_check")

    _run_alembic("downgrade", "0073_drop_legacy_credentials", database_url=migration_db_url)
    try:
        provider_ids = await _conn_check_ids(migration_session, "ck_llm_connections_provider_check")
        scope_ids = await _conn_check_ids(migration_session, "ck_llm_connections_scopes_check")
        assert "ollama" not in provider_ids and "google" in provider_ids
        assert "ollama" not in scope_ids and "google" in scope_ids
    finally:
        _run_alembic("upgrade", "head", database_url=migration_db_url)
    assert "ollama" in await _conn_check_ids(migration_session, "ck_llm_connections_provider_check")


async def test_migration_0075_attempt_schema_roundtrip(migration_db_url, migration_session):
    async def inspect():
        row = (
            await migration_session.execute(
                text(
                    "SELECT relrowsecurity FROM pg_class WHERE oid=to_regclass('public.extraction_attempts')"
                )
            )
        ).scalar_one_or_none()
        columns = set(
            (
                await migration_session.execute(
                    text(
                        "SELECT column_name FROM information_schema.columns WHERE table_schema='public' "
                        "AND table_name='extraction_proposal_records'"
                    )
                )
            ).scalars()
        )
        await migration_session.rollback()
        return row, columns

    rls, columns = await inspect()
    assert rls is True
    assert {"extraction_attempt_id", "generation_snapshot"} <= columns
    _run_alembic("downgrade", "0074_ollama_provider", database_url=migration_db_url)
    try:
        rls, columns = await inspect()
        assert rls is None
        assert not {"extraction_attempt_id", "generation_snapshot"} & columns
    finally:
        _run_alembic("upgrade", "head", database_url=migration_db_url)
    rls, columns = await inspect()
    assert rls is True
    assert {"extraction_attempt_id", "generation_snapshot"} <= columns


# --- 0078: personal_access_tokens (backend-only, deny_all) ----------------
@pytest.mark.asyncio
async def test_migration_0078_personal_access_tokens_roundtrip(
    migration_db_url: str, migration_session: AsyncSession
) -> None:
    async def posture() -> tuple[list[str], int]:
        policies = (
            (
                await migration_session.execute(
                    text(
                        "SELECT polname FROM pg_policy WHERE polrelid = to_regclass('public.personal_access_tokens')"
                    )
                )
            )
            .scalars()
            .all()
        )
        grants = (
            await migration_session.execute(
                text(
                    "SELECT count(*) FROM information_schema.role_table_grants WHERE table_schema = 'public' "
                    "AND table_name = 'personal_access_tokens' AND grantee IN ('authenticated', 'anon')"
                )
            )
        ).scalar_one()
        await migration_session.rollback()
        return list(policies), int(grants)

    assert await posture() == (["deny_all"], 0)
    _run_alembic("downgrade", "0077_revoke_project_writes", database_url=migration_db_url)
    try:
        assert (await posture())[0] == []  # table gone
    finally:
        _run_alembic("upgrade", "head", database_url=migration_db_url)
    assert await posture() == (["deny_all"], 0)


# --- 0079: agent_actions (backend-only, deny_all) --------------------------
@pytest.mark.asyncio
async def test_migration_0079_agent_actions_roundtrip(
    migration_db_url: str, migration_session: AsyncSession
) -> None:
    async def posture() -> tuple[bool, list[str], int]:
        exists = (
            await migration_session.execute(
                text("SELECT to_regclass('public.agent_actions') IS NOT NULL")
            )
        ).scalar_one()
        policies = (
            (
                await migration_session.execute(
                    text(
                        "SELECT polname FROM pg_policy WHERE polrelid = to_regclass('public.agent_actions')"
                    )
                )
            )
            .scalars()
            .all()
        )
        grants = (
            await migration_session.execute(
                text(
                    "SELECT count(*) FROM information_schema.role_table_grants WHERE table_schema = 'public' "
                    "AND table_name = 'agent_actions' AND grantee IN ('authenticated', 'anon')"
                )
            )
        ).scalar_one()
        await migration_session.rollback()
        return bool(exists), list(policies), int(grants)

    assert await posture() == (True, ["deny_all"], 0)
    _run_alembic("downgrade", "0078_personal_access_tokens", database_url=migration_db_url)
    try:
        assert await posture() == (False, [], 0)  # table, policy and grants gone
    finally:
        _run_alembic("upgrade", "head", database_url=migration_db_url)
    assert await posture() == (True, ["deny_all"], 0)  # re-upgrade restores the REVOKE


# --- 0080: article text FTS index -----------------------------------------
@pytest.mark.asyncio
async def test_migration_0080_article_text_fts_roundtrip(
    migration_db_url: str, migration_session: AsyncSession
) -> None:
    async def has_index() -> bool:
        found = (
            await migration_session.execute(
                text("SELECT to_regclass('public.idx_article_text_blocks_fts') IS NOT NULL")
            )
        ).scalar_one()
        await migration_session.rollback()
        return bool(found)

    assert await has_index()
    _run_alembic("downgrade", "0079_agent_actions", database_url=migration_db_url)
    try:
        assert not await has_index()
    finally:
        _run_alembic("upgrade", "head", database_url=migration_db_url)
    assert await has_index()


# --- 0081: member writes revoked, append-only history trigger ---------------
@pytest.mark.asyncio
async def test_migration_0081_revoke_member_writes_roundtrip(
    migration_db_url: str, migration_session: AsyncSession
) -> None:
    async def posture() -> tuple[bool, bool, bool, bool, bool]:
        row = (
            await migration_session.execute(
                text(
                    "SELECT has_table_privilege("
                    "  'authenticated', 'public.extraction_evidence', 'INSERT'),"
                    " has_any_column_privilege("
                    "  'authenticated', 'public.extraction_proposal_records', 'INSERT'),"
                    " has_any_column_privilege("
                    "  'authenticated', 'public.extraction_proposal_records', 'UPDATE'),"
                    " has_column_privilege('authenticated',"
                    "  'public.extraction_proposal_records', 'proposed_value', 'UPDATE'),"
                    " to_regprocedure('public.refuse_append_only_change()') IS NOT NULL"
                )
            )
        ).one()
        await migration_session.rollback()
        return tuple(bool(v) for v in row)  # type: ignore[return-value]

    revoked = (False, False, False, False, True)
    assert await posture() == revoked
    _run_alembic("downgrade", "0080_article_text_fts", database_url=migration_db_url)
    try:
        assert await posture() == (True, True, True, True, False)
    finally:
        _run_alembic("upgrade", "head", database_url=migration_db_url)
    assert await posture() == revoked


# --- 0082: optional per-project restriction on personal access tokens -------
@pytest.mark.asyncio
async def test_migration_0082_pat_project_scope_roundtrip(
    migration_db_url: str, migration_session: AsyncSession
) -> None:
    user_id, restricted_id, open_id = uuid4(), uuid4(), uuid4()

    async def column_and_check() -> tuple[bool, bool]:
        row = (
            await migration_session.execute(
                text(
                    "SELECT EXISTS (SELECT 1 FROM information_schema.columns"
                    "  WHERE table_schema = 'public' AND table_name = 'personal_access_tokens'"
                    "  AND column_name = 'project_ids'),"
                    " EXISTS (SELECT 1 FROM pg_constraint"
                    "  WHERE conname = 'ck_personal_access_tokens_project_ids_check'"
                    "  AND conrelid = 'public.personal_access_tokens'::regclass)"
                )
            )
        ).one()
        await migration_session.rollback()
        return bool(row[0]), bool(row[1])

    async def revoked() -> dict[str, bool]:
        rows = (
            await migration_session.execute(
                text(
                    "SELECT id::text, revoked_at IS NOT NULL FROM public.personal_access_tokens "
                    "WHERE user_id = :u"
                ),
                {"u": str(user_id)},
            )
        ).all()
        await migration_session.rollback()
        return {r[0]: bool(r[1]) for r in rows}

    async def insert_token(token_id: UUID, project_ids: list[str] | None) -> None:
        await migration_session.execute(
            text(
                "INSERT INTO public.personal_access_tokens (id, user_id, name, token_prefix,"
                " token_hash, scope, expires_at, project_ids) VALUES (:id, :u, 't',"
                " 'prumo_pat_x', :h, 'read', now() + interval '1 day', CAST(:p AS uuid[]))"
            ),
            {"id": str(token_id), "u": str(user_id), "h": str(token_id), "p": project_ids},
        )

    assert await column_and_check() == (True, True)
    await migration_session.execute(
        text(
            "INSERT INTO auth.users (id, email, instance_id, aud, role) VALUES (:u,"
            " 'pat-0082@test.local', '00000000-0000-0000-0000-000000000000',"
            " 'authenticated', 'authenticated')"
        ),
        {"u": str(user_id)},
    )
    await migration_session.execute(
        text("INSERT INTO public.profiles (id, email) VALUES (:u, 'pat-0082@test.local')"),
        {"u": str(user_id)},
    )
    await migration_session.commit()
    try:
        with pytest.raises(Exception, match="ck_personal_access_tokens_project_ids_check"):
            await insert_token(uuid4(), [])
        await migration_session.rollback()
        await insert_token(restricted_id, [str(uuid4())])
        await insert_token(open_id, None)
        await migration_session.commit()
        assert await revoked() == {str(restricted_id): False, str(open_id): False}
        _run_alembic("downgrade", "0081_revoke_member_writes", database_url=migration_db_url)
        try:
            assert await column_and_check() == (False, False)
            # Fail closed: a restricted token never survives as an all-projects token.
            assert await revoked() == {str(restricted_id): True, str(open_id): False}
        finally:
            _run_alembic("upgrade", "head", database_url=migration_db_url)
        assert await column_and_check() == (True, True)
        assert await revoked() == {str(restricted_id): True, str(open_id): False}
    finally:
        await migration_session.execute(
            text("DELETE FROM public.profiles WHERE id = :u"), {"u": str(user_id)}
        )
        await migration_session.execute(
            text("DELETE FROM auth.users WHERE id = :u"), {"u": str(user_id)}
        )
        await migration_session.commit()


# --- 0083: OAuth connections to the MCP server -------------------------------
_OAUTH_TABLES = ("mcp_oauth_clients", "mcp_oauth_requests", "mcp_oauth_tokens")
_OAUTH_CHECKS = (
    "ck_personal_access_tokens_kind_check",
    "ck_personal_access_tokens_kind_shape_check",
    "ck_mcp_oauth_clients_client_name_check",
    "ck_mcp_oauth_clients_redirect_uris_check",
    "ck_mcp_oauth_tokens_kind_check",
)


@pytest.mark.asyncio
async def test_migration_0083_mcp_oauth_roundtrip(
    migration_db_url: str, migration_session: AsyncSession
) -> None:
    user_id, project_id, client_id = uuid4(), uuid4(), uuid4()
    pat_id, connection_id, action_id = uuid4(), uuid4(), uuid4()
    session = migration_session

    async def schema() -> tuple[set[str], set[str], set[str]]:
        tables = set(
            (
                await session.execute(
                    text(
                        "SELECT table_name FROM information_schema.tables "
                        "WHERE table_schema = 'public' AND table_name = ANY(:t)"
                    ),
                    {"t": list(_OAUTH_TABLES)},
                )
            )
            .scalars()
            .all()
        )
        columns = set(
            (
                await session.execute(
                    text(
                        "SELECT column_name FROM information_schema.columns "
                        "WHERE table_schema = 'public' AND table_name = 'personal_access_tokens' "
                        "AND column_name IN ('kind', 'oauth_client_id')"
                    )
                )
            )
            .scalars()
            .all()
        )
        checks = set(
            (
                await session.execute(
                    text("SELECT conname FROM pg_constraint WHERE conname = ANY(:c)"),
                    {"c": list(_OAUTH_CHECKS)},
                )
            )
            .scalars()
            .all()
        )
        await session.rollback()
        return tables, columns, checks

    async def scalar(sql: str, **params: str) -> object:
        value = (await session.execute(text(sql), params)).scalar_one_or_none()
        await session.rollback()
        return value

    at_head = (set(_OAUTH_TABLES), {"kind", "oauth_client_id"}, set(_OAUTH_CHECKS))
    assert await schema() == at_head
    for sql in (
        "INSERT INTO auth.users (id, email, instance_id, aud, role) VALUES (:u,"
        " 'oauth-0083@test.local', '00000000-0000-0000-0000-000000000000',"
        " 'authenticated', 'authenticated')",
        "INSERT INTO public.profiles (id, email) VALUES (:u, 'oauth-0083@test.local')",
        "INSERT INTO public.projects (id, name, created_by_id, is_active)"
        " VALUES (:p, 'OAuth 0083 Project', :u, true)",
    ):
        await session.execute(text(sql), {"u": str(user_id), "p": str(project_id)})
    await session.commit()
    try:
        # A PAT row written without `kind` defaults to 'pat'.
        await session.execute(
            text(
                "INSERT INTO public.personal_access_tokens (id, user_id, name, token_prefix,"
                " token_hash, scope, expires_at) VALUES (:id, :u, 'pat', 'prumo_pat_x',"
                " 'hash-0083', 'read', now() + interval '1 day')"
            ),
            {"id": str(pat_id), "u": str(user_id)},
        )
        await session.execute(
            text(
                "INSERT INTO public.mcp_oauth_clients (client_id, client_name, redirect_uris,"
                " scope) VALUES (:c, 'Claude', ARRAY['https://claude.ai/cb'], 'read write')"
            ),
            {"c": str(client_id)},
        )
        await session.execute(
            text(
                "INSERT INTO public.personal_access_tokens (id, user_id, kind, oauth_client_id,"
                " name, scope, expires_at) VALUES (:id, :u, 'oauth', :c, 'Claude', 'read_write',"
                " now() + interval '90 days')"
            ),
            {"id": str(connection_id), "u": str(user_id), "c": str(client_id)},
        )
        await session.execute(
            text(
                "INSERT INTO public.agent_actions (id, token_id, user_id, project_id, tool,"
                " input, before, after, outcome, error_code) VALUES (:id, :tok, :u, :p,"
                " 'edit_template_draft', '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, 'applied', NULL)"
            ),
            {
                "id": str(action_id),
                "tok": str(connection_id),
                "u": str(user_id),
                "p": str(project_id),
            },
        )
        await session.commit()
        assert (
            await scalar(
                "SELECT kind FROM public.personal_access_tokens WHERE id = :id", id=str(pat_id)
            )
            == "pat"
        )

        with pytest.raises(Exception, match="uq_personal_access_tokens_oauth_user_client"):
            await session.execute(
                text(
                    "INSERT INTO public.personal_access_tokens (id, user_id, kind, oauth_client_id,"
                    " name, scope, expires_at) VALUES (gen_random_uuid(), :u, 'oauth', :c, 'Claude', 'read',"
                    " now() + interval '90 days')"
                ),
                {"u": str(user_id), "c": str(client_id)},
            )
        await session.rollback()

        _run_alembic("downgrade", "0082_pat_project_scope", database_url=migration_db_url)
        try:
            assert await schema() == (set(), set(), set())
            assert (
                await scalar(
                    "SELECT count(*) FROM public.personal_access_tokens WHERE id = :id",
                    id=str(connection_id),
                )
                == 0
            )
            assert (
                await scalar(
                    "SELECT token_id IS NULL FROM public.agent_actions WHERE id = :id",
                    id=str(action_id),
                )
                is True
            )
            assert (
                await scalar(
                    "SELECT token_hash FROM public.personal_access_tokens WHERE id = :id",
                    id=str(pat_id),
                )
                == "hash-0083"
            )
        finally:
            _run_alembic("upgrade", "head", database_url=migration_db_url)
        assert await schema() == at_head
    finally:
        await session.rollback()
        await session.execute(
            text("DELETE FROM public.mcp_oauth_clients WHERE client_id = :c"), {"c": str(client_id)}
        )
        for sql in (
            "DELETE FROM public.projects WHERE id = :p",
            "DELETE FROM public.profiles WHERE id = :u",
            "DELETE FROM auth.users WHERE id = :u",
        ):
            await session.execute(text(sql), {"u": str(user_id), "p": str(project_id)})
        await session.commit()


@pytest.mark.asyncio
async def test_migration_0084_canonical_options_roundtrip(migration_db_url: str) -> None:
    """Data-only and forward-only: the downgrade is a no-op, and the upgrade
    re-runs cleanly over rows that are already canonical."""
    try:
        _run_alembic("downgrade", "0083_mcp_oauth", database_url=migration_db_url)
        assert "0083_mcp_oauth" in _run_alembic("current", database_url=migration_db_url)
    finally:
        _run_alembic("upgrade", "head", database_url=migration_db_url)
    assert "(head)" in _run_alembic("current", database_url=migration_db_url)


@pytest.mark.asyncio
async def test_migration_0085_freeze_qa_rules_roundtrip(migration_db_url: str) -> None:
    """Data-only: the downgrade strips the rules keys, the re-upgrade
    backfills them again from the templates' current rules."""
    try:
        _run_alembic("downgrade", "0084_canonical_field_options", database_url=migration_db_url)
        assert "0084_canonical_field_options" in _run_alembic(
            "current", database_url=migration_db_url
        )
    finally:
        _run_alembic("upgrade", "head", database_url=migration_db_url)
    assert "(head)" in _run_alembic("current", database_url=migration_db_url)


_0086_INDEXES = (
    "idx_extraction_evidence_proposal_record_id",
    "idx_extraction_evidence_reviewer_decision_id",
    "idx_extraction_evidence_consensus_decision_id",
)
_0086_FKS = ("fk_hitl_configs_scope_project", "fk_hitl_configs_scope_template")
_0086_COLUMNS = ("scope_project_id", "scope_template_id")


@pytest.mark.asyncio
async def test_migration_0086_evidence_idx_hitl_fk_roundtrip(
    migration_db_url: str, migration_session: AsyncSession
) -> None:
    """Downgrade drops the evidence indexes, the scope FKs and columns; the
    re-upgrade deletes orphan configs of both scope kinds planted while
    downgraded and ties the surviving rows to their project or template."""
    user_id, project_id, template_id = uuid4(), uuid4(), uuid4()
    live_project_cfg, live_template_cfg = uuid4(), uuid4()
    orphan_project_cfg, orphan_template_cfg = uuid4(), uuid4()
    session = migration_session

    async def names(sql: str, values: tuple[str, ...]) -> set[str]:
        found = set((await session.execute(text(sql), {"n": list(values)})).scalars().all())
        await session.rollback()
        return found

    async def schema() -> tuple[set[str], set[str], set[str]]:
        return (
            await names(
                "SELECT indexname FROM pg_indexes WHERE indexname = ANY(:n)", _0086_INDEXES
            ),
            await names("SELECT conname FROM pg_constraint WHERE conname = ANY(:n)", _0086_FKS),
            await names(
                "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public'"
                " AND table_name = 'extraction_hitl_configs' AND column_name = ANY(:n)",
                _0086_COLUMNS,
            ),
        )

    at_head = (set(_0086_INDEXES), set(_0086_FKS), set(_0086_COLUMNS))
    assert await schema() == at_head
    ids = {
        "u": str(user_id),
        "p": str(project_id),
        "t": str(template_id),
        "cp": str(live_project_cfg),
        "ct": str(live_template_cfg),
        "op": str(orphan_project_cfg),
        "ot": str(orphan_template_cfg),
    }
    try:
        _run_alembic("downgrade", "0085_freeze_qa_rules", database_url=migration_db_url)
        try:
            assert await schema() == (set(), set(), set())
            for sql in (
                "INSERT INTO auth.users (id, email, instance_id, aud, role) VALUES (:u,"
                " 'hitl-0086@test.local', '00000000-0000-0000-0000-000000000000',"
                " 'authenticated', 'authenticated')",
                "INSERT INTO public.profiles (id, email) VALUES (:u, 'hitl-0086@test.local')",
                "INSERT INTO public.projects (id, name, created_by_id, is_active)"
                " VALUES (:p, 'HITL 0086 Project', :u, true)",
                "INSERT INTO public.project_extraction_templates (id, project_id, name,"
                " framework, version, kind, schema, is_active, created_by) VALUES (:t, :p,"
                " 'hitl-0086-template', 'CUSTOM', '1.0', 'extraction', '{}'::jsonb, false, :u)",
                # Deferred invariant: every project template needs an active version.
                "INSERT INTO public.extraction_template_versions (id, project_template_id,"
                " version, schema, published_by, is_active) VALUES (gen_random_uuid(), :t, 1,"
                " '{\"entity_types\": []}'::jsonb, :u, true)",
                "INSERT INTO public.extraction_hitl_configs (id, scope_kind, scope_id,"
                " reviewer_count, consensus_rule) VALUES (:cp, 'project', :p, 2, 'majority'),"
                " (:ct, 'template', :t, 1, 'unanimous'), (:op, 'project', :op, 1, 'unanimous'),"
                " (:ot, 'template', :ot, 1, 'unanimous')",
            ):
                await session.execute(text(sql), ids)
            await session.commit()
        finally:
            _run_alembic("upgrade", "head", database_url=migration_db_url)
        assert "(head)" in _run_alembic("current", database_url=migration_db_url)
        assert await schema() == at_head
        rows = {
            row.id: (row.scope_project_id, row.scope_template_id)
            for row in (
                await session.execute(
                    text(
                        "SELECT id, scope_project_id, scope_template_id"
                        " FROM public.extraction_hitl_configs WHERE id IN (:cp, :ct, :op, :ot)"
                    ),
                    ids,
                )
            ).all()
        }
        await session.rollback()
        assert rows == {
            live_project_cfg: (project_id, None),
            live_template_cfg: (None, template_id),
        }
    finally:
        await session.rollback()
        for sql in (
            "DELETE FROM public.extraction_hitl_configs WHERE id IN (:cp, :ct, :op, :ot)",
            "DELETE FROM public.project_extraction_templates WHERE id = :t",
            "DELETE FROM public.projects WHERE id = :p",
            "DELETE FROM public.profiles WHERE id = :u",
            "DELETE FROM auth.users WHERE id = :u",
        ):
            await session.execute(text(sql), ids)
        await session.commit()


_0087_TABLES = ("extraction_templates_global", "project_extraction_templates")
_0087_CHECKS = (
    "ck_extraction_templates_global_instrument",
    "ck_project_extraction_templates_instrument",
)


@pytest.mark.asyncio
async def test_migration_0087_template_instrument_roundtrip(
    migration_db_url: str, migration_session: AsyncSession
) -> None:
    """Both template tables gain a checked ``instrument`` column; the
    downgrade drops column and CHECK, the re-upgrade restores both.
    ``alembic check`` ignores CHECKs, so the names are asserted here."""
    session = migration_session

    async def schema() -> tuple[set[str], set[str]]:
        tables = set(
            (
                await session.execute(
                    text(
                        "SELECT table_name FROM information_schema.columns"
                        " WHERE table_schema = 'public' AND column_name = 'instrument'"
                        " AND table_name = ANY(:n)"
                    ),
                    {"n": list(_0087_TABLES)},
                )
            )
            .scalars()
            .all()
        )
        checks = set(
            (
                await session.execute(
                    text("SELECT conname FROM pg_constraint WHERE conname = ANY(:n)"),
                    {"n": list(_0087_CHECKS)},
                )
            )
            .scalars()
            .all()
        )
        await session.rollback()
        return tables, checks

    at_head = (set(_0087_TABLES), set(_0087_CHECKS))
    assert await schema() == at_head
    try:
        _run_alembic("downgrade", "0086_evidence_idx_hitl_fk", database_url=migration_db_url)
        assert await schema() == (set(), set())
    finally:
        _run_alembic("upgrade", "head", database_url=migration_db_url)
    assert "(head)" in _run_alembic("current", database_url=migration_db_url)
    assert await schema() == at_head


@pytest.mark.asyncio
async def test_migration_0088_protocol_revision_roundtrip(
    migration_db_url: str, migration_session: AsyncSession
) -> None:
    """``projects`` gains a checked ``protocol_revision`` counter; the
    downgrade drops column and CHECK, the re-upgrade restores both.
    ``alembic check`` ignores CHECKs, so the name is asserted here."""
    session = migration_session

    async def schema() -> tuple[bool, bool]:
        column = (
            await session.execute(
                text(
                    "SELECT 1 FROM information_schema.columns"
                    " WHERE table_schema = 'public' AND table_name = 'projects'"
                    " AND column_name = 'protocol_revision'"
                )
            )
        ).scalar_one_or_none() is not None
        check = (
            await session.execute(
                text("SELECT 1 FROM pg_constraint WHERE conname = 'ck_projects_protocol_revision'")
            )
        ).scalar_one_or_none() is not None
        await session.rollback()
        return column, check

    assert await schema() == (True, True)
    try:
        _run_alembic("downgrade", "0087_template_instrument", database_url=migration_db_url)
        assert await schema() == (False, False)
    finally:
        _run_alembic("upgrade", "head", database_url=migration_db_url)
    assert "(head)" in _run_alembic("current", database_url=migration_db_url)
    assert await schema() == (True, True)


@pytest.mark.asyncio
async def test_migration_0089_evidence_content_version_roundtrip(
    migration_db_url: str, migration_session: AsyncSession
) -> None:
    """``extraction_evidence`` gains a nullable ``content_version`` and a
    partial index on ``article_file_id``; the downgrade drops both, the
    re-upgrade restores both."""
    session = migration_session

    async def schema() -> tuple[bool, str | None]:
        column = (
            await session.execute(
                text(
                    "SELECT 1 FROM information_schema.columns"
                    " WHERE table_schema = 'public' AND table_name = 'extraction_evidence'"
                    " AND column_name = 'content_version'"
                )
            )
        ).scalar_one_or_none() is not None
        indexdef = (
            await session.execute(
                text(
                    "SELECT indexdef FROM pg_indexes WHERE schemaname = 'public'"
                    " AND indexname = 'idx_extraction_evidence_article_file_id'"
                )
            )
        ).scalar_one_or_none()
        await session.rollback()
        return column, indexdef

    column, indexdef = await schema()
    assert column is True
    assert indexdef is not None and "WHERE (article_file_id IS NOT NULL)" in indexdef
    try:
        _run_alembic("downgrade", "0088_protocol_revision", database_url=migration_db_url)
        assert await schema() == (False, None)
    finally:
        _run_alembic("upgrade", "head", database_url=migration_db_url)
    assert "(head)" in _run_alembic("current", database_url=migration_db_url)
    column, indexdef = await schema()
    assert column is True
    assert indexdef is not None and "WHERE (article_file_id IS NOT NULL)" in indexdef


_ENTITY_KEY_INDEXDEF = text(
    "SELECT indexdef FROM pg_indexes WHERE schemaname = 'public'"
    " AND indexname = 'uq_extraction_instances_entity_key'"
)


@pytest.mark.asyncio
async def test_migration_0090_entity_key_unique_roundtrip(
    migration_db_url: str, migration_session: AsyncSession
) -> None:
    """``uq_extraction_instances_entity_key`` holds one identity per
    coordinate, roots included (NULLS NOT DISTINCT), over keyed rows only;
    the downgrade drops it, the re-upgrade restores it. The partial WHERE is
    not compared by ``alembic check``, so this indexdef assertion is its guard."""
    session = migration_session

    async def indexdef() -> str | None:
        found = (await session.execute(_ENTITY_KEY_INDEXDEF)).scalar_one_or_none()
        await session.rollback()
        return found

    def assert_shape(found: str | None) -> None:
        assert found is not None
        assert found.startswith("CREATE UNIQUE INDEX")
        assert (
            "(article_id, entity_type_id, parent_instance_id, ((metadata ->> 'entity_key'::text)))"
            in found
        )
        assert "NULLS NOT DISTINCT" in found
        assert found.endswith("WHERE (metadata ? 'entity_key'::text)")

    assert_shape(await indexdef())
    try:
        _run_alembic("downgrade", "0089_evidence_content_version", database_url=migration_db_url)
        assert await indexdef() is None
    finally:
        _run_alembic("upgrade", "head", database_url=migration_db_url)
    assert "(head)" in _run_alembic("current", database_url=migration_db_url)
    assert_shape(await indexdef())


# --- 0090: duplicate entity_key heal ---
# Fixed fixture ids (0090-prefixed, hex-only) so assertions can name rows.
_EK_PROFILE = "00900000-0000-4000-8000-00000000000a"
_EK_PROJECT = "00900000-0000-4000-8000-00000000000b"
_EK_TEMPLATE = "00900000-0000-4000-8000-00000000000c"
_EK_ARTICLE = "00900000-0000-4000-8000-00000000000d"
_EK_SECTION = "00900000-0000-4000-8000-00000000000e"
_EK_KEEP = "00900000-0000-4000-8000-000000000001"
_EK_DUP2 = "00900000-0000-4000-8000-000000000002"
_EK_DUP3 = "00900000-0000-4000-8000-000000000003"

# Duplicates are only representable at 0089 (pre-index). created_at is
# staggered explicitly because it is the heal's rank key; the newest loser
# already carries a history entry the heal must append to, not replace.
_EK_FIXTURE_STATEMENTS = (
    "INSERT INTO auth.users (id, email, instance_id, aud, role) VALUES "
    f"('{_EK_PROFILE}', 'heal-0090@integration-test.prumo.local', "
    "'00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated')",
    "INSERT INTO public.profiles (id, email, full_name) VALUES "
    f"('{_EK_PROFILE}', 'heal-0090@integration-test.prumo.local', 'Heal 0090')",
    "INSERT INTO public.projects (id, name, created_by_id, is_active) VALUES "
    f"('{_EK_PROJECT}', 'Heal 0090 Project', '{_EK_PROFILE}', true)",
    "INSERT INTO public.project_extraction_templates "
    "(id, project_id, name, framework, version, kind, schema, is_active, created_by) VALUES "
    f"('{_EK_TEMPLATE}', '{_EK_PROJECT}', 'heal-0090-template', 'CUSTOM', '1.0', "
    f"'extraction', '{{}}'::jsonb, true, '{_EK_PROFILE}')",
    "INSERT INTO public.extraction_template_versions "
    "(id, project_template_id, version, schema, published_by, is_active) VALUES "
    f"('00900000-0000-4000-8000-0000000000aa', '{_EK_TEMPLATE}', 1, "
    f"'{{\"entity_types\": []}}'::jsonb, '{_EK_PROFILE}', true)",
    "INSERT INTO public.articles (id, project_id, title, row_version) VALUES "
    f"('{_EK_ARTICLE}', '{_EK_PROJECT}', 'Heal 0090 Article', 1)",
    "INSERT INTO public.extraction_entity_types "
    "(id, project_template_id, name, label, cardinality, sort_order, entry_label) VALUES "
    f"('{_EK_SECTION}', '{_EK_TEMPLATE}', 'heal_models', 'Heal Models', 'many', 0, 'model')",
    "INSERT INTO public.extraction_instances "
    "(id, project_id, article_id, template_id, entity_type_id, parent_instance_id,"
    " label, sort_order, metadata, created_by, created_at) VALUES "
    f"('{_EK_KEEP}', '{_EK_PROJECT}', '{_EK_ARTICLE}', '{_EK_TEMPLATE}', '{_EK_SECTION}',"
    " NULL, 'Probe', 0, '{\"entity_key\": \"probe\"}'::jsonb,"
    f" '{_EK_PROFILE}', now() - interval '3 hours'), "
    f"('{_EK_DUP2}', '{_EK_PROJECT}', '{_EK_ARTICLE}', '{_EK_TEMPLATE}', '{_EK_SECTION}',"
    " NULL, 'probe', 1, '{\"entity_key\": \"probe\"}'::jsonb,"
    f" '{_EK_PROFILE}', now() - interval '2 hours'), "
    f"('{_EK_DUP3}', '{_EK_PROJECT}', '{_EK_ARTICLE}', '{_EK_TEMPLATE}', '{_EK_SECTION}',"
    ' NULL, \'PROBE\', 2, \'{"entity_key": "probe", "entity_key_history":'
    ' [{"who": "u", "when": "2026-01-01T00:00:00+00:00", "from": "old", "to": "probe"}]}\'::jsonb,'
    f" '{_EK_PROFILE}', now() - interval '1 hour')",
)
_EK_METADATA = text(
    "SELECT id::text, metadata FROM public.extraction_instances WHERE entity_type_id = :sid"
)


@pytest.mark.asyncio
async def test_migration_0090_heals_seeded_duplicates(
    migration_db_url: str, migration_session: AsyncSession
) -> None:
    """Three root holders of one key at one coordinate: the upgrade keeps
    the key on the oldest and moves it into each loser's key history (the
    trail is appended to, never replaced) before the index is built."""
    session = migration_session
    await session.rollback()
    _run_alembic("downgrade", "0089_evidence_content_version", database_url=migration_db_url)
    try:
        for statement in _EK_FIXTURE_STATEMENTS:
            await session.execute(text(statement))
        await session.commit()
    finally:
        await session.rollback()
        _run_alembic("upgrade", "head", database_url=migration_db_url)

    try:
        rows = dict((await session.execute(_EK_METADATA, {"sid": _EK_SECTION})).all())
        await session.rollback()
        assert set(rows) == {_EK_KEEP, _EK_DUP2, _EK_DUP3}
        assert rows[_EK_KEEP] == {"entity_key": "probe"}, "the oldest holder keeps its key"
        for loser in (_EK_DUP2, _EK_DUP3):
            assert "entity_key" not in rows[loser]
            last = rows[loser]["entity_key_history"][-1]
            assert last["who"] == "migration:0090_entity_key_unique"
            assert last["from"] == "probe"
            assert last["to"] is None
            assert re.fullmatch(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\+00:00", last["when"])
        assert len(rows[_EK_DUP2]["entity_key_history"]) == 1
        history = rows[_EK_DUP3]["entity_key_history"]
        assert [entry["from"] for entry in history] == ["old", "probe"]
        assert (await session.execute(_ENTITY_KEY_INDEXDEF)).scalar_one_or_none() is not None
    finally:
        await session.rollback()
        await session.execute(
            text("DELETE FROM public.extraction_instances WHERE entity_type_id = :sid"),
            {"sid": _EK_SECTION},
        )
        await session.commit()


# --- 0091: ai_usage_ledger (backend-only, deny_all) ------------------------
_LEDGER_INDEXES = {
    "ix_ai_usage_ledger_project_created",
    "ix_ai_usage_ledger_owner_created",
    "ix_ai_usage_ledger_run_id",
    "ix_ai_usage_ledger_attempt_id",
    "ix_ai_usage_ledger_batch_id",
}
_LEDGER_INDEXES_AFTER_0091 = {"ix_ai_usage_ledger_agent_token_id"}  # 0093
_LEDGER_CHECKS = {
    "ck_ai_usage_ledger_key_scope",
    "ck_ai_usage_ledger_pass_kind",
    "ck_ai_usage_ledger_outcome",
    "ck_ai_usage_ledger_prompt_tokens_nonneg",
    "ck_ai_usage_ledger_completion_tokens_nonneg",
}


class _LedgerPosture(NamedTuple):
    exists: bool
    rls: bool
    policies: set[str]
    indexes: set[str]
    checks: set[str]


@pytest.mark.asyncio
async def test_migration_0091_ai_usage_ledger_roundtrip(
    migration_db_url: str, migration_session: AsyncSession
) -> None:
    """The ledger table, its five indexes, its CHECKs and the deny-all
    posture exist at head, go with the downgrade, and come back with the
    re-upgrade, REVOKE included (Supabase default privileges would
    otherwise re-grant the client roles)."""
    session = migration_session

    async def posture() -> _LedgerPosture:
        rls = (
            await session.execute(
                text(
                    "SELECT relrowsecurity FROM pg_class "
                    "WHERE oid = to_regclass('public.ai_usage_ledger')"
                )
            )
        ).scalar_one_or_none()
        policies = (
            await session.execute(
                text(
                    "SELECT policyname FROM pg_policies "
                    "WHERE schemaname = 'public' AND tablename = 'ai_usage_ledger'"
                )
            )
        ).scalars()
        indexes = (
            await session.execute(
                text(
                    "SELECT indexname FROM pg_indexes "
                    "WHERE schemaname = 'public' AND tablename = 'ai_usage_ledger'"
                )
            )
        ).scalars()
        checks = (
            await session.execute(
                text(
                    "SELECT conname FROM pg_constraint WHERE contype = 'c' "
                    "AND conrelid = to_regclass('public.ai_usage_ledger')"
                )
            )
        ).scalars()
        found = _LedgerPosture(
            exists=rls is not None,
            rls=bool(rls),
            policies=set(policies),
            indexes=set(indexes) - {"ai_usage_ledger_pkey"},
            checks=set(checks),
        )
        await session.rollback()
        return found

    at_head = _LedgerPosture(
        True, True, {"deny_all"}, _LEDGER_INDEXES | _LEDGER_INDEXES_AFTER_0091, _LEDGER_CHECKS
    )
    assert await posture() == at_head
    try:
        _run_alembic("downgrade", "0090_entity_key_unique", database_url=migration_db_url)
        assert await posture() == _LedgerPosture(False, False, set(), set(), set())
    finally:
        _run_alembic("upgrade", "head", database_url=migration_db_url)
    assert await posture() == at_head
    for role in ("anon", "authenticated"):
        granted = (
            await session.execute(
                text("SELECT has_table_privilege(:role, 'public.ai_usage_ledger', 'SELECT')"),
                {"role": role},
            )
        ).scalar_one()
        await session.rollback()
        assert granted is False, f"{role} regained SELECT on ai_usage_ledger after re-upgrade"


@pytest.mark.asyncio
async def test_migration_0092_pat_ai_run_roundtrip(
    migration_db_url: str, migration_session: AsyncSession
) -> None:
    """The ``ai_run`` column and its lifetime CHECK exist at head, go with the
    downgrade and come back with the re-upgrade; a 90-day OAuth connection
    written before 0092 survives the upgrade with ``ai_run = false``."""
    user_id, client_id, connection_id = uuid4(), uuid4(), uuid4()
    session = migration_session

    async def schema() -> tuple[set[str], set[str]]:
        columns = set(
            (
                await session.execute(
                    text(
                        "SELECT column_name FROM information_schema.columns "
                        "WHERE table_schema = 'public' AND table_name = 'personal_access_tokens' "
                        "AND column_name = 'ai_run'"
                    )
                )
            )
            .scalars()
            .all()
        )
        checks = set(
            (
                await session.execute(
                    text(
                        "SELECT conname FROM pg_constraint WHERE contype = 'c' "
                        "AND conrelid = to_regclass('public.personal_access_tokens') "
                        "AND conname LIKE '%ai_run%'"
                    )
                )
            )
            .scalars()
            .all()
        )
        await session.rollback()
        return columns, checks

    at_head = ({"ai_run"}, {"ck_personal_access_tokens_ai_run_lifetime_check"})
    assert await schema() == at_head
    try:
        _run_alembic("downgrade", "0091_ai_usage_ledger", database_url=migration_db_url)
        try:
            assert await schema() == (set(), set())
            for sql in (
                "INSERT INTO auth.users (id, email, instance_id, aud, role) VALUES (:u,"
                " 'pat-0092@test.local', '00000000-0000-0000-0000-000000000000',"
                " 'authenticated', 'authenticated')",
                "INSERT INTO public.profiles (id, email) VALUES (:u, 'pat-0092@test.local')",
                "INSERT INTO public.mcp_oauth_clients (client_id, client_name, redirect_uris,"
                " scope) VALUES (:c, 'Claude', ARRAY['https://claude.ai/cb'], 'read write')",
                "INSERT INTO public.personal_access_tokens (id, user_id, kind, oauth_client_id,"
                " name, scope, expires_at) VALUES (:id, :u, 'oauth', :c, 'Claude', 'read_write',"
                " now() + interval '90 days')",
            ):
                await session.execute(
                    text(sql), {"u": str(user_id), "c": str(client_id), "id": str(connection_id)}
                )
            await session.commit()
        finally:
            _run_alembic("upgrade", "head", database_url=migration_db_url)
        assert await schema() == at_head
        ai_run = (
            await session.execute(
                text("SELECT ai_run FROM public.personal_access_tokens WHERE id = :id"),
                {"id": str(connection_id)},
            )
        ).scalar_one()
        await session.rollback()
        assert ai_run is False
    finally:
        await session.rollback()
        for sql in (
            "DELETE FROM public.personal_access_tokens WHERE id = :id",
            "DELETE FROM public.mcp_oauth_clients WHERE client_id = :c",
            "DELETE FROM public.profiles WHERE id = :u",
            "DELETE FROM auth.users WHERE id = :u",
        ):
            await session.execute(
                text(sql), {"u": str(user_id), "c": str(client_id), "id": str(connection_id)}
            )
        await session.commit()


# --- 0093: agent-origin batches ---------------------------------------------
_AGENT_BATCH_COLUMNS = {
    ("extraction_batches", "agent_token_id"),
    ("extraction_batches", "agent_engine"),
    ("extraction_batches", "agent_plan_digest"),
    ("ai_usage_ledger", "agent_token_id"),
}
_AGENT_BATCH_INDEXES = {
    "uq_extraction_batches_agent_plan_digest",
    "ix_extraction_batches_agent_token_id",
    "ix_extraction_batches_agent_project_created",
    "ix_ai_usage_ledger_agent_token_id",
}
_AGENT_BATCH_CONSTRAINTS = {
    ("ck_extraction_batches_agent_fields_check", "c", " "),
    ("extraction_batches_agent_token_id_fkey", "f", "n"),
    ("ai_usage_ledger_agent_token_id_fkey", "f", "n"),
}


@pytest.mark.asyncio
async def test_migration_0093_batch_agent_origin_roundtrip(
    migration_db_url: str, migration_session: AsyncSession
) -> None:
    """The agent columns, the CHECK, the three batch indexes (one unique),
    the ledger column and its index, and both SET NULL foreign keys exist at
    head, go with the downgrade to 0092 and come back with the re-upgrade."""
    session = migration_session

    async def schema() -> tuple[set[tuple[str, str]], set[str], set[tuple[str, str, str]]]:
        columns = {
            (row[0], row[1])
            for row in (
                await session.execute(
                    text(
                        "SELECT table_name, column_name FROM information_schema.columns "
                        "WHERE table_schema = 'public' "
                        "AND table_name IN ('extraction_batches', 'ai_usage_ledger') "
                        "AND column_name LIKE 'agent_%'"
                    )
                )
            ).all()
        }
        indexes = set(
            (
                await session.execute(
                    text(
                        "SELECT indexname FROM pg_indexes WHERE schemaname = 'public' "
                        "AND tablename IN ('extraction_batches', 'ai_usage_ledger') "
                        "AND indexname LIKE '%agent%'"
                    )
                )
            ).scalars()
        )
        constraints = {
            (row[0], row[1], row[2])
            for row in (
                await session.execute(
                    text(
                        "SELECT conname, contype::text, confdeltype::text FROM pg_constraint "
                        "WHERE conrelid IN (to_regclass('public.extraction_batches'), "
                        "to_regclass('public.ai_usage_ledger')) AND conname LIKE '%agent%'"
                    )
                )
            ).all()
        }
        await session.rollback()
        return columns, indexes, constraints

    at_head = (_AGENT_BATCH_COLUMNS, _AGENT_BATCH_INDEXES, _AGENT_BATCH_CONSTRAINTS)
    assert await schema() == at_head
    unique = (
        await session.execute(
            text(
                "SELECT indexdef FROM pg_indexes "
                "WHERE indexname = 'uq_extraction_batches_agent_plan_digest'"
            )
        )
    ).scalar_one()
    await session.rollback()
    assert "UNIQUE" in unique and "agent_plan_digest IS NOT NULL" in unique
    try:
        _run_alembic("downgrade", "0092_pat_ai_run", database_url=migration_db_url)
        assert await schema() == (set(), set(), set())
    finally:
        _run_alembic("upgrade", "head", database_url=migration_db_url)
    assert await schema() == at_head


# --- 0094: screening tables + sync-table write revoke --------------------------
_SCREENING_TABLES = ("screening_assignments", "screening_decisions", "screening_arbitrations")
_SYNC_TABLES = ("article_sync_runs", "article_sync_events")


class _ScreeningPosture(NamedTuple):
    rls: dict[str, bool | None]
    policies: dict[str, set[str]]
    triggers: set[tuple[str, str]]
    selected_fk: tuple[bool, bool] | None
    authenticated_select: dict[str, bool | None]
    sync_writes: dict[tuple[str, str, str], bool]


@pytest.mark.asyncio
async def test_migration_0094_screening_v1_roundtrip(
    migration_db_url: str, migration_session: AsyncSession
) -> None:
    """The three deny-all screening tables, their append-only triggers and
    the deferred composite FK exist at head, go with the downgrade to 0093
    (which hands ``authenticated`` its sync-table writes back, never anon)
    and come back with the re-upgrade, REVOKEs included."""
    session = migration_session

    async def posture() -> _ScreeningPosture:
        rls: dict[str, bool | None] = {}
        policies: dict[str, set[str]] = {}
        authenticated_select: dict[str, bool | None] = {}
        for table in _SCREENING_TABLES:
            rls[table] = (
                await session.execute(
                    text("SELECT relrowsecurity FROM pg_class WHERE oid = to_regclass(:t)"),
                    {"t": f"public.{table}"},
                )
            ).scalar_one_or_none()
            policies[table] = set(
                (
                    await session.execute(
                        text(
                            "SELECT policyname FROM pg_policies "
                            "WHERE schemaname = 'public' AND tablename = :t"
                        ),
                        {"t": table},
                    )
                ).scalars()
            )
            authenticated_select[table] = (
                await session.execute(
                    text(
                        "SELECT CASE WHEN to_regclass(:t) IS NOT NULL "
                        "THEN has_table_privilege('authenticated', :t, 'SELECT') END"
                    ),
                    {"t": f"public.{table}"},
                )
            ).scalar_one()
        triggers = {
            (row[0], row[1])
            for row in (
                await session.execute(
                    text(
                        "SELECT tgrelid::regclass::text, tgname FROM pg_trigger "
                        "WHERE NOT tgisinternal AND tgrelid IN "
                        "(to_regclass('public.screening_decisions'), "
                        "to_regclass('public.screening_arbitrations'))"
                    )
                )
            ).all()
        }
        fk = (
            await session.execute(
                text(
                    "SELECT condeferrable, condeferred FROM pg_constraint "
                    "WHERE conname = 'fk_screening_arbitrations_selected_decision_match'"
                )
            )
        ).one_or_none()
        sync_writes = {
            (role, table, privilege): (
                await session.execute(
                    text("SELECT has_table_privilege(:r, :t, :p)"),
                    {"r": role, "t": f"public.{table}", "p": privilege},
                )
            ).scalar_one()
            for role in ("anon", "authenticated")
            for table in _SYNC_TABLES
            for privilege in ("INSERT", "UPDATE", "DELETE")
        }
        await session.rollback()
        return _ScreeningPosture(
            rls=rls,
            policies=policies,
            triggers=triggers,
            selected_fk=None if fk is None else (fk[0], fk[1]),
            authenticated_select=authenticated_select,
            sync_writes=sync_writes,
        )

    no_sync_writes = {
        (role, table, privilege): False
        for role in ("anon", "authenticated")
        for table in _SYNC_TABLES
        for privilege in ("INSERT", "UPDATE", "DELETE")
    }
    at_head = _ScreeningPosture(
        rls=dict.fromkeys(_SCREENING_TABLES, True),
        policies={table: {"deny_all"} for table in _SCREENING_TABLES},
        triggers={
            ("screening_decisions", "refuse_append_only_change"),
            ("screening_arbitrations", "refuse_append_only_change"),
        },
        selected_fk=(True, True),
        authenticated_select=dict.fromkeys(_SCREENING_TABLES, False),
        sync_writes=no_sync_writes,
    )
    at_0093 = _ScreeningPosture(
        rls=dict.fromkeys(_SCREENING_TABLES),
        policies={table: set() for table in _SCREENING_TABLES},
        triggers=set(),
        selected_fk=None,
        authenticated_select=dict.fromkeys(_SCREENING_TABLES),
        sync_writes={key: key[0] == "authenticated" for key in no_sync_writes},
    )
    assert await posture() == at_head
    try:
        _run_alembic("downgrade", "0093_batch_agent_origin", database_url=migration_db_url)
        assert await posture() == at_0093
    finally:
        _run_alembic("upgrade", "head", database_url=migration_db_url)
    assert await posture() == at_head


# --- 0095: full-text phase and the not_retrieved decision ----------------------
_R96_PROFILE = "00960000-0000-4000-8000-00000000000a"
_R96_PROJECT = "00960000-0000-4000-8000-000000000001"
_R96_ARTICLES = (
    "00960000-0000-4000-8000-0000000000a1",
    "00960000-0000-4000-8000-0000000000a2",
)
_R96_TA, _R96_FT, _R96_TA_ARB = (
    "00960000-0000-4000-8000-0000000000b1",
    "00960000-0000-4000-8000-0000000000b2",
    "00960000-0000-4000-8000-0000000000b3",
)
_R96_TA_INCLUDE, _R96_FT_NOT_RETRIEVED = (
    "00960000-0000-4000-8000-0000000000c1",
    "00960000-0000-4000-8000-0000000000c2",
)
_R96_ARBITRATIONS = (
    "00960000-0000-4000-8000-0000000000d1",
    "00960000-0000-4000-8000-0000000000d2",
)
_R96_SEED = (
    "INSERT INTO auth.users (id, email, instance_id, aud, role) VALUES "
    f"('{_R96_PROFILE}', 'ft-0095@integration-test.prumo.local', "
    "'00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated')",
    "INSERT INTO public.profiles (id, email, full_name) VALUES "
    f"('{_R96_PROFILE}', 'ft-0095@integration-test.prumo.local', 'FT 0095')",
    "INSERT INTO public.projects (id, name, created_by_id, is_active) VALUES "
    f"('{_R96_PROJECT}', 'Full text 0095', '{_R96_PROFILE}', true)",
    *(
        f"INSERT INTO public.articles (id, project_id, title) VALUES "
        f"('{article}', '{_R96_PROJECT}', 'Article {article[-2:]}')"
        for article in _R96_ARTICLES
    ),
    "INSERT INTO public.screening_assignments (id, project_id, article_id, phase) VALUES "
    f"('{_R96_TA}', '{_R96_PROJECT}', '{_R96_ARTICLES[0]}', 'title_abstract'), "
    f"('{_R96_FT}', '{_R96_PROJECT}', '{_R96_ARTICLES[0]}', 'full_text'), "
    f"('{_R96_TA_ARB}', '{_R96_PROJECT}', '{_R96_ARTICLES[1]}', 'title_abstract')",
    "INSERT INTO public.screening_decisions (id, assignment_id, reviewer_id, decision) VALUES "
    f"('{_R96_TA_INCLUDE}', '{_R96_TA}', '{_R96_PROFILE}', 'include'), "
    f"('{_R96_FT_NOT_RETRIEVED}', '{_R96_FT}', '{_R96_PROFILE}', 'not_retrieved')",
    "INSERT INTO public.screening_arbitrations "
    "(id, assignment_id, decision, selected_decision_id, decided_by) VALUES "
    f"('{_R96_ARBITRATIONS[0]}', '{_R96_TA_ARB}', 'not_retrieved', NULL, '{_R96_PROFILE}'), "
    f"('{_R96_ARBITRATIONS[1]}', '{_R96_FT}', 'include', '{_R96_FT_NOT_RETRIEVED}', "
    f"'{_R96_PROFILE}')",
)
_R96_COUNTS = text(
    "SELECT "
    "(SELECT count(*) FROM public.screening_assignments WHERE project_id = :pid), "
    "(SELECT count(*) FROM public.screening_assignments "
    " WHERE project_id = :pid AND phase = 'full_text'), "
    "(SELECT count(*) FROM public.screening_decisions d "
    " JOIN public.screening_assignments a ON a.id = d.assignment_id "
    " WHERE a.project_id = :pid AND d.decision = 'not_retrieved'), "
    "(SELECT count(*) FROM public.screening_decisions d "
    " JOIN public.screening_assignments a ON a.id = d.assignment_id "
    " WHERE a.project_id = :pid AND d.decision = 'include'), "
    "(SELECT count(*) FROM public.screening_arbitrations r "
    " JOIN public.screening_assignments a ON a.id = r.assignment_id "
    " WHERE a.project_id = :pid)"
)
_R96_FT_INSERT = text(
    "INSERT INTO public.screening_assignments (project_id, article_id, phase) "
    "VALUES (:pid, :aid, 'full_text')"
)


@pytest.mark.asyncio
async def test_0096_screening_full_text_roundtrip(
    migration_db_url: str, migration_session: AsyncSession
) -> None:
    """At head the full-text phase and ``not_retrieved`` are accepted; the downgrade to
    0095 (duplicate verdicts) removes every full-text assignment, every ``not_retrieved``
    decision and ruling (and a ruling that selected one) and keeps the title/abstract
    include; the CHECKs are narrowed again; the re-upgrade widens them."""
    session = migration_session
    params = {"pid": _R96_PROJECT, "aid": _R96_ARTICLES[1]}
    for stmt in _R96_SEED:
        await session.execute(text(stmt))
    await session.commit()
    # (assignments, full_text assignments, not_retrieved decisions, include decisions, rulings)
    seeded = (3, 1, 1, 1, 2)
    assert tuple((await session.execute(_R96_COUNTS, params)).one()) == seeded
    await session.rollback()

    try:
        _run_alembic("downgrade", "0095_article_duplicate_verdicts", database_url=migration_db_url)
        assert tuple((await session.execute(_R96_COUNTS, params)).one()) == (2, 0, 0, 1, 0)
        with pytest.raises(IntegrityError, match="ck_screening_assignments_phase"):
            await session.execute(_R96_FT_INSERT, params)
        await session.rollback()
    finally:
        _run_alembic("upgrade", "head", database_url=migration_db_url)

    await session.execute(_R96_FT_INSERT, params)
    await session.commit()
    assert (await session.execute(_R96_COUNTS, params)).one()[1] == 1
    await session.rollback()
