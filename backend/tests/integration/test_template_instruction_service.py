"""template_instruction_service: BOLA guard, normalization, and the B-4
draft contract — an instruction edit stages a draft (column + marker),
never republishes; the text reaches the snapshot only at Publish."""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.schemas.hitl_session import TemplateKind
from app.services.project_template_active_service import ProjectTemplateNotFoundError
from app.services.template_clone_service import TemplateCloneService
from app.services.template_instruction_service import (
    get_template_instruction,
    set_template_instruction,
)
from tests.integration.conftest import (
    SEED,
    get_config_draft_marker,
    set_config_draft_marker,
)

_CHARMS_GLOBAL_ID = uuid.UUID("000c0000-0000-0000-0000-000000000001")


async def _version_count(db: AsyncSession, template_id: uuid.UUID) -> int:
    return (
        await db.execute(
            text(
                "SELECT count(*) FROM public.extraction_template_versions "
                "WHERE project_template_id = :tid"
            ),
            {"tid": str(template_id)},
        )
    ).scalar_one()


@pytest.mark.asyncio
async def test_set_stages_draft_without_republishing(db_session: AsyncSession) -> None:
    """B-4 inversion: the write lands on the column + stamps the draft
    marker; NO version row appears and the active snapshot stays
    untouched until an explicit Publish."""
    await set_config_draft_marker(db_session, SEED.primary_template, None)
    versions_before = await _version_count(db_session, SEED.primary_template)

    result = await set_template_instruction(
        db_session,
        project_id=SEED.primary_project,
        template_id=SEED.primary_template,
        llm_template_instruction="Report values exactly as stated.",
    )
    assert result.llm_template_instruction == "Report values exactly as stated."
    assert result.project_template_id == SEED.primary_template

    assert await _version_count(db_session, SEED.primary_template) == versions_before, (
        "an instruction edit must not mint a version"
    )
    active_snapshot = (
        await db_session.execute(
            text(
                "SELECT schema FROM public.extraction_template_versions "
                "WHERE project_template_id = :tid AND is_active"
            ),
            {"tid": str(SEED.primary_template)},
        )
    ).scalar_one_or_none()
    if active_snapshot is not None:
        assert active_snapshot.get("llm_template_instruction") != (
            "Report values exactly as stated."
        ), "the draft text must not reach the active snapshot before Publish"
    assert await get_config_draft_marker(db_session, SEED.primary_template) is not None, (
        "an instruction edit is a draft edit — it must stamp the marker"
    )


@pytest.mark.asyncio
async def test_publish_picks_up_staged_instruction(db_session: AsyncSession) -> None:
    """The staged text reaches the snapshot at Publish, which clears the
    marker."""
    from app.services.template_version_service import TemplateVersionService

    await db_session.execute(
        text("DELETE FROM public.project_extraction_templates WHERE project_id = :pid"),
        {"pid": str(SEED.secondary_project)},
    )
    clone = await TemplateCloneService(db_session).clone(
        project_id=SEED.secondary_project,
        global_template_id=_CHARMS_GLOBAL_ID,
        user_id=SEED.primary_profile,
        kind=TemplateKind.EXTRACTION,
    )

    await set_template_instruction(
        db_session,
        project_id=SEED.secondary_project,
        template_id=clone.project_template_id,
        llm_template_instruction="Staged guidance.",
    )
    assert await get_config_draft_marker(db_session, clone.project_template_id) is not None

    published = await TemplateVersionService(db_session).republish(
        project_id=SEED.secondary_project,
        project_template_id=clone.project_template_id,
        user_id=SEED.primary_profile,
    )
    assert published.changed is True
    snapshot = (
        await db_session.execute(
            text("SELECT schema FROM public.extraction_template_versions WHERE id = :vid"),
            {"vid": str(published.version_id)},
        )
    ).scalar_one()
    assert snapshot["llm_template_instruction"] == "Staged guidance."
    assert await get_config_draft_marker(db_session, clone.project_template_id) is None

    await db_session.rollback()


