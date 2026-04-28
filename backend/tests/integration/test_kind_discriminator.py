"""Integration tests for the kind discriminator and composite-FK coherence."""

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession


@pytest.mark.asyncio
async def test_kind_column_exists_on_global_template(
    db_session: AsyncSession,
) -> None:
    result = await db_session.execute(
        text(
            """
            SELECT column_name FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'extraction_templates_global'
              AND column_name = 'kind'
            """
        )
    )
    assert result.scalar() == "kind"


@pytest.mark.asyncio
async def test_kind_column_exists_on_project_template(
    db_session: AsyncSession,
) -> None:
    result = await db_session.execute(
        text(
            """
            SELECT column_name FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'project_extraction_templates'
              AND column_name = 'kind'
            """
        )
    )
    assert result.scalar() == "kind"


@pytest.mark.asyncio
async def test_kind_column_exists_on_run(
    db_session: AsyncSession,
) -> None:
    result = await db_session.execute(
        text(
            """
            SELECT column_name FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'extraction_runs'
              AND column_name IN ('kind', 'version_id', 'hitl_config_snapshot')
            ORDER BY column_name
            """
        )
    )
    cols = [row[0] for row in result.fetchall()]
    assert cols == ["hitl_config_snapshot", "kind", "version_id"]


@pytest.mark.asyncio
async def test_existing_templates_backfilled_to_extraction_kind(
    db_session: AsyncSession,
) -> None:
    # Project-level templates pre-date `kind`; the migration backfilled the
    # legacy rows to 'extraction'. QA clones (qa_template_clone_service) now
    # legitimately produce 'quality_assessment' rows, so check the backfill
    # by ensuring legacy rows (no global_template_id pointing at a QA template)
    # are 'extraction'.
    result = await db_session.execute(
        text(
            """
            SELECT COUNT(*) FROM public.project_extraction_templates p
            WHERE p.kind <> 'extraction'
              AND (
                p.global_template_id IS NULL
                OR NOT EXISTS (
                    SELECT 1 FROM public.extraction_templates_global g
                    WHERE g.id = p.global_template_id
                      AND g.kind = 'quality_assessment'
                )
              )
            """
        )
    )
    assert result.scalar() == 0

    # Global extraction templates (CHARMS) must remain kind='extraction'.
    # PROBAST / QUADAS-2 are seeded as kind='quality_assessment' on purpose, so
    # we exclude them by name when verifying the backfill.
    result = await db_session.execute(
        text(
            """
            SELECT COUNT(*) FROM public.extraction_templates_global
            WHERE kind <> 'extraction'
              AND name NOT IN ('PROBAST', 'QUADAS-2')
            """
        )
    )
    assert result.scalar() == 0


@pytest.mark.asyncio
async def test_existing_runs_backfilled_to_extraction_kind(
    db_session: AsyncSession,
) -> None:
    result = await db_session.execute(
        text(
            "SELECT COUNT(*) FROM public.extraction_runs WHERE kind <> 'extraction'",
        )
    )
    assert result.scalar() == 0


@pytest.mark.asyncio
async def test_unique_id_kind_index_on_project_templates(
    db_session: AsyncSession,
) -> None:
    result = await db_session.execute(
        text(
            """
            SELECT conname FROM pg_constraint
            WHERE conname = 'uq_project_extraction_templates_id_kind'
            """
        )
    )
    assert result.scalar() == "uq_project_extraction_templates_id_kind"


@pytest.mark.asyncio
async def test_composite_fk_blocks_kind_mismatch(
    db_session: AsyncSession,
) -> None:
    # Composite FK on (template_id, kind) must reject a Run.kind that doesn't
    # match its Template.kind. PostgreSQL enforces FKs at statement time when
    # NOT DEFERRABLE (the default), so the UPDATE itself raises.
    row_count = await db_session.execute(
        text("SELECT COUNT(*) FROM public.extraction_runs"),
    )
    if row_count.scalar() == 0:
        pytest.skip("No extraction_runs rows to test FK coherence.")

    with pytest.raises(IntegrityError):
        await db_session.execute(
            text(
                """
                UPDATE public.extraction_runs
                SET kind = 'quality_assessment'
                WHERE id = (SELECT id FROM public.extraction_runs LIMIT 1)
                """
            )
        )
    await db_session.rollback()
