"""
DEFERRED trigger from migration 0004:
``trg_project_extraction_templates_active_version``.

Asserts that a ``project_extraction_templates`` row without at least one
``extraction_template_versions`` row where ``is_active = true`` aborts the
transaction at COMMIT — not at INSERT, since the trigger is DEFERRED.

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


async def _pick_existing_profile_id(session: AsyncSession):
    """
    Reuse an existing profile rather than insert a new one — ``profiles.id``
    FKs to ``auth.users`` (Supabase auth schema), and inserting auth users
    from SQL is invasive. The smoke tests do not care which profile is
    used; only that ``created_by_id`` resolves.
    """
    result = await session.execute(text("SELECT id FROM public.profiles LIMIT 1"))
    row = result.first()
    if row is None:
        pytest.skip(
            "Smoke constraint tests require at least one profile in the local DB. "
            "Run `make db-seed` or sign up a test user."
        )
    return row[0]


async def _insert_project(session: AsyncSession, project_id, profile_id) -> None:
    await session.execute(
        text(
            "INSERT INTO public.projects (id, name, created_by_id, settings, is_active) "
            "VALUES (:id, :name, :owner, '{}'::jsonb, true)"
        ),
        {"id": project_id, "name": f"smoke-{project_id}", "owner": profile_id},
    )


async def _insert_template(session: AsyncSession, template_id, project_id, profile_id) -> None:
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


async def _insert_version(session: AsyncSession, template_id, profile_id) -> None:
    await session.execute(
        text(
            "INSERT INTO public.extraction_template_versions "
            "(project_template_id, version, schema, published_by, is_active) "
            "VALUES (:tid, 1, '{\"entity_types\": []}'::jsonb, :owner, true)"
        ),
        {"tid": template_id, "owner": profile_id},
    )


async def test_template_without_active_version_aborts_at_commit(
    db_session_real: AsyncSession,
) -> None:
    """
    Sad path: insert template without a matching active version row.
    INSERT succeeds; COMMIT raises (trigger is DEFERRED, fires at COMMIT).
    """
    profile_id = await _pick_existing_profile_id(db_session_real)
    project_id = uuid4()
    template_id = uuid4()

    await _insert_project(db_session_real, project_id, profile_id)
    await _insert_template(db_session_real, template_id, project_id, profile_id)
    # Intentionally NO version insert.

    with pytest.raises(IntegrityError) as exc_info:
        await db_session_real.commit()
    assert "has no active version" in str(exc_info.value).lower()
    # Failed COMMIT auto-rollbacks; no persisted state to clean up.
    await db_session_real.rollback()


async def test_template_with_active_version_commits(
    db_session_real: AsyncSession,
) -> None:
    """Happy path: template + active version row → COMMIT succeeds."""
    profile_id = await _pick_existing_profile_id(db_session_real)
    project_id = uuid4()
    template_id = uuid4()

    await _insert_project(db_session_real, project_id, profile_id)
    await _insert_template(db_session_real, template_id, project_id, profile_id)
    await _insert_version(db_session_real, template_id, profile_id)

    try:
        await db_session_real.commit()  # must not raise
    finally:
        # Cleanup: project CASCADE-deletes template + version.
        # We do NOT touch the profile — it was pre-existing.
        await db_session_real.execute(
            text("DELETE FROM public.projects WHERE id = :id"),
            {"id": project_id},
        )
        await db_session_real.commit()
