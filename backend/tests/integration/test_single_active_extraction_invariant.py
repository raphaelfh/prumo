"""DB-level enforcement of the single-active-extraction-template invariant.

The extraction workflow assumes exactly one active extraction template
per project. Migration ``0014_one_active_extraction_tpl`` ships a
partial unique index
``uq_one_active_extraction_template_per_project`` that makes the
invariant unrepresentable at the DB level — closing the gap left by
the service-only enforcement. These tests pin the index behaviour so
future migrations (or a refactor of the clone service) cannot silently
weaken it.

Spec laid out as iterations: each test names one scenario and asserts
exactly one observable, so a regression points at the broken case.
"""

from __future__ import annotations

from uuid import UUID, uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

pytestmark = pytest.mark.asyncio


# =================== Helpers ===================


async def _pick_project_with_member(db: AsyncSession) -> tuple[UUID, UUID] | None:
    """Return (project_id, profile_id) for any project with at least one member."""
    row = (
        await db.execute(
            text(
                """
                SELECT p.id, pm.user_id
                FROM public.projects p
                JOIN public.project_members pm ON pm.project_id = p.id
                LIMIT 1
                """
            )
        )
    ).first()
    if row is None:
        return None
    return UUID(str(row[0])), UUID(str(row[1]))


async def _wipe_extraction_templates_for_project(db: AsyncSession, project_id: UUID) -> None:
    """Tear down all extraction templates and their dependent rows for a project."""
    await db.execute(
        text(
            """
            DELETE FROM public.extraction_runs
            WHERE project_id = :pid
              AND template_id IN (
                SELECT id FROM public.project_extraction_templates
                WHERE project_id = :pid AND kind = 'extraction'
              )
            """
        ),
        {"pid": str(project_id)},
    )
    await db.execute(
        text(
            """
            DELETE FROM public.extraction_instances
            WHERE project_id = :pid
              AND template_id IN (
                SELECT id FROM public.project_extraction_templates
                WHERE project_id = :pid AND kind = 'extraction'
              )
            """
        ),
        {"pid": str(project_id)},
    )
    await db.execute(
        text(
            """
            DELETE FROM public.project_extraction_templates
            WHERE project_id = :pid AND kind = 'extraction'
            """
        ),
        {"pid": str(project_id)},
    )
    await db.commit()


async def _insert_extraction_template(
    db: AsyncSession,
    *,
    project_id: UUID,
    user_id: UUID,
    is_active: bool,
    name: str = "tpl",
    template_id: UUID | None = None,
) -> UUID:
    """Insert one project_extraction_template + active version row, returning the id."""
    tid = template_id or uuid4()
    await db.execute(
        text(
            """
            INSERT INTO public.project_extraction_templates
                (id, project_id, name, description, framework, version, kind,
                 schema, is_active, created_by)
            VALUES (:tid, :pid, :name, NULL, 'CUSTOM', '1.0', 'extraction',
                    '{}'::jsonb, :is_active, :uid)
            """
        ),
        {
            "tid": str(tid),
            "pid": str(project_id),
            "name": name,
            "is_active": is_active,
            "uid": str(user_id),
        },
    )
    await db.execute(
        text(
            """
            INSERT INTO public.extraction_template_versions
                (project_template_id, version, schema, published_at,
                 published_by, is_active)
            VALUES (:tid, 1, '{}'::jsonb, NOW(), :uid, true)
            """
        ),
        {"tid": str(tid), "uid": str(user_id)},
    )
    return tid


# =================== Iterations ===================


async def test_index_exists_in_catalog(db_session: AsyncSession) -> None:
    """Spec: the partial unique index must be present after migration 0014."""
    name = (
        await db_session.execute(
            text(
                "SELECT indexname FROM pg_indexes "
                "WHERE tablename = 'project_extraction_templates' "
                "AND indexname = 'uq_one_active_extraction_template_per_project'"
            )
        )
    ).scalar()
    assert name == "uq_one_active_extraction_template_per_project"


