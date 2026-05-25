"""
DEFERRED trigger from migration 0016:
``trg_check_model_section_parent_role``.

Asserts that an ``extraction_entity_types`` row with ``role =
'model_section'`` must point ``parent_entity_type_id`` at another row
whose ``role = 'model_container'``. Trigger is DEFERRED, so the check
fires at COMMIT — meaning a transaction can temporarily insert
inconsistent rows as long as they are reconciled before COMMIT.

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
    role: str,
    parent_id=None,
    cardinality: str = "one",
) -> None:
    await session.execute(
        text(
            "INSERT INTO public.extraction_entity_types "
            "(id, project_template_id, name, label, cardinality, role, "
            " parent_entity_type_id, sort_order, is_required) "
            "VALUES (:id, :tid, :name, :name, :card, :role, :parent, 0, false)"
        ),
        {
            "id": entity_id,
            "tid": template_id,
            "name": name,
            "card": cardinality,
            "role": role,
            "parent": parent_id,
        },
    )


async def test_model_section_with_non_container_parent_aborts_at_commit(
    db_session_real: AsyncSession,
) -> None:
    """
    Sad path: model_section whose parent is a study_section.
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
        role="study_section",
    )
    await _insert_entity(
        db_session_real,
        entity_id=section_id,
        template_id=template_id,
        name="bad-section",
        role="model_section",
        parent_id=study_id,  # WRONG: parent must be model_container
        cardinality="one",
    )

    with pytest.raises(IntegrityError) as exc_info:
        await db_session_real.commit()
    assert "model_container parent" in str(exc_info.value).lower()
    await db_session_real.rollback()


async def test_model_section_with_container_parent_commits(
    db_session_real: AsyncSession,
) -> None:
    """Happy path: model_section parent IS a model_container → COMMIT succeeds."""
    profile_id, project_id, template_id = await _bootstrap(db_session_real)

    container_id = uuid4()
    section_id = uuid4()
    await _insert_entity(
        db_session_real,
        entity_id=container_id,
        template_id=template_id,
        name="prediction_models",
        role="model_container",
        cardinality="many",
    )
    await _insert_entity(
        db_session_real,
        entity_id=section_id,
        template_id=template_id,
        name="good-section",
        role="model_section",
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
