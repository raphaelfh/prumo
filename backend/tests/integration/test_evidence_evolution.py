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
async def test_evidence_legacy_columns_now_nullable(
    db_session: AsyncSession, column: str,
) -> None:
    result = await db_session.execute(
        text(
            f"""
            SELECT is_nullable FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'extraction_evidence'
              AND column_name = '{column}'
            """
        )
    )
    assert result.scalar() == "YES"


@pytest.mark.asyncio
async def test_evidence_check_constraint_present(db_session: AsyncSession) -> None:
    result = await db_session.execute(
        text(
            """
            SELECT conname FROM pg_constraint
            WHERE conname = 'ck_extraction_evidence_workflow_or_legacy_target'
            """
        )
    )
    assert result.scalar() == "ck_extraction_evidence_workflow_or_legacy_target"


@pytest.mark.asyncio
async def test_evidence_check_blocks_empty_insert(db_session: AsyncSession) -> None:
    project_id = (await db_session.execute(text("SELECT id FROM public.projects LIMIT 1"))).scalar()
    article_id = (await db_session.execute(text("SELECT id FROM public.articles LIMIT 1"))).scalar()
    profile_id = (await db_session.execute(text("SELECT id FROM public.profiles LIMIT 1"))).scalar()
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
        text(
            "SELECT indexname FROM pg_indexes WHERE indexname = 'idx_extraction_evidence_run_id'"
        )
    )
    assert result.scalar() == "idx_extraction_evidence_run_id"
