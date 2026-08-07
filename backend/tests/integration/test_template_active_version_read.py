"""B-3a: the active-version tree read the worklist consumes.

The endpoint must NEVER serve an empty tree for a missing active version
(an empty tree computes as 100 % complete in the worklist) — it raises a
typed error instead. The tree itself comes from B-2's shared provider,
so the narrow → live fallback chain is inherited.
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.project_template_active_service import ProjectTemplateNotFoundError
from app.services.template_version_read_service import (
    NoActiveTemplateVersionError,
    get_active_version_tree,
)
from tests.integration.conftest import SEED


@pytest.mark.asyncio
async def test_returns_the_active_version_tree(db_session: AsyncSession) -> None:
    result = await get_active_version_tree(
        db_session,
        project_id=SEED.primary_project,
        template_id=SEED.primary_template,
    )

    active = (
        await db_session.execute(
            text(
                "SELECT id, version FROM public.extraction_template_versions "
                "WHERE project_template_id = :tid AND is_active"
            ),
            {"tid": str(SEED.primary_template)},
        )
    ).one()
    assert result.version_id == active[0]
    assert result.version == active[1]
    assert result.entity_types, "seeded template must yield a non-empty tree"
    assert all(et.role for et in result.entity_types)


@pytest.mark.asyncio
async def test_bola_foreign_project_is_not_found(db_session: AsyncSession) -> None:
    with pytest.raises(ProjectTemplateNotFoundError):
        await get_active_version_tree(
            db_session,
            project_id=SEED.secondary_project,
            template_id=SEED.primary_template,
        )


@pytest.mark.asyncio
async def test_unknown_template_is_not_found(db_session: AsyncSession) -> None:
    with pytest.raises(ProjectTemplateNotFoundError):
        await get_active_version_tree(
            db_session,
            project_id=SEED.primary_project,
            template_id=uuid.uuid4(),
        )


@pytest.mark.asyncio
async def test_no_active_version_raises_typed_error_never_empty_tree(
    db_session: AsyncSession,
) -> None:
    """A template without an active version must be a typed 404 at the
    endpoint — an empty tree would read as fully-complete progress."""
    template_id = uuid.uuid4()
    await db_session.execute(
        text(
            "INSERT INTO public.project_extraction_templates "
            "(id, project_id, name, description, framework, version, kind, "
            " schema, is_active, created_by) "
            "VALUES (:id, :pid, 'versionless', NULL, 'CUSTOM', '1.0', "
            " 'extraction', '{}'::jsonb, false, :created_by)"
        ),
        {
            "id": str(template_id),
            "pid": str(SEED.secondary_project),
            "created_by": str(SEED.primary_profile),
        },
    )

    with pytest.raises(NoActiveTemplateVersionError):
        await get_active_version_tree(
            db_session,
            project_id=SEED.secondary_project,
            template_id=template_id,
        )
