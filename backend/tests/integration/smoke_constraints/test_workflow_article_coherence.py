"""DEFERRED trigger from migration 0023: ``trg_<table>_article_coherent``.

Defense-in-depth backstop for GitHub issue #79 (service-layer fix in
PR #189). Asserts the DB rejects any of the five HITL workflow rows whose
``instance.article_id`` differs from its ``run.article_id`` — even on a
direct SQL write that bypasses ``assert_coords_coherent``.

The trigger is DEFERRABLE INITIALLY DEFERRED, so the violation surfaces at
COMMIT. These tests use ``db_session_real`` because the SAVEPOINT-based
default fixture never reaches commit; see
``backend/tests/integration/smoke_constraints/``.
"""

from __future__ import annotations

from typing import NamedTuple
from uuid import UUID, uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

pytestmark = pytest.mark.asyncio

WORKFLOW_TABLES = (
    "extraction_proposal_records",
    "extraction_reviewer_decisions",
    "extraction_reviewer_states",
    "extraction_consensus_decisions",
    "extraction_published_states",
)

# Per-table INSERT for the cross-article (sad) path. Each satisfies its
# table's *immediate* CHECKs (so the row inserts) and leaves only the
# DEFERRED article-coherence trigger to fail at COMMIT. ``reviewer_states``
# is intentionally absent: its (run_id, current_decision_id) composite FK
# requires a coherent reviewer_decision in the same run, which can't exist
# for a cross-article run without far more scaffolding — it is covered
# structurally by ``test_article_coherence_trigger_present_on_all_tables``.
_SAD_PATH_INSERTS: dict[str, str] = {
    "extraction_proposal_records": (
        "INSERT INTO public.extraction_proposal_records "
        "(run_id, instance_id, field_id, source, proposed_value) "
        "VALUES (:run, :inst, :field, 'ai', '{}'::jsonb)"
    ),
    "extraction_reviewer_decisions": (
        "INSERT INTO public.extraction_reviewer_decisions "
        "(run_id, instance_id, field_id, reviewer_id, decision) "
        "VALUES (:run, :inst, :field, :prof, 'reject')"
    ),
    "extraction_consensus_decisions": (
        "INSERT INTO public.extraction_consensus_decisions "
        "(run_id, instance_id, field_id, consensus_user_id, mode, value, rationale) "
        "VALUES (:run, :inst, :field, :prof, 'manual_override', '{}'::jsonb, 'guard')"
    ),
    "extraction_published_states": (
        "INSERT INTO public.extraction_published_states "
        "(run_id, instance_id, field_id, value, published_by) "
        "VALUES (:run, :inst, :field, '{}'::jsonb, :prof)"
    ),
}


class _Fixture(NamedTuple):
    project_id: UUID
    instance_id: UUID  # bound to ``instance_article``
    instance_article: UUID
    field_id: UUID
    template_id: UUID
    version_id: UUID
    profile_id: UUID


async def _discover(session: AsyncSession) -> _Fixture | None:
    """Find a concrete (article-bound) instance plus everything needed to
    spin up an extraction_run against a *different* article.

    Discovery-based (``LIMIT 1``) rather than importing seed IDs, matching
    the dominant integration-test idiom. The autouse seed guarantees at
    least one such instance in CI.
    """
    inst = (
        await session.execute(
            text(
                "SELECT id, article_id, template_id, project_id, entity_type_id "
                "FROM public.extraction_instances "
                "WHERE article_id IS NOT NULL "
                "LIMIT 1"
            )
        )
    ).first()
    if inst is None:
        return None
    instance_id, instance_article, template_id, project_id, entity_type_id = inst

    field_id = (
        await session.execute(
            text("SELECT id FROM public.extraction_fields WHERE entity_type_id = :etid LIMIT 1"),
            {"etid": entity_type_id},
        )
    ).scalar()

    version_id = (
        await session.execute(
            text(
                "SELECT id FROM public.extraction_template_versions "
                "WHERE project_template_id = :tid AND is_active LIMIT 1"
            ),
            {"tid": template_id},
        )
    ).scalar()

    profile_id = (await session.execute(text("SELECT id FROM public.profiles LIMIT 1"))).scalar()

    if not all((field_id, version_id, profile_id)):
        return None
    return _Fixture(
        project_id=project_id,
        instance_id=instance_id,
        instance_article=instance_article,
        field_id=field_id,
        template_id=template_id,
        version_id=version_id,
        profile_id=profile_id,
    )


