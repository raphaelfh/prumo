"""Restore-vN: stage an older version's shape as the current draft (B-9e).

Spec section 1: "'Restore vN' stages that version's shape as the current
draft and goes through the same Publish (history is append-only, never
rewritten)."

Two things separate this from Discard, and both are tested here:

* the baseline is an ARBITRARY version, not the active one — which is why
  it runs through the same gate layer rather than calling the writer
  directly. An old snapshot can omit sections that have since accumulated
  extraction_instances;
* the draft marker is deliberately LEFT STAMPED. Discard clears it because
  the tree went back to published; Restore stages a change, so the Draft
  chip and Publish must both light up.
"""

from __future__ import annotations

from uuid import UUID, uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.project_template_active_service import ProjectTemplateNotFoundError
from app.services.template_restore_version_service import (
    VersionNotFoundError,
    restore_version,
)
from app.services.template_version_read_service import get_template_config_status
from app.services.template_version_service import TemplateVersionService
from tests.integration.conftest import SEED
from tests.integration.helpers.template_fixtures import (
    delete_field,
    field_id,
    fresh_charms,
)


async def _marker(db: AsyncSession, template_id: UUID):
    return (
        await db.execute(
            text(
                "SELECT config_draft_since FROM public.project_extraction_templates WHERE id = :t"
            ),
            {"t": str(template_id)},
        )
    ).scalar_one()


async def _v1_then_v2(db: AsyncSession, project_id: UUID, template_id: UUID) -> UUID:
    """Publish a v2 that drops a field, and return v1's id."""
    versions = await db.execute(
        text(
            "SELECT id FROM public.extraction_template_versions "
            "WHERE project_template_id = :t ORDER BY version"
        ),
        {"t": str(template_id)},
    )
    v1_id = versions.scalars().first()
    await delete_field(db, await field_id(db, template_id, "sample_size", "epv_epp"))
    await TemplateVersionService(db).republish(
        project_id=project_id, project_template_id=template_id, user_id=SEED.primary_profile
    )
    return v1_id


@pytest.mark.asyncio
async def test_restoring_v1_brings_the_dropped_field_back_as_a_draft(
    db_session: AsyncSession,
) -> None:
    project_id, template_id, _ = await fresh_charms(db_session)
    v1_id = await _v1_then_v2(db_session, project_id, template_id)

    result = await restore_version(
        db_session,
        project_id=project_id,
        template_id=template_id,
        version_id=v1_id,
        user_id=SEED.primary_profile,
    )

    assert result.created_fields >= 1
    # The field is live again...
    restored = await field_id(db_session, template_id, "sample_size", "epv_epp")
    assert restored is not None


@pytest.mark.asyncio
async def test_restore_leaves_the_draft_marker_stamped(db_session: AsyncSession) -> None:
    """The whole point of "stages as the current draft".

    Discard clears the marker because the tree went BACK to published.
    Restore stages a divergence, so the marker must stay — otherwise the
    Draft chip is dark and Publish is disabled over a tree that no longer
    matches the active version.
    """
    project_id, template_id, _ = await fresh_charms(db_session)
    v1_id = await _v1_then_v2(db_session, project_id, template_id)

    await restore_version(
        db_session,
        project_id=project_id,
        template_id=template_id,
        version_id=v1_id,
        user_id=SEED.primary_profile,
    )

    assert await _marker(db_session, template_id) is not None
    status = await get_template_config_status(
        db_session, project_id=project_id, template_id=template_id
    )
    assert status.has_pending_changes is True


@pytest.mark.asyncio
async def test_restore_publishes_forward_never_rewriting_history(
    db_session: AsyncSession,
) -> None:
    """History is append-only: restoring v1 then publishing yields v3."""
    project_id, template_id, _ = await fresh_charms(db_session)
    v1_id = await _v1_then_v2(db_session, project_id, template_id)

    await restore_version(
        db_session,
        project_id=project_id,
        template_id=template_id,
        version_id=v1_id,
        user_id=SEED.primary_profile,
    )
    published = await TemplateVersionService(db_session).republish(
        project_id=project_id, project_template_id=template_id, user_id=SEED.primary_profile
    )

    assert published.version == 3
    assert published.changed is True


@pytest.mark.asyncio
async def test_restoring_the_active_version_is_a_no_op_that_says_so(
    db_session: AsyncSession,
) -> None:
    """The edge the spec never answers: vN already equals the live tree.

    `restore_snapshot` writes zero rows, so no 0048 trigger fires and no
    marker is stamped. Reporting "restored!" while Publish stays disabled
    would be a lie, so the result carries `changed=False` and the caller
    renders that honestly.
    """
    project_id, template_id, _ = await fresh_charms(db_session)
    active_id = (
        await db_session.execute(
            text(
                "SELECT id FROM public.extraction_template_versions "
                "WHERE project_template_id = :t AND is_active"
            ),
            {"t": str(template_id)},
        )
    ).scalar_one()

    result = await restore_version(
        db_session,
        project_id=project_id,
        template_id=template_id,
        version_id=active_id,
        user_id=SEED.primary_profile,
    )

    assert result.changed is False
    assert await _marker(db_session, template_id) is None


@pytest.mark.asyncio
async def test_a_version_from_another_template_is_not_found(
    db_session: AsyncSession,
) -> None:
    """The version must belong to THIS template — ids are not capabilities.

    Ordering matters: template A's version id is captured first, then B is
    created, and the restore is attempted on B. Doing it the other way
    round tests nothing, because provisioning B invalidates A.
    """
    _, template_a, _ = await fresh_charms(db_session)
    version_of_a = (
        await db_session.execute(
            text(
                "SELECT id FROM public.extraction_template_versions "
                "WHERE project_template_id = :t AND is_active"
            ),
            {"t": str(template_a)},
        )
    ).scalar_one()

    project_b, template_b, _ = await fresh_charms(db_session)

    with pytest.raises(VersionNotFoundError):
        await restore_version(
            db_session,
            project_id=project_b,
            template_id=template_b,
            version_id=version_of_a,
            user_id=SEED.primary_profile,
        )


@pytest.mark.asyncio
async def test_an_unknown_version_is_not_found(db_session: AsyncSession) -> None:
    project_id, template_id, _ = await fresh_charms(db_session)

    with pytest.raises(VersionNotFoundError):
        await restore_version(
            db_session,
            project_id=project_id,
            template_id=template_id,
            version_id=uuid4(),
            user_id=SEED.primary_profile,
        )


@pytest.mark.asyncio
async def test_restore_is_bola_scoped(db_session: AsyncSession) -> None:
    _, template_id, _ = await fresh_charms(db_session)

    with pytest.raises(ProjectTemplateNotFoundError):
        await restore_version(
            db_session,
            project_id=SEED.primary_project,
            template_id=template_id,
            version_id=uuid4(),
            user_id=SEED.primary_profile,
        )
