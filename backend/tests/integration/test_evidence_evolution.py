"""Integration tests for the evidence_evolution migration."""

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "column",
    ["run_id", "proposal_record_id", "reviewer_decision_id", "consensus_decision_id"],
)
async def test_evidence_column_added(db_session: AsyncSession, column: str) -> None:
    result = await db_session.execute(
        text(
            f"""
            SELECT column_name, is_nullable FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'extraction_evidence'
              AND column_name = '{column}'
            """
        )
    )
    row = result.first()
    assert row is not None
    assert row[1] == "YES"  # nullable


@pytest.mark.asyncio
@pytest.mark.parametrize("column", ["target_type", "target_id"])
async def test_evidence_legacy_columns_dropped(
    db_session: AsyncSession,
    column: str,
) -> None:
    """Migration 0017 removes the polymorphic legacy target columns."""
    result = await db_session.execute(
        text(
            f"""
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'extraction_evidence'
              AND column_name = '{column}'
            """
        )
    )
    assert result.scalar() is None


@pytest.mark.asyncio
async def test_evidence_check_constraint_present(db_session: AsyncSession) -> None:
    """Post-0017: workflow path is mandatory (run_id + at least one
    proposal/decision/consensus FK)."""
    result = await db_session.execute(
        text(
            """
            SELECT conname FROM pg_constraint
            WHERE conname = 'workflow_target_present'
            """
        )
    )
    assert result.scalar() == "workflow_target_present"


@pytest.mark.asyncio
async def test_evidence_check_blocks_empty_insert(db_session: AsyncSession) -> None:
    project_id = (
        await db_session.execute(
            text(
                "SELECT p.id FROM public.projects p WHERE EXISTS (SELECT 1 FROM public.project_extraction_templates t JOIN public.extraction_entity_types et ON et.project_template_id = t.id JOIN public.extraction_fields f ON f.entity_type_id = et.id JOIN public.extraction_instances i ON i.template_id = t.id WHERE t.project_id = p.id) ORDER BY p.id LIMIT 1"
            )
        )
    ).scalar()
    article_id = (
        await db_session.execute(
            text("SELECT id FROM public.articles WHERE project_id = :pid LIMIT 1"),
            {"pid": project_id},
        )
    ).scalar()
    profile_id = (
        await db_session.execute(
            text(
                "SELECT pm.user_id FROM public.project_members pm WHERE pm.role = 'manager' AND EXISTS (SELECT 1 FROM public.project_extraction_templates t JOIN public.extraction_entity_types et ON et.project_template_id = t.id JOIN public.extraction_fields f ON f.entity_type_id = et.id JOIN public.extraction_instances i ON i.template_id = t.id WHERE t.project_id = pm.project_id) ORDER BY pm.user_id LIMIT 1"
            )
        )
    ).scalar()
    if not all((project_id, article_id, profile_id)):
        pytest.skip("Need projects/articles/profiles fixtures.")

    # Insert with neither workflow FKs nor legacy target → must fail with CHECK violation.
    with pytest.raises(IntegrityError):
        await db_session.execute(
            text(
                """
                INSERT INTO public.extraction_evidence (project_id, article_id, created_by)
                VALUES (:project_id, :article_id, :profile_id)
                """
            ),
            {"project_id": project_id, "article_id": article_id, "profile_id": profile_id},
        )
    await db_session.rollback()


@pytest.mark.asyncio
async def test_evidence_run_id_index(db_session: AsyncSession) -> None:
    result = await db_session.execute(
        text("SELECT indexname FROM pg_indexes WHERE indexname = 'idx_extraction_evidence_run_id'")
    )
    assert result.scalar() == "idx_extraction_evidence_run_id"
