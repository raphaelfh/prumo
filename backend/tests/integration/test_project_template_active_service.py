"""Unit tests for `project_template_active_service.set_template_active`.

Why this exists
---------------
The service owns the single-active-extraction-template invariant: a
project must always have ≥1 active extraction template, because the
extraction workflow reads "the" active template at runtime. The same
invariant is enforced at the DB level by the partial unique index
`uq_one_active_extraction_template_per_project` (which forbids >1
active at any moment), so the service is the only place that prevents
the *lower* bound from being crossed.

Before this file, `set_template_active` had zero direct test coverage —
it was hit transitively through one router test, so the three branches
(not-found, cross-project, last-active-guard) had never been
independently exercised. A bug here is silent: a frontend that
disables the last active template would leave the project's runs
unable to resolve a template version, and the failure would surface
deep inside `TemplateCloneService` / `HitlSessionService` rather than
at the boundary.

The tests speak directly to the service (no HTTP layer) because the
invariant is data-shaped, not endpoint-shaped.
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.project_template_active_service import (
    LastActiveExtractionTemplateError,
    ProjectTemplateNotFoundError,
    set_template_active,
)
from tests.integration.conftest import SEED


async def _insert_inactive_extraction_template(
    db: AsyncSession,
    *,
    project_id,
    created_by,
) -> uuid.UUID:
    """Create an additional extraction template (is_active=False).

    The partial unique index `uq_one_active_extraction_template_per_project`
    forbids two active extraction templates simultaneously, so any
    "extra" template the test inserts must start inactive. The service
    can then flip it active.
    """
    tpl_id = uuid.uuid4()
    await db.execute(
        text(
            "INSERT INTO public.project_extraction_templates "
            "(id, project_id, name, description, framework, version, kind, "
            " schema, is_active, created_by) "
            "VALUES (:id, :pid, :name, NULL, 'CUSTOM', '1.0', 'extraction', "
            " '{}'::jsonb, false, :created_by)"
        ),
        {
            "id": str(tpl_id),
            "pid": str(project_id),
            "name": f"extra-{tpl_id}",
            "created_by": str(created_by),
        },
    )
    # Inactive templates still need an active version row to keep the
    # deferred trigger from migration 0004 from firing on commit if the
    # template is ever activated. Keeping an inactive template
    # version-less is fine — the trigger only checks active templates.
    await db.execute(
        text(
            "INSERT INTO public.extraction_template_versions "
            "(id, project_template_id, version, schema, published_by, is_active) "
            "VALUES (gen_random_uuid(), :tid, 1, "
            " '{\"entity_types\": []}'::jsonb, :published_by, true)"
        ),
        {
            "tid": str(tpl_id),
            "published_by": str(created_by),
        },
    )
    await db.commit()
    return tpl_id


@pytest.mark.asyncio
async def test_activate_inactive_template_succeeds(
    db_session: AsyncSession,
) -> None:
    """Flipping is_active=False → True on a fresh template works.

    Uses SECONDARY_PROJECT because the seed doesn't put any template
    there — so there's no `uq_one_active_extraction_template_per_project`
    collision when we activate this one.
    """
    tpl_id = await _insert_inactive_extraction_template(
        db_session,
        project_id=SEED.secondary_project,
        created_by=SEED.primary_profile,
    )

    response = await set_template_active(
        db_session,
        project_id=SEED.secondary_project,
        template_id=tpl_id,
        is_active=True,
    )

    assert response.project_template_id == tpl_id
    assert response.is_active is True

    # Verify the row actually persisted.
    db_value = (
        await db_session.execute(
            text("SELECT is_active FROM public.project_extraction_templates WHERE id = :id"),
            {"id": str(tpl_id)},
        )
    ).scalar()
    assert db_value is True


@pytest.mark.asyncio
async def test_set_active_raises_for_unknown_template(
    db_session: AsyncSession,
) -> None:
    """An unknown template_id surfaces as ProjectTemplateNotFoundError."""
    unknown_id = uuid.uuid4()

    with pytest.raises(ProjectTemplateNotFoundError) as exc:
        await set_template_active(
            db_session,
            project_id=SEED.primary_project,
            template_id=unknown_id,
            is_active=True,
        )
    assert str(unknown_id) in str(exc.value)


@pytest.mark.asyncio
async def test_set_active_raises_when_template_belongs_to_other_project(
    db_session: AsyncSession,
) -> None:
    """Cross-project access surfaces as NotFound (BOLA guard).

    The primary template exists, but it doesn't belong to
    secondary_project — the service must not leak its existence by
    flipping its flag through a project_id that doesn't own it.
    """
    with pytest.raises(ProjectTemplateNotFoundError):
        await set_template_active(
            db_session,
            project_id=SEED.secondary_project,
            template_id=SEED.primary_template,
            is_active=False,
        )

    # Confirm the flag was NOT modified despite the failed call.
    db_value = (
        await db_session.execute(
            text("SELECT is_active FROM public.project_extraction_templates WHERE id = :id"),
            {"id": str(SEED.primary_template)},
        )
    ).scalar()
    assert db_value is True


@pytest.mark.asyncio
async def test_deactivating_last_active_extraction_template_raises(
    db_session: AsyncSession,
) -> None:
    """Cannot disable the only active extraction template in a project.

    The seed leaves PRIMARY_TEMPLATE as the single active extraction
    template in PRIMARY_PROJECT. Disabling it would leave the project
    with zero active extraction templates, which the extraction
    workflow cannot tolerate.
    """
    with pytest.raises(LastActiveExtractionTemplateError) as exc:
        await set_template_active(
            db_session,
            project_id=SEED.primary_project,
            template_id=SEED.primary_template,
            is_active=False,
        )
    assert "only active extraction template" in str(exc.value)

    # Confirm the template is still active after the failed call.
    db_value = (
        await db_session.execute(
            text("SELECT is_active FROM public.project_extraction_templates WHERE id = :id"),
            {"id": str(SEED.primary_template)},
        )
    ).scalar()
    assert db_value is True
