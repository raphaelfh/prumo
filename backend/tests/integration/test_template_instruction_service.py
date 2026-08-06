"""template_instruction_service: BOLA guard, normalization, atomic
column-update + republish (the write happens inside republish's locked
section — no fire-and-forget desync, no lock-order inversion)."""

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
from tests.integration.conftest import SEED

_CHARMS_GLOBAL_ID = uuid.UUID("000c0000-0000-0000-0000-000000000001")


@pytest.mark.asyncio
async def test_set_updates_column_and_republishes(db_session: AsyncSession) -> None:
    result = await set_template_instruction(
        db_session,
        project_id=SEED.primary_project,
        template_id=SEED.primary_template,
        llm_template_instruction="Report values exactly as stated.",
        user_id=SEED.primary_profile,
    )
    assert result.llm_template_instruction == "Report values exactly as stated."
    assert result.changed is True

    # The atomic contract: the ACTIVE snapshot published by the same call
    # carries the new text.
    snapshot = (
        await db_session.execute(
            text("SELECT schema FROM public.extraction_template_versions WHERE id = :vid"),
            {"vid": str(result.version_id)},
        )
    ).scalar_one()
    assert snapshot["llm_template_instruction"] == "Report values exactly as stated."

    same_again = await set_template_instruction(
        db_session,
        project_id=SEED.primary_project,
        template_id=SEED.primary_template,
        llm_template_instruction="Report values exactly as stated.",
        user_id=SEED.primary_profile,
    )
    assert same_again.changed is False
    assert same_again.version == result.version


@pytest.mark.asyncio
async def test_clear_and_whitespace_normalize_to_null(
    db_session: AsyncSession,
) -> None:
    await set_template_instruction(
        db_session,
        project_id=SEED.primary_project,
        template_id=SEED.primary_template,
        llm_template_instruction="Some text.",
        user_id=SEED.primary_profile,
    )
    cleared = await set_template_instruction(
        db_session,
        project_id=SEED.primary_project,
        template_id=SEED.primary_template,
        llm_template_instruction="   \n  ",
        user_id=SEED.primary_profile,
    )
    assert cleared.llm_template_instruction is None
    assert cleared.changed is True
    # Key-absent snapshot content is the snapshot suite's contract — no
    # re-assert here.


@pytest.mark.asyncio
async def test_set_is_bola_guarded(db_session: AsyncSession) -> None:
    with pytest.raises(ProjectTemplateNotFoundError):
        await set_template_instruction(
            db_session,
            project_id=SEED.secondary_project,
            template_id=SEED.primary_template,
            llm_template_instruction="X",
            user_id=SEED.primary_profile,
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