async def _make_run(session: AsyncSession, fx: _Fixture, *, article_id: UUID) -> UUID:
    """Insert an extraction_run for ``article_id`` under the fixture's
    template/project. Returns the new run id. (``status`` has only a
    Python-side ORM default, so a raw INSERT must set it explicitly.)
    """
    run_id = uuid4()
    await session.execute(
        text(
            "INSERT INTO public.extraction_runs "
            "(id, project_id, article_id, template_id, version_id, kind, stage, "
            " status, created_by) "
            "VALUES (:rid, :pid, :aid, :tid, :vid, 'extraction', 'pending', "
            " 'pending', :prof)"
        ),
        {
            "rid": run_id,
            "pid": fx.project_id,
            "aid": article_id,
            "tid": fx.template_id,
            "vid": fx.version_id,
            "prof": fx.profile_id,
        },
    )
    return run_id


async def _make_article(session: AsyncSession, fx: _Fixture) -> UUID:
    article_id = uuid4()
    await session.execute(
        text(
            "INSERT INTO public.articles (id, project_id, title, row_version) "
            "VALUES (:aid, :pid, 'cross-article coherence guard', 1)"
        ),
        {"aid": article_id, "pid": fx.project_id},
    )
    return article_id


@pytest.mark.parametrize("table_name", list(_SAD_PATH_INSERTS))
async def test_cross_article_workflow_row_rejected_at_commit(
    db_session_real: AsyncSession,
    table_name: str,
) -> None:
    """Sad path: a workflow row whose run and instance belong to different
    articles is rejected. INSERT succeeds (trigger is DEFERRED); COMMIT
    raises. The failed COMMIT rolls back the throwaway article + run, so no
    explicit teardown is needed.
    """
    fx = await _discover(db_session_real)
    if fx is None:
        pytest.skip("Need a seeded article-bound instance with field/version/profile.")

    other_article = await _make_article(db_session_real, fx)
    run_id = await _make_run(db_session_real, fx, article_id=other_article)

    # run -> other_article, instance -> fx.instance_article (different) => incoherent.
    await db_session_real.execute(
        text(_SAD_PATH_INSERTS[table_name]),
        {"run": run_id, "inst": fx.instance_id, "field": fx.field_id, "prof": fx.profile_id},
    )

    with pytest.raises(IntegrityError) as exc_info:
        await db_session_real.commit()
    assert "article coherence" in str(exc_info.value).lower()
    await db_session_real.rollback()


async def test_same_article_workflow_row_commits(db_session_real: AsyncSession) -> None:
    """Happy path: run and instance share an article → COMMIT succeeds."""
    fx = await _discover(db_session_real)
    if fx is None:
        pytest.skip("Need a seeded article-bound instance with field/version/profile.")

    # Run bound to the SAME article as the instance → coherent.
    run_id = await _make_run(db_session_real, fx, article_id=fx.instance_article)
    await db_session_real.execute(
        text(
            "INSERT INTO public.extraction_proposal_records "
            "(run_id, instance_id, field_id, source, proposed_value) "
            "VALUES (:run, :inst, :field, 'ai', '{}'::jsonb)"
        ),
        {"run": run_id, "inst": fx.instance_id, "field": fx.field_id},
    )
    try:
        await db_session_real.commit()  # must not raise
    finally:
        # CASCADE from the run clears the proposal row. The instance and its
        # article are seed-owned — leave them alone.
        await db_session_real.execute(
            text("DELETE FROM public.extraction_runs WHERE id = :rid"),
            {"rid": run_id},
        )
        await db_session_real.commit()


@pytest.mark.parametrize("table_name", WORKFLOW_TABLES)
async def test_article_coherence_trigger_present_on_all_tables(
    db_session_real: AsyncSession,
    table_name: str,
) -> None:
    """Structural guard: the coherence trigger is attached to every one of
    the five workflow tables (so none is silently missed — incl.
    ``reviewer_states``, which the behavioral test can't easily reach).
    """
    count = (
        await db_session_real.execute(
            text(
                "SELECT count(*) FROM pg_trigger t "
                "JOIN pg_class c ON c.oid = t.tgrelid "
                "WHERE c.relname = :table "
                "AND t.tgname = :tgname"
            ),
            {"table": table_name, "tgname": f"trg_{table_name}_article_coherent"},
        )
    ).scalar()
    assert count == 1