@pytest.mark.asyncio
async def test_same_value_is_noop_and_does_not_stamp(db_session: AsyncSession) -> None:
    await set_template_instruction(
        db_session,
        project_id=SEED.primary_project,
        template_id=SEED.primary_template,
        llm_template_instruction="Stable text.",
    )
    await set_config_draft_marker(db_session, SEED.primary_template, None)

    again = await set_template_instruction(
        db_session,
        project_id=SEED.primary_project,
        template_id=SEED.primary_template,
        llm_template_instruction="Stable text.",
    )
    assert again.llm_template_instruction == "Stable text."
    assert await get_config_draft_marker(db_session, SEED.primary_template) is None, (
        "a no-op write must not stamp the draft marker"
    )


@pytest.mark.asyncio
async def test_clear_and_whitespace_normalize_to_null(
    db_session: AsyncSession,
) -> None:
    await set_template_instruction(
        db_session,
        project_id=SEED.primary_project,
        template_id=SEED.primary_template,
        llm_template_instruction="Some text.",
    )
    cleared = await set_template_instruction(
        db_session,
        project_id=SEED.primary_project,
        template_id=SEED.primary_template,
        llm_template_instruction="   \n  ",
    )
    assert cleared.llm_template_instruction is None
    value = (
        await db_session.execute(
            text(
                "SELECT llm_template_instruction "
                "FROM public.project_extraction_templates WHERE id = :tid"
            ),
            {"tid": str(SEED.primary_template)},
        )
    ).scalar_one()
    assert value is None


@pytest.mark.asyncio
async def test_set_is_bola_guarded(db_session: AsyncSession) -> None:
    with pytest.raises(ProjectTemplateNotFoundError):
        await set_template_instruction(
            db_session,
            project_id=SEED.secondary_project,
            template_id=SEED.primary_template,
            llm_template_instruction="X",
        )
    value = (
        await db_session.execute(
            text(
                "SELECT llm_template_instruction "
                "FROM public.project_extraction_templates WHERE id = :tid"
            ),
            {"tid": str(SEED.primary_template)},
        )
    ).scalar_one()
    assert value != "X"


@pytest.mark.asyncio
async def test_get_returns_value_and_origin_default(
    db_session: AsyncSession,
) -> None:
    """default_instruction sources from the origin global (clone-based
    fixture — no hand-maintained INSERT column lists)."""
    await db_session.execute(
        text("DELETE FROM public.project_extraction_templates WHERE project_id = :pid"),
        {"pid": str(SEED.secondary_project)},
    )
    await db_session.execute(
        text(
            "UPDATE public.extraction_templates_global "
            "SET llm_template_instruction = 'Origin default.' WHERE id = :gid"
        ),
        {"gid": str(_CHARMS_GLOBAL_ID)},
    )
    clone = await TemplateCloneService(db_session).clone(
        project_id=SEED.secondary_project,
        global_template_id=_CHARMS_GLOBAL_ID,
        user_id=SEED.primary_profile,
        kind=TemplateKind.EXTRACTION,
    )
    # Clones are born WITH the copied text; null the project column to
    # isolate the default_instruction read path.
    await db_session.execute(
        text(
            "UPDATE public.project_extraction_templates "
            "SET llm_template_instruction = NULL WHERE id = :tid"
        ),
        {"tid": str(clone.project_template_id)},
    )
    read = await get_template_instruction(
        db_session,
        project_id=SEED.secondary_project,
        template_id=clone.project_template_id,
    )
    assert read.llm_template_instruction is None
    assert read.default_instruction == "Origin default."

    with pytest.raises(ProjectTemplateNotFoundError):
        await get_template_instruction(
            db_session,
            project_id=SEED.primary_project,
            template_id=clone.project_template_id,
        )