async def test_index_is_partial_with_extraction_predicate(db_session: AsyncSession) -> None:
    """Spec: the index predicate must mention ``is_active = true`` and
    ``kind = 'extraction'`` so QA templates fall outside its scope."""
    definition = (
        await db_session.execute(
            text(
                "SELECT indexdef FROM pg_indexes "
                "WHERE indexname = 'uq_one_active_extraction_template_per_project'"
            )
        )
    ).scalar()
    assert definition is not None
    assert "is_active = true" in definition.lower() or "is_active = TRUE" in definition
    assert "kind = 'extraction'" in definition


async def test_inserting_first_active_extraction_template_succeeds(db_session: AsyncSession) -> None:
    """Spec: a project with no extraction template can have one inserted active."""
    target = await _pick_project_with_member(db_session)
    if target is None:
        pytest.skip("Need a project with members")
    project_id, user_id = target
    await _wipe_extraction_templates_for_project(db_session, project_id)

    await _insert_extraction_template(
        db_session, project_id=project_id, user_id=user_id, is_active=True, name="first"
    )
    await db_session.commit()

    count = (
        await db_session.execute(
            text(
                "SELECT COUNT(*) FROM public.project_extraction_templates "
                "WHERE project_id = :pid AND is_active = true AND kind = 'extraction'"
            ),
            {"pid": str(project_id)},
        )
    ).scalar()
    assert count == 1


async def test_inserting_second_active_extraction_template_fails(
    db_session: AsyncSession,
) -> None:
    """Spec: with one active extraction template, INSERTing a second active
    one trips the partial unique index."""
    target = await _pick_project_with_member(db_session)
    if target is None:
        pytest.skip("Need a project with members")
    project_id, user_id = target
    await _wipe_extraction_templates_for_project(db_session, project_id)

    await _insert_extraction_template(
        db_session, project_id=project_id, user_id=user_id, is_active=True, name="first"
    )
    await db_session.flush()

    with pytest.raises(IntegrityError):
        await _insert_extraction_template(
            db_session,
            project_id=project_id,
            user_id=user_id,
            is_active=True,
            name="second",
        )
        await db_session.flush()
    await db_session.rollback()


async def test_promoting_second_template_to_active_fails(db_session: AsyncSession) -> None:
    """Spec: an inactive extraction template cannot be UPDATEd to active while
    another active one exists for the same project."""
    target = await _pick_project_with_member(db_session)
    if target is None:
        pytest.skip("Need a project with members")
    project_id, user_id = target
    await _wipe_extraction_templates_for_project(db_session, project_id)

    await _insert_extraction_template(
        db_session, project_id=project_id, user_id=user_id, is_active=True, name="active"
    )
    sleeping_id = await _insert_extraction_template(
        db_session,
        project_id=project_id,
        user_id=user_id,
        is_active=False,
        name="sleeping",
    )
    await db_session.flush()

    with pytest.raises(IntegrityError):
        await db_session.execute(
            text(
                "UPDATE public.project_extraction_templates "
                "SET is_active = true WHERE id = :tid"
            ),
            {"tid": str(sleeping_id)},
        )
        await db_session.flush()
    await db_session.rollback()


async def test_two_inactive_extraction_templates_are_allowed(db_session: AsyncSession) -> None:
    """Spec: only ``is_active = true`` rows are constrained — inactives can
    accumulate (e.g. history of previously-used templates)."""
    target = await _pick_project_with_member(db_session)
    if target is None:
        pytest.skip("Need a project with members")
    project_id, user_id = target
    await _wipe_extraction_templates_for_project(db_session, project_id)

    await _insert_extraction_template(
        db_session, project_id=project_id, user_id=user_id, is_active=False, name="legacy-1"
    )
    await _insert_extraction_template(
        db_session, project_id=project_id, user_id=user_id, is_active=False, name="legacy-2"
    )
    await db_session.commit()

    count = (
        await db_session.execute(
            text(
                "SELECT COUNT(*) FROM public.project_extraction_templates "
                "WHERE project_id = :pid AND is_active = false AND kind = 'extraction'"
            ),
            {"pid": str(project_id)},
        )
    ).scalar()
    assert count == 2


