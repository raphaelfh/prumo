"""Migration 0045 heal: duplicate live runs collapse to the human-work run.

The main test DB already carries the 0045 partial unique index, so duplicate
live runs are unrepresentable there — the heal can only be exercised on a
scratch database parked at 0044, seeded with the pre-invariant pathology,
then upgraded to head. Mirrors the ``test_migration_roundtrip`` harness
(ephemeral DB + supabase stub + ``_run_alembic``), with its own DB name so
the two suites never interfere.

Scenario seeded at 0044 (three live runs for ONE coordinate):
  * ``run_human``     — oldest, ``extract``,   holds the NEWEST human work
                        (a reviewer decision; plus an older human proposal);
  * ``run_consensus`` — middle, ``consensus``, holds an older consensus
                        decision (the adversarial-review case: consensus-only
                        arbitrator work);
  * ``run_empty``     — NEWEST, ``extract``,   no human work at all (the
                        AI-forked shadow that used to win "newest-first").

After ``upgrade head`` the heal must keep ``run_human`` live (it has the most
recent human activity — the exact ordering ``_resolve_run`` resumes with) and
cancel the other two non-destructively (rows survive; stage='cancelled',
status='failed').
"""

from __future__ import annotations

from collections.abc import AsyncGenerator
from datetime import timedelta
from uuid import uuid4

import asyncpg
import pytest
import pytest_asyncio
from sqlalchemy.engine import make_url

from app.core.config import settings
from tests.integration.test_migration_roundtrip import _STUB_SQL, _run_alembic

_SCRATCH_DB_NAME = "prumo_heal_guard_test"

_PROFILE = str(uuid4())
_PROJECT = str(uuid4())
_ARTICLE = str(uuid4())
_TEMPLATE = str(uuid4())
_ENTITY_TYPE = str(uuid4())
_FIELD = str(uuid4())
_INSTANCE = str(uuid4())
_RUN_HUMAN = str(uuid4())
_RUN_CONSENSUS = str(uuid4())
_RUN_EMPTY = str(uuid4())


async def _seed_duplicate_live_runs(conn: asyncpg.Connection) -> None:
    """Minimal FK graph (mirrors conftest SEED) + the three duplicate runs."""
    await conn.execute(
        "INSERT INTO auth.users (id, email, instance_id, aud, role) VALUES "
        "($1, 'heal@integration-test.prumo.local', "
        "'00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated')",
        _PROFILE,
    )
    await conn.execute(
        "INSERT INTO public.profiles (id, email, full_name) "
        "VALUES ($1, 'heal@integration-test.prumo.local', 'Heal Test')",
        _PROFILE,
    )
    await conn.execute(
        "INSERT INTO public.projects (id, name, created_by_id, is_active) "
        "VALUES ($1, 'Heal Test Project', $2, true)",
        _PROJECT,
        _PROFILE,
    )
    await conn.execute(
        "INSERT INTO public.articles (id, project_id, title, row_version) "
        "VALUES ($1, $2, 'Heal Test Article', 1)",
        _ARTICLE,
        _PROJECT,
    )
    await conn.execute(
        "INSERT INTO public.project_extraction_templates "
        "(id, project_id, name, framework, version, kind, schema, is_active, created_by) "
        "VALUES ($1, $2, 'heal-test-template', 'CUSTOM', '1.0', 'extraction', "
        "'{}'::jsonb, true, $3)",
        _TEMPLATE,
        _PROJECT,
        _PROFILE,
    )
    version_id = str(uuid4())
    await conn.execute(
        "INSERT INTO public.extraction_template_versions "
        "(id, project_template_id, version, schema, published_by, is_active) "
        "VALUES ($1, $2, 1, '{\"entity_types\": []}'::jsonb, $3, true)",
        version_id,
        _TEMPLATE,
        _PROFILE,
    )
    await conn.execute(
        "INSERT INTO public.extraction_entity_types "
        "(id, project_template_id, name, label, cardinality, role, "
        " parent_entity_type_id, sort_order, is_required) "
        "VALUES ($1, $2, 'participants', 'Participants', 'one', "
        "'study_section', NULL, 0, false)",
        _ENTITY_TYPE,
        _TEMPLATE,
    )
    await conn.execute(
        "INSERT INTO public.extraction_fields "
        "(id, entity_type_id, name, label, field_type, is_required) "
        "VALUES ($1, $2, 'sample_size', 'Sample Size', 'number', false)",
        _FIELD,
        _ENTITY_TYPE,
    )
    await conn.execute(
        "INSERT INTO public.extraction_instances "
        "(id, project_id, template_id, entity_type_id, article_id, label, created_by) "
        "VALUES ($1, $2, $3, $4, $5, 'Heal Test Instance', $6)",
        _INSTANCE,
        _PROJECT,
        _TEMPLATE,
        _ENTITY_TYPE,
        _ARTICLE,
        _PROFILE,
    )

    # Three live runs for the SAME (project, article, template, kind) —
    # representable only pre-0045. created_at: human < consensus < empty.
    for run_id, stage, created_offset in (
        (_RUN_HUMAN, "extract", timedelta(hours=3)),
        (_RUN_CONSENSUS, "consensus", timedelta(hours=2)),
        (_RUN_EMPTY, "extract", timedelta(hours=1)),
    ):
        await conn.execute(
            "INSERT INTO public.extraction_runs "
            "(id, project_id, article_id, template_id, version_id, kind, "
            " stage, status, created_by, created_at) "
            "VALUES ($1, $2, $3, $4, $5, 'extraction', $6::extraction_run_stage, "
            "'pending', $7, now() - $8::interval)",
            run_id,
            _PROJECT,
            _ARTICLE,
            _TEMPLATE,
            version_id,
            stage,
            _PROFILE,
            created_offset,
        )

    # run_human: an older human proposal + the NEWEST human activity overall
    # (a reviewer decision 10 minutes ago).
    await conn.execute(
        "INSERT INTO public.extraction_proposal_records "
        "(id, run_id, instance_id, field_id, source, source_user_id, "
        " proposed_value, created_at) "
        "VALUES ($1, $2, $3, $4, 'human', $5, '{\"value\": 42}'::jsonb, "
        "now() - interval '90 minutes')",
        str(uuid4()),
        _RUN_HUMAN,
        _INSTANCE,
        _FIELD,
        _PROFILE,
    )
    await conn.execute(
        "INSERT INTO public.extraction_reviewer_decisions "
        "(id, run_id, instance_id, field_id, reviewer_id, decision, value, created_at) "
        "VALUES ($1, $2, $3, $4, $5, 'edit', '{\"value\": 43}'::jsonb, "
        "now() - interval '10 minutes')",
        str(uuid4()),
        _RUN_HUMAN,
        _INSTANCE,
        _FIELD,
        _PROFILE,
    )
    # run_consensus: consensus work only, OLDER than run_human's decision —
    # ranked below run_human but above the workless run_empty.
    await conn.execute(
        "INSERT INTO public.extraction_consensus_decisions "
        "(id, run_id, instance_id, field_id, consensus_user_id, mode, value, created_at) "
        "VALUES ($1, $2, $3, $4, $5, 'manual_override', "
        "'{\"value\": 44}'::jsonb, now() - interval '60 minutes')",
        str(uuid4()),
        _RUN_CONSENSUS,
        _INSTANCE,
        _FIELD,
        _PROFILE,
    )
    # run_empty: nothing — the AI-forked shadow.


