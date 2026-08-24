# backend/tests/integration/test_template_create_service.py
"""Behavior of ``create_blank_template``: a project template that starts with
no sections, created server-side so both DB invariants hold at COMMIT.

A single PostgREST insert cannot satisfy either one — the deferred trigger
``project_extraction_templates_active_version`` (0004) demands an active
version row by COMMIT, and ``uq_one_active_extraction_template_per_project``
(0014) refuses a second active extraction template. The service does the two
writes the frontend could not: deactivate the incumbent, then publish v1.
"""

from __future__ import annotations

from uuid import UUID, uuid4

import pytest
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction import ProjectExtractionTemplate
from app.services.template_create_service import create_blank_template
from tests.integration.conftest import SEED, clean_project_clones, clone_charms


async def _active_extraction_templates(db: AsyncSession, project_id: UUID) -> list[UUID]:
    rows = await db.execute(
        select(ProjectExtractionTemplate.id).where(
            ProjectExtractionTemplate.project_id == project_id,
            ProjectExtractionTemplate.is_active.is_(True),
            ProjectExtractionTemplate.kind == "extraction",
        )
    )
    return list(rows.scalars())


@pytest.mark.asyncio
async def test_creates_an_active_template_with_a_published_v1(
    db_session: AsyncSession,
) -> None:
    project_id = SEED.secondary_project
    await clean_project_clones(db_session, project_id)

    result = await create_blank_template(
        db_session,
        project_id=project_id,
        name="Blank template",
        description="starts empty",
        framework="CUSTOM",
        user_id=SEED.primary_profile,
    )

    assert result.created is True
    assert result.entity_type_count == 0
    assert result.field_count == 0

    # The invariant the deferred trigger enforces: exactly one ACTIVE version.
    active_versions = await db_session.execute(
        text(
            "SELECT count(*) FROM public.extraction_template_versions "
            "WHERE project_template_id = :tid AND is_active = true"
        ),
        {"tid": result.project_template_id},
    )
    assert active_versions.scalar_one() == 1

    tpl = (
        await db_session.execute(
            select(ProjectExtractionTemplate).where(
                ProjectExtractionTemplate.id == result.project_template_id
            )
        )
    ).scalar_one()
    assert tpl.is_active is True
    assert tpl.name == "Blank template"
    assert tpl.description == "starts empty"
    assert tpl.framework == "CUSTOM"
    assert tpl.global_template_id is None
    # Created templates are publishable immediately: the create IS the publish,
    # so no draft marker is left behind for the manager to clear.
    assert tpl.config_draft_since is None


@pytest.mark.asyncio
async def test_deactivates_the_incumbent_active_template(db_session: AsyncSession) -> None:
    project_id = SEED.secondary_project
    await clean_project_clones(db_session, project_id)
    incumbent = await clone_charms(db_session, project_id, SEED.primary_profile)

    assert await _active_extraction_templates(db_session, project_id) == [
        incumbent.project_template_id
    ]

    result = await create_blank_template(
        db_session,
        project_id=project_id,
        name="Replaces the incumbent",
        description=None,
        framework="CUSTOM",
        user_id=SEED.primary_profile,
    )

    # Single-active invariant holds, and the NEW template is the active one.
    assert await _active_extraction_templates(db_session, project_id) == [
        result.project_template_id
    ]


@pytest.mark.asyncio
async def test_published_snapshot_has_no_entity_types(db_session: AsyncSession) -> None:
    project_id = SEED.secondary_project
    await clean_project_clones(db_session, project_id)

    result = await create_blank_template(
        db_session,
        project_id=project_id,
        name="Empty snapshot",
        description=None,
        framework="CUSTOM",
        user_id=SEED.primary_profile,
    )

    snapshot = await db_session.execute(
        text("SELECT schema FROM public.extraction_template_versions WHERE id = :vid"),
        {"vid": result.version_id},
    )
    assert snapshot.scalar_one()["entity_types"] == []


@pytest.mark.asyncio
async def test_foreign_project_id_does_not_reach_another_project(
    db_session: AsyncSession,
) -> None:
    """A project id that does not exist must not create anything anywhere.

    The FK on ``project_id`` refuses at flush — the service never invents a
    project, so an orphaned template is unrepresentable.
    """
    with pytest.raises(IntegrityError):
        await create_blank_template(
            db_session,
            project_id=uuid4(),
            name="Nowhere",
            description=None,
            framework="CUSTOM",
            user_id=SEED.primary_profile,
        )
    await db_session.rollback()
