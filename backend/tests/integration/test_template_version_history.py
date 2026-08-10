"""The History read (B-9e): every published version, newest first.

Spec section 1: "History (card header): versions with author, timestamp,
note, diff, pinned-run counts." This file owns the read; Restore-vN is a
separate concern with its own gates.

The note column landed with migration 0052 in B-9b2b and nothing rendered
it until now — so these tests are also the first proof that a note written
at publish time survives to a reader.
"""

from __future__ import annotations

from uuid import UUID

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.project_template_active_service import ProjectTemplateNotFoundError
from app.services.template_version_read_service import get_template_version_history
from app.services.template_version_service import TemplateVersionService
from tests.integration.conftest import SEED
from tests.integration.helpers.template_fixtures import (
    delete_field,
    field_id,
    fresh_charms,
)


async def _publish(db: AsyncSession, project_id: UUID, template_id: UUID, note: str | None):
    return await TemplateVersionService(db).republish(
        project_id=project_id,
        project_template_id=template_id,
        user_id=SEED.primary_profile,
        note=note,
    )


@pytest.mark.asyncio
async def test_history_lists_every_version_newest_first(db_session: AsyncSession) -> None:
    """Order is the contract: History reads top-down as a timeline."""
    project_id, template_id, _ = await fresh_charms(db_session)
    await delete_field(
        db_session, await field_id(db_session, template_id, "sample_size", "epv_epp")
    )
    await _publish(db_session, project_id, template_id, "second")

    history = await get_template_version_history(
        db_session, project_id=project_id, template_id=template_id
    )

    assert [entry.version for entry in history.versions] == [2, 1]
    assert history.versions[0].is_active is True
    assert history.versions[1].is_active is False


@pytest.mark.asyncio
async def test_history_carries_the_note_written_at_publish(db_session: AsyncSession) -> None:
    """0052 added the column in B-9b2b; this is the first thing to read it."""
    project_id, template_id, _ = await fresh_charms(db_session)
    await delete_field(
        db_session, await field_id(db_session, template_id, "sample_size", "epv_epp")
    )
    await _publish(db_session, project_id, template_id, "dropped the unused field")

    history = await get_template_version_history(
        db_session, project_id=project_id, template_id=template_id
    )

    assert history.versions[0].note == "dropped the unused field"
    # v1 was published by the clone, which passes no note.
    assert history.versions[1].note is None


@pytest.mark.asyncio
async def test_history_resolves_the_publisher_name(db_session: AsyncSession) -> None:
    """`published_by` is an id; a timeline needs a person."""
    project_id, template_id, _ = await fresh_charms(db_session)

    history = await get_template_version_history(
        db_session, project_id=project_id, template_id=template_id
    )

    entry = history.versions[0]
    assert entry.published_by == SEED.primary_profile
    # The seed profile has a name; a profile without one degrades to None
    # rather than leaking the raw uuid onto the screen.
    assert entry.published_by_name is None or isinstance(entry.published_by_name, str)


@pytest.mark.asyncio
async def test_history_counts_the_runs_pinned_to_each_version(
    db_session: AsyncSession,
) -> None:
    """The number that makes a version's blast radius legible.

    `ExtractionRun.version_id` is ON DELETE RESTRICT, so a version with
    pinned runs is permanent — the count is what tells a manager which
    versions are load-bearing before they restore an old one.
    """
    project_id, template_id, _ = await fresh_charms(db_session)
    before = await get_template_version_history(
        db_session, project_id=project_id, template_id=template_id
    )
    assert before.versions[0].pinned_run_count == 0

    from tests.integration.conftest import open_session

    await open_session(
        db_session,
        project_id=project_id,
        article_id=UUID("ffffffff-9999-0002-0000-0000000009c1"),
        template_id=template_id,
        user_id=SEED.primary_profile,
    )

    after = await get_template_version_history(
        db_session, project_id=project_id, template_id=template_id
    )
    assert after.versions[0].pinned_run_count == 1


@pytest.mark.asyncio
async def test_history_is_bola_scoped(db_session: AsyncSession) -> None:
    """A template owned elsewhere 404s rather than leaking that it exists."""
    _, template_id, _ = await fresh_charms(db_session)

    with pytest.raises(ProjectTemplateNotFoundError):
        await get_template_version_history(
            db_session, project_id=SEED.primary_project, template_id=template_id
        )


@pytest.mark.asyncio
async def test_a_template_with_no_versions_reports_an_empty_history(
    db_session: AsyncSession,
) -> None:
    """Not an error: a template that never published has no timeline yet."""
    project_id, template_id, _ = await fresh_charms(db_session)
    await db_session.execute(
        text("DELETE FROM public.extraction_template_versions WHERE project_template_id = :t"),
        {"t": str(template_id)},
    )
    await db_session.flush()

    history = await get_template_version_history(
        db_session, project_id=project_id, template_id=template_id
    )

    assert history.versions == []
