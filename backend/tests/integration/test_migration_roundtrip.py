"""Integration test: alembic migrations are reversible end-to-end.

Drives ``alembic downgrade <parent> → upgrade head`` to verify that every
DDL migration on top of the squash baseline round-trips without leaving the
schema in a different state than where it started.

The round-trips run against an ephemeral database (``prumo_migration_test``)
created per test session on the same Postgres server — never against the
shared dev database. Replaying the chain drops and re-adds columns, and
every dropped column leaves a permanent ``pg_attribute`` tombstone that
counts toward Postgres's 1600-column table limit until the table is
recreated (VACUUM FULL does not clear them), so repeated runs against the
dev DB eventually die with ``TooManyColumnsError``; the downgrades also
destroy real data in the columns they drop. The scratch DB is built exactly
like CI builds its test database: ``supabase_stub.sql`` onto a fresh
database, then ``alembic upgrade head``.
"""

import os
import subprocess
from collections.abc import AsyncGenerator
from pathlib import Path

import asyncpg
import pytest
import pytest_asyncio
from sqlalchemy import text
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.core.config import settings

# Repo root is two levels up from this file; alembic must run with cwd=backend/
_BACKEND_DIR = Path(__file__).resolve().parents[2]

# Same stub CI applies to its scratch postgres before `alembic upgrade head`:
# auth schema + auth.uid()/auth.role() GUC readers (baseline RLS policies
# reference them at CREATE POLICY time), Supabase roles, storage.objects.
_STUB_SQL = Path(__file__).with_name("supabase_stub.sql")

# Fixed name is safe: concurrent pytest sessions are already forbidden for
# this suite (cross-session advisory locks hang), and setup drops leftovers.
_SCRATCH_DB_NAME = "prumo_migration_test"


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


@pytest.mark.asyncio
async def test_alembic_head_is_expected_revision(migration_db_url: str) -> None:
    """Pin the head revision id. If a future migration is added without
    updating this assertion, the test reminds us the squash window is
    moving — which is the signal to consider the next squash."""
    out = _run_alembic("current", database_url=migration_db_url)
    # ``alembic current`` prints either ``<revision> (head)`` or just the id;
    # match the revision we expect to live at head.
    assert "0049_config_write_rls_manager" in out, (
        f"Expected head revision '0049_config_write_rls_manager', got:\n{out}"
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