async def test_two_active_qa_templates_are_allowed(db_session: AsyncSession) -> None:
    """Spec: kind=quality_assessment is outside the partial index predicate
    so PROBAST and QUADAS-2 can coexist active for the same project."""
    target = await _pick_project_with_member(db_session)
    if target is None:
        pytest.skip("Need a project with members")
    project_id, user_id = target

    tid_a = uuid4()
    tid_b = uuid4()
    for tid, name in ((tid_a, "probast-mock"), (tid_b, "quadas-mock")):
        await db_session.execute(
            text(
                """
                INSERT INTO public.project_extraction_templates
                    (id, project_id, name, description, framework, version, kind,
                     schema, is_active, created_by)
                VALUES (:tid, :pid, :name, NULL, 'CUSTOM', '1.0',
                        'quality_assessment', '{}'::jsonb, true, :uid)
                """
            ),
            {"tid": str(tid), "pid": str(project_id), "name": name, "uid": str(user_id)},
        )
        await db_session.execute(
            text(
                """
                INSERT INTO public.extraction_template_versions
                    (project_template_id, version, schema, published_at,
                     published_by, is_active)
                VALUES (:tid, 1, '{}'::jsonb, NOW(), :uid, true)
                """
            ),
            {"tid": str(tid), "uid": str(user_id)},
        )
    await db_session.commit()

    count = (
        await db_session.execute(
            text(
                "SELECT COUNT(*) FROM public.project_extraction_templates "
                "WHERE id IN (:a, :b) AND is_active = true"
            ),
            {"a": str(tid_a), "b": str(tid_b)},
        )
    ).scalar()
    assert count == 2

    # Cleanup
    await db_session.execute(
        text("DELETE FROM public.project_extraction_templates WHERE id IN (:a, :b)"),
        {"a": str(tid_a), "b": str(tid_b)},
    )
    await db_session.commit()


async def test_kind_specific_index_allows_qa_alongside_extraction(
    db_session: AsyncSession,
) -> None:
    """Spec: index is scoped by kind, so an active QA template does not
    block an active extraction template (the workflows are orthogonal)."""
    target = await _pick_project_with_member(db_session)
    if target is None:
        pytest.skip("Need a project with members")
    project_id, user_id = target
    await _wipe_extraction_templates_for_project(db_session, project_id)

    extraction_id = await _insert_extraction_template(
        db_session, project_id=project_id, user_id=user_id, is_active=True, name="ext"
    )
    qa_id = uuid4()
    await db_session.execute(
        text(
            """
            INSERT INTO public.project_extraction_templates
                (id, project_id, name, description, framework, version, kind,
                 schema, is_active, created_by)
            VALUES (:tid, :pid, 'qa-side', NULL, 'CUSTOM', '1.0',
                    'quality_assessment', '{}'::jsonb, true, :uid)
            """
        ),
        {"tid": str(qa_id), "pid": str(project_id), "uid": str(user_id)},
    )
    await db_session.execute(
        text(
            """
            INSERT INTO public.extraction_template_versions
                (project_template_id, version, schema, published_at,
                 published_by, is_active)
            VALUES (:tid, 1, '{}'::jsonb, NOW(), :uid, true)
            """
        ),
        {"tid": str(qa_id), "uid": str(user_id)},
    )
    await db_session.commit()

    # Cleanup the side-effect QA row
    await db_session.execute(
        text("DELETE FROM public.project_extraction_templates WHERE id = :tid"),
        {"tid": str(qa_id)},
    )
    await db_session.commit()
    assert extraction_id is not None  # sanity — the test would have raised otherwise


async def test_deactivate_then_activate_a_different_one_works(db_session: AsyncSession) -> None:
    """Spec: deactivating the current active first lets a previously-inactive
    one become active — the natural "switch templates" flow."""
    target = await _pick_project_with_member(db_session)
    if target is None:
        pytest.skip("Need a project with members")
    project_id, user_id = target
    await _wipe_extraction_templates_for_project(db_session, project_id)

    a = await _insert_extraction_template(
        db_session, project_id=project_id, user_id=user_id, is_active=True, name="A"
    )
    b = await _insert_extraction_template(
        db_session, project_id=project_id, user_id=user_id, is_active=False, name="B"
    )
    await db_session.flush()

    await db_session.execute(
        text("UPDATE public.project_extraction_templates SET is_active = false WHERE id = :id"),
        {"id": str(a)},
    )
    await db_session.flush()
    await db_session.execute(
        text("UPDATE public.project_extraction_templates SET is_active = true WHERE id = :id"),
        {"id": str(b)},
    )
    await db_session.commit()

    active = (
        await db_session.execute(
            text(
                "SELECT id FROM public.project_extraction_templates "
                "WHERE project_id = :pid AND is_active = true AND kind = 'extraction'"
            ),
            {"pid": str(project_id)},
        )
    ).scalar()
    assert UUID(str(active)) == b


