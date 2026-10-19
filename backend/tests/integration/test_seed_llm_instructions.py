"""Seed backfill for template general AI instructions (spec §4).

The seeders early-return when a template exists, so defaults are
delivered by a separate idempotent backfill pass: it fills NULL, replaces an
unedited retired default, and never clobbers customized text.
"""

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.seed import backfill_llm_template_instructions
from app.seed_instruction_defaults import (
    CHARMS_INSTRUCTION,
    RETIRED_CHARMS_INSTRUCTION,
)

_TEMPLATE_NAMES = (
    "CHARMS",
    "CHARMS + Multimodal (ML prediction)",
    "PROBAST",
    "QUADAS-2",
    "PROBAST+AI",
)


@pytest.mark.asyncio
async def test_backfill_fills_null_instructions(db_session: AsyncSession) -> None:
    await db_session.execute(
        text("UPDATE public.extraction_templates_global SET llm_template_instruction = NULL")
    )
    await backfill_llm_template_instructions(db_session)
    for name in _TEMPLATE_NAMES:
        value = (
            await db_session.execute(
                text(
                    "SELECT llm_template_instruction "
                    "FROM public.extraction_templates_global WHERE name = :name"
                ),
                {"name": name},
            )
        ).scalar_one()
        assert value, f"{name} should have a seeded instruction"
        assert len(value) <= 4000


async def _charms_instruction(db_session: AsyncSession) -> str | None:
    return (
        await db_session.execute(
            text(
                "SELECT llm_template_instruction "
                "FROM public.extraction_templates_global WHERE name = 'CHARMS'"
            )
        )
    ).scalar_one()


async def _all_instructions(db_session: AsyncSession) -> dict[str, str | None]:
    rows = await db_session.execute(
        text("SELECT name, llm_template_instruction FROM public.extraction_templates_global")
    )
    return dict(rows.tuples().all())


@pytest.mark.asyncio
async def test_backfill_replaces_a_retired_default(db_session: AsyncSession) -> None:
    await db_session.execute(
        text(
            "UPDATE public.extraction_templates_global "
            "SET llm_template_instruction = :retired WHERE name = 'CHARMS'"
        ),
        {"retired": RETIRED_CHARMS_INSTRUCTION},
    )
    assert await _charms_instruction(db_session) == RETIRED_CHARMS_INSTRUCTION
    await backfill_llm_template_instructions(db_session)
    assert await _charms_instruction(db_session) == CHARMS_INSTRUCTION


@pytest.mark.asyncio
async def test_backfill_rerun_is_a_no_op(db_session: AsyncSession) -> None:
    await db_session.execute(
        text("UPDATE public.extraction_templates_global SET llm_template_instruction = NULL")
    )
    await backfill_llm_template_instructions(db_session)
    first = await _all_instructions(db_session)
    # An UPDATE writes a new tuple version, so an unchanged ctid proves the
    # second pass wrote no row at all (not merely the same values).
    ctids_sql = text("SELECT id, ctid::text FROM public.extraction_templates_global")
    ctids = dict((await db_session.execute(ctids_sql)).all())
    await backfill_llm_template_instructions(db_session)
    assert await _all_instructions(db_session) == first
    assert dict((await db_session.execute(ctids_sql)).all()) == ctids


@pytest.mark.asyncio
async def test_backfill_never_clobbers_customized_text(
    db_session: AsyncSession,
) -> None:
    await db_session.execute(
        text(
            "UPDATE public.extraction_templates_global "
            "SET llm_template_instruction = 'CUSTOMIZED' WHERE name = 'CHARMS'"
        )
    )
    await backfill_llm_template_instructions(db_session)
    assert await _charms_instruction(db_session) == "CUSTOMIZED"
