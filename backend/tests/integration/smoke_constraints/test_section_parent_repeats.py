"""
DEFERRED trigger from migration 0069:
``trg_check_section_parent_repeats``.

Asserts that an ``extraction_entity_types`` row naming a parent requires
that parent to REPEAT (``cardinality = 'many'``) — only an entry group
owns per-entry children. Replaces 0016's
``trg_check_model_section_parent_role``, which required the parent to be
the one ``role = 'model_container'`` the template was allowed.

Still DEFERRED, and for the same reason: a clone or a restore inserts
parent and child in one transaction and may reach the child first, so
the check fires at COMMIT and a transaction may hold inconsistent rows
until then.

These tests use ``db_session_real`` because the trigger fires at COMMIT;
the SAVEPOINT-based default fixture never reaches that point.
"""

from __future__ import annotations

from uuid import uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

pytestmark = pytest.mark.asyncio


async def _bootstrap(
    session: AsyncSession,
) -> tuple:
    """
    Insert project + template + active version using an existing profile.
    Returns ``(profile_id, project_id, template_id)``.

    Reuses a pre-existing profile rather than inserting one — ``profiles.id``
    FKs to ``auth.users`` (Supabase auth schema), which would require
    bootstrapping a Supabase user from SQL.
    """
    result = await session.execute(text("SELECT id FROM public.profiles LIMIT 1"))
    row = result.first()
    if row is None:
        pytest.skip(
            "Smoke constraint tests require at least one profile in the local DB. "
            "Run `make db-seed` or sign up a test user."
        )
    profile_id = row[0]
    project_id = uuid4()
    template_id = uuid4()

    await session.execute(
        text(
            "INSERT INTO public.projects (id, name, created_by_id, settings, is_active) "
            "VALUES (:id, :name, :owner, '{}'::jsonb, true)"
        ),
        {"id": project_id, "name": f"smoke-{project_id}", "owner": profile_id},
    )
    await session.execute(
        text(
            "INSERT INTO public.project_extraction_templates "
            "(id, project_id, name, framework, version, kind, schema, "
            " is_active, created_by) "
            "VALUES (:id, :pid, :name, 'CUSTOM', '1.0', 'extraction', "
            "        '{}'::jsonb, false, :owner)"
        ),
        {
            "id": template_id,
            "pid": project_id,
            "name": f"smoke-{template_id}",
            "owner": profile_id,
        },
    )
    await session.execute(
        text(
            "INSERT INTO public.extraction_template_versions "
            "(project_template_id, version, schema, published_by, is_active) "
            "VALUES (:tid, 1, '{\"entity_types\": []}'::jsonb, :owner, true)"
        ),
        {"tid": template_id, "owner": profile_id},
    )
    return profile_id, project_id, template_id


async def _insert_entity(
    session: AsyncSession,
    *,
    entity_id,
    template_id,
    name: str,
    parent_id=None,
    cardinality: str = "one",
) -> None:
    await session.execute(
        text(
            "INSERT INTO public.extraction_entity_types "
            "(id, project_template_id, name, label, cardinality,"
            " parent_entity_type_id, sort_order, is_required, entry_label) "
            "VALUES (:id, :tid, :name, :name, :card, :parent, 0, false, :noun)"
        ),
        {
            "id": entity_id,
            "tid": template_id,
            "name": name,
            "card": cardinality,
            "parent": parent_id,
            # 0069's `ck_..._noun_on_repeating`.
            "noun": "entry" if cardinality == "many" else None,
        },
    )


async def test_a_child_of_a_singleton_aborts_at_commit(
    db_session_real: AsyncSession,
) -> None:
    """
    Sad path: a section whose parent does not repeat.
    INSERT succeeds (constraint is DEFERRED); COMMIT raises.
    """
    profile_id, project_id, template_id = await _bootstrap(db_session_real)

    study_id = uuid4()
    section_id = uuid4()
    await _insert_entity(
        db_session_real,
        entity_id=study_id,
        template_id=template_id,
        name="participants",
    )
    await _insert_entity(
        db_session_real,
        entity_id=section_id,
        template_id=template_id,
        name="bad-section",
        parent_id=study_id,  # WRONG: a parent must repeat
        cardinality="one",
    )

    with pytest.raises(IntegrityError) as exc_info:
        await db_session_real.commit()
    # The PARENT's branch fires here, not the child's: both rows are new in
    # this transaction, and the trigger's per-row check on the singleton
    # finds it holding a child. The child's branch is asserted in
    # `test_a_child_named_under_an_already_committed_singleton` below, where
    # the parent is not part of the transaction.
    assert "cannot stop repeating" in str(exc_info.value).lower()
    await db_session_real.rollback()


async def test_a_child_of_an_entry_group_commits(
    db_session_real: AsyncSession,
) -> None:
    """Happy path: the parent repeats → COMMIT succeeds."""
    profile_id, project_id, template_id = await _bootstrap(db_session_real)

    container_id = uuid4()
    section_id = uuid4()
    await _insert_entity(
        db_session_real,
        entity_id=container_id,
        template_id=template_id,
        name="prediction_models",
        cardinality="many",
    )
    await _insert_entity(
        db_session_real,
        entity_id=section_id,
        template_id=template_id,
        name="good-section",
        parent_id=container_id,
        cardinality="one",
    )

    try:
        await db_session_real.commit()  # must not raise
    finally:
        # CASCADE from project clears template + version + entity_types.
        # Profile is pre-existing; we leave it alone.
        await db_session_real.execute(
            text("DELETE FROM public.projects WHERE id = :id"),
            {"id": project_id},
        )
        await db_session_real.commit()


async def test_a_child_named_under_an_already_committed_singleton(
    db_session_real: AsyncSession,
) -> None:
    """The child's own branch of the trigger.

    The parent is committed as a singleton FIRST, so it is untouched by the
    second transaction and its per-row check never runs — only the child's
    does, and it is the one that names the rule.
    """
    _profile_id, project_id, template_id = await _bootstrap(db_session_real)

    study_id = uuid4()
    await _insert_entity(
        db_session_real, entity_id=study_id, template_id=template_id, name="participants"
    )
    await db_session_real.commit()

    try:
        await _insert_entity(
            db_session_real,
            entity_id=uuid4(),
            template_id=template_id,
            name="late-child",
            parent_id=study_id,
        )
        with pytest.raises(IntegrityError) as exc_info:
            await db_session_real.commit()
        assert "does not repeat" in str(exc_info.value).lower()
        await db_session_real.rollback()
    finally:
        await db_session_real.execute(
            text("DELETE FROM public.projects WHERE id = :id"), {"id": project_id}
        )
        await db_session_real.commit()
