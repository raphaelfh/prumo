"""Seed fill-if-null for template general AI instructions (spec §4).

The seeders early-return when a template exists, so defaults are
delivered by a separate idempotent backfill pass that never clobbers
customized text.
"""

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.seed import backfill_llm_template_instructions

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
    value = (
        await db_session.execute(
            text(
                "SELECT llm_template_instruction "
                "FROM public.extraction_templates_global WHERE name = 'CHARMS'"
            )
        )
    ).scalar_one()
    assert value == "CUSTOMIZED"