async def test_project_with_zero_extraction_templates_is_valid(db_session: AsyncSession) -> None:
    """Spec: the index has no minimum cardinality — a brand-new project can
    have no extraction template at all (until the user imports one)."""
    target = await _pick_project_with_member(db_session)
    if target is None:
        pytest.skip("Need a project with members")
    project_id, _user_id = target
    await _wipe_extraction_templates_for_project(db_session, project_id)

    count = (
        await db_session.execute(
            text(
                "SELECT COUNT(*) FROM public.project_extraction_templates "
                "WHERE project_id = :pid AND kind = 'extraction'"
            ),
            {"pid": str(project_id)},
        )
    ).scalar()
    assert count == 0


async def test_cross_project_active_extraction_templates_are_independent(
    db_session: AsyncSession,
) -> None:
    """Spec: the index partitions by project — two different projects each
    having one active extraction template is fine."""
    rows = (
        await db_session.execute(
            text(
                """
                SELECT DISTINCT ON (p.id) p.id, pm.user_id
                FROM public.projects p
                JOIN public.project_members pm ON pm.project_id = p.id
                ORDER BY p.id
                LIMIT 2
                """
            )
        )
    ).all()
    if len(rows) < 2:
        pytest.skip("Need at least two distinct projects with members")
    project_a, user_a = UUID(str(rows[0][0])), UUID(str(rows[0][1]))
    project_b, user_b = UUID(str(rows[1][0])), UUID(str(rows[1][1]))
    if project_a == project_b:
        pytest.skip("Need at least two distinct projects with members")
    await _wipe_extraction_templates_for_project(db_session, project_a)
    await _wipe_extraction_templates_for_project(db_session, project_b)

    await _insert_extraction_template(
        db_session, project_id=project_a, user_id=user_a, is_active=True, name="A1"
    )
    await _insert_extraction_template(
        db_session, project_id=project_b, user_id=user_b, is_active=True, name="B1"
    )
    await db_session.commit()

    counts = (
        await db_session.execute(
            text(
                """
                SELECT project_id, COUNT(*)
                FROM public.project_extraction_templates
                WHERE project_id IN (:a, :b)
                  AND is_active = true AND kind = 'extraction'
                GROUP BY project_id
                """
            ),
            {"a": str(project_a), "b": str(project_b)},
        )
    ).all()
    assert {str(r[0]) for r in counts} == {str(project_a), str(project_b)}
    assert all(r[1] == 1 for r in counts)


async def test_index_is_immediate_not_deferrable(db_session: AsyncSession) -> None:
    """Spec: the partial unique index is checked immediately on every
    statement; we intentionally do not let it defer to COMMIT because the
    clone service must observe failures at flush boundaries to abort early.
    Verifies via ``indisready`` + ``indisvalid`` and absence of any matching
    constraint row in ``pg_constraint`` (only true CONSTRAINTs can defer)."""
    row = (
        await db_session.execute(
            text(
                """
                SELECT i.indisready, i.indisvalid
                FROM pg_class c
                JOIN pg_index i ON i.indexrelid = c.oid
                WHERE c.relname = 'uq_one_active_extraction_template_per_project'
                """
            )
        )
    ).first()
    assert row is not None
    assert bool(row[0]) is True
    assert bool(row[1]) is True

    # Partial unique indexes aren't constraints — they have no row in
    # pg_constraint (whereas true UNIQUE/PRIMARY KEY do). This is what
    # makes them not deferrable in Postgres.
    has_constraint_row = (
        await db_session.execute(
            text(
                "SELECT EXISTS (SELECT 1 FROM pg_constraint "
                "WHERE conname = 'uq_one_active_extraction_template_per_project')"
            )
        )
    ).scalar()
    assert has_constraint_row is False
