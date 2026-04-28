"""Integration tests for PROBAST + QUADAS-2 seed."""

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


@pytest.mark.asyncio
async def test_probast_template_exists(db_session: AsyncSession) -> None:
    result = await db_session.execute(
        text(
            """
            SELECT id, kind, framework FROM public.extraction_templates_global
            WHERE name = 'PROBAST'
            """
        )
    )
    row = result.first()
    assert row is not None, "PROBAST template should exist after seed"
    assert row[1] == "quality_assessment"
    assert row[2] == "CUSTOM"


@pytest.mark.asyncio
async def test_probast_has_five_entity_types(db_session: AsyncSession) -> None:
    count = (
        await db_session.execute(
            text(
                """
                SELECT COUNT(*) FROM public.extraction_entity_types et
                JOIN public.extraction_templates_global t ON t.id = et.template_id
                WHERE t.name = 'PROBAST'
                """
            )
        )
    ).scalar()
    assert count == 5


@pytest.mark.asyncio
async def test_probast_each_domain_has_signaling_questions(
    db_session: AsyncSession,
) -> None:
    for domain in ("Participants", "Predictors", "Outcome", "Analysis"):
        count = (
            await db_session.execute(
                text(
                    """
                    SELECT COUNT(*) FROM public.extraction_fields f
                    JOIN public.extraction_entity_types et ON et.id = f.entity_type_id
                    JOIN public.extraction_templates_global t ON t.id = et.template_id
                    WHERE t.name = 'PROBAST'
                      AND et.label = :domain
                      AND f.name LIKE 'q%'
                    """
                ),
                {"domain": domain},
            )
        ).scalar()
        assert count >= 2, f"PROBAST {domain} should have ≥2 signaling questions"


@pytest.mark.asyncio
async def test_probast_each_domain_has_risk_of_bias(db_session: AsyncSession) -> None:
    for domain in ("Participants", "Predictors", "Outcome", "Analysis"):
        count = (
            await db_session.execute(
                text(
                    """
                    SELECT COUNT(*) FROM public.extraction_fields f
                    JOIN public.extraction_entity_types et ON et.id = f.entity_type_id
                    JOIN public.extraction_templates_global t ON t.id = et.template_id
                    WHERE t.name = 'PROBAST'
                      AND et.label = :domain
                      AND f.name = 'risk_of_bias'
                    """
                ),
                {"domain": domain},
            )
        ).scalar()
        assert count == 1


@pytest.mark.asyncio
async def test_quadas2_template_exists(db_session: AsyncSession) -> None:
    result = await db_session.execute(
        text(
            """
            SELECT id, kind, framework FROM public.extraction_templates_global
            WHERE name = 'QUADAS-2'
            """
        )
    )
    row = result.first()
    assert row is not None, "QUADAS-2 template should exist after seed"
    assert row[1] == "quality_assessment"
    assert row[2] == "CUSTOM"


@pytest.mark.asyncio
async def test_quadas2_has_five_entity_types(db_session: AsyncSession) -> None:
    count = (
        await db_session.execute(
            text(
                """
                SELECT COUNT(*) FROM public.extraction_entity_types et
                JOIN public.extraction_templates_global t ON t.id = et.template_id
                WHERE t.name = 'QUADAS-2'
                """
            )
        )
    ).scalar()
    assert count == 5


@pytest.mark.asyncio
async def test_seed_is_idempotent(db_session: AsyncSession) -> None:
    """Re-running seed_probast / seed_quadas2 produces no new rows."""
    from app.seed import seed_probast, seed_quadas2

    template_count_before = (
        await db_session.execute(
            text(
                "SELECT COUNT(*) FROM public.extraction_templates_global WHERE kind = 'quality_assessment'"
            )
        )
    ).scalar()

    await seed_probast(db_session)
    await seed_quadas2(db_session)
    await db_session.flush()

    template_count_after = (
        await db_session.execute(
            text(
                "SELECT COUNT(*) FROM public.extraction_templates_global WHERE kind = 'quality_assessment'"
            )
        )
    ).scalar()
    assert template_count_after == template_count_before
    await db_session.rollback()