@pytest_asyncio.fixture
async def healed_db_url() -> AsyncGenerator[str, None]:
    """Scratch DB: stub → upgrade 0044 → seed duplicates → upgrade head."""
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

    _run_alembic("upgrade", "0044_instance_delete_cascade", database_url=scratch_dsn)

    scratch = await asyncpg.connect(dsn=scratch_dsn)
    try:
        # One transaction: the DEFERRED active-template/active-version trigger
        # (migration 0004) checks at COMMIT, so template + version must land
        # together — per-statement autocommit would trip it.
        async with scratch.transaction():
            await _seed_duplicate_live_runs(scratch)
    finally:
        await scratch.close()

    _run_alembic("upgrade", "head", database_url=scratch_dsn)
    yield scratch_dsn

    admin = await asyncpg.connect(dsn=admin_dsn)
    try:
        await admin.execute(f"DROP DATABASE IF EXISTS {_SCRATCH_DB_NAME} WITH (FORCE)")
    finally:
        await admin.close()


@pytest.mark.asyncio
async def test_heal_keeps_human_work_run_and_cancels_shadows(healed_db_url: str) -> None:
    conn = await asyncpg.connect(dsn=healed_db_url)
    try:
        rows = {
            str(r["id"]): r
            for r in await conn.fetch(
                "SELECT id, stage, status, error_message "
                "FROM public.extraction_runs WHERE article_id = $1",
                _ARTICLE,
            )
        }
        assert len(rows) == 3, rows

        # The run holding the most recent HUMAN work survives, untouched.
        survivor = rows[_RUN_HUMAN]
        assert survivor["stage"] == "extract"
        assert survivor["status"] == "pending"
        assert survivor["error_message"] is None

        # Both shadows are cancelled non-destructively (rows + their workflow
        # children survive), with the advance_stage status pairing.
        for shadow_id in (_RUN_CONSENSUS, _RUN_EMPTY):
            shadow = rows[shadow_id]
            assert shadow["stage"] == "cancelled", shadow
            assert shadow["status"] == "failed", shadow
            assert "0045" in shadow["error_message"], shadow

        # No workflow row was deleted (CASCADE FKs never fired).
        assert (
            await conn.fetchval(
                "SELECT count(*) FROM public.extraction_consensus_decisions WHERE run_id = $1",
                _RUN_CONSENSUS,
            )
            == 1
        )
        assert (
            await conn.fetchval(
                "SELECT count(*) FROM public.extraction_reviewer_decisions WHERE run_id = $1",
                _RUN_HUMAN,
            )
            == 1
        )

        # The invariant is live: a fourth run for the coordinate is rejected.
        with pytest.raises(asyncpg.UniqueViolationError):
            await conn.execute(
                "INSERT INTO public.extraction_runs "
                "(id, project_id, article_id, template_id, version_id, kind, "
                " stage, status, created_by) "
                "SELECT $1, project_id, article_id, template_id, version_id, "
                "kind, 'extract', 'pending', created_by "
                "FROM public.extraction_runs WHERE id = $2",
                str(uuid4()),
                _RUN_HUMAN,
            )
    finally:
        await conn.close()
