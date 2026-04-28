"""Integration tests for migration 0016 - drop 008 stack."""

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "table",
    [
        "evidence_records",
        "published_states",
        "consensus_decision_records",
        "reviewer_states",
        "reviewer_decision_records",
        "proposal_records",
        "evaluation_run_targets",
        "evaluation_runs",
        "evaluation_items",
        "evaluation_schema_versions",
        "evaluation_schemas",
    ],
)
async def test_008_table_dropped(db_session: AsyncSession, table: str) -> None:
    result = await db_session.execute(text(f"SELECT to_regclass('public.{table}') AS reg"))
    assert result.scalar() is None


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "enum_name",
    [
        "evaluation_schema_version_status",
        "evaluation_item_type",
        "evaluation_run_status",
        "evaluation_run_stage",
        "evaluation_proposal_source_type",
        "reviewer_decision_type",
        "consensus_decision_mode",
        "published_state_status",
        "evidence_entity_type",
    ],
)
async def test_008_enum_dropped(db_session: AsyncSession, enum_name: str) -> None:
    result = await db_session.execute(
        text("SELECT 1 FROM pg_type WHERE typname = :name AND typtype = 'e'"),
        {"name": enum_name},
    )
    assert result.scalar() is None


@pytest.mark.asyncio
async def test_extraction_tables_untouched(db_session: AsyncSession) -> None:
    for tbl in (
        "extraction_runs",
        "extraction_proposal_records",
        "extraction_published_states",
    ):
        result = await db_session.execute(text(f"SELECT to_regclass('public.{tbl}') AS reg"))
        assert result.scalar() is not None, f"Table {tbl} should still exist"
