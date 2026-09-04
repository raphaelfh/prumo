"""Migration 0068 — the two seeded nouns stamped onto global catalogue rows.

Runs the migration's UPDATE inside the savepoint-isolated ``db_session``.
The statement is table-wide, so the shared local database's own seeded
rows are touched too (and rolled back); every assertion here is per row,
on rows this test creates.
"""

from __future__ import annotations

import importlib.util
from pathlib import Path
from uuid import UUID, uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction import ExtractionEntityType, ExtractionTemplateGlobal
from tests.factories.template_factory import TemplateFactory
from tests.integration.conftest import SEED

_MIG_PATH = (
    Path(__file__).resolve().parents[2] / "alembic" / "versions" / "0068_seeded_entry_nouns.py"
)
_spec = importlib.util.spec_from_file_location("mig0068", _MIG_PATH)
assert _spec is not None and _spec.loader is not None
_mig = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_mig)


async def _global_template(db: AsyncSession) -> UUID:
    template = ExtractionTemplateGlobal(
        id=uuid4(), name="0068 fixture", framework="CUSTOM", kind="extraction"
    )
    db.add(template)
    await db.flush()
    return template.id


async def _add(db: AsyncSession, **cols: object) -> UUID:
    row = ExtractionEntityType(
        **{"id": uuid4(), "label": "x", "role": "study_section", "cardinality": "many", **cols}
    )
    db.add(row)
    await db.flush()
    return row.id


async def _noun(db: AsyncSession, row_id: UUID) -> str | None:
    return (
        await db.execute(
            text("SELECT entry_label FROM public.extraction_entity_types WHERE id = :id"),
            {"id": str(row_id)},
        )
    ).scalar_one()


async def _upgrade(db: AsyncSession) -> int:
    return (await db.execute(text(_mig.UPGRADE_SQL))).rowcount


@pytest.mark.asyncio
async def test_stamps_the_two_seeded_groups_on_global_rows(db_session: AsyncSession) -> None:
    tid = await _global_template(db_session)
    predictors = await _add(db_session, template_id=tid, name="final_predictors")
    validations = await _add(db_session, template_id=tid, name="numeric_performance")

    await _upgrade(db_session)

    assert await _noun(db_session, predictors) == "predictor"
    assert await _noun(db_session, validations) == "validation"


@pytest.mark.asyncio
async def test_skips_clones_named_rows_and_non_repeating_rows(db_session: AsyncSession) -> None:
    """Versioned config on a clone is never touched; a noun a manager typed
    wins; a name match alone (a non-repeating row) is not enough."""
    tid = await _global_template(db_session)
    clone_tid = await TemplateFactory(
        db_session, SEED.secondary_project, SEED.primary_profile
    ).create()
    clone = await _add(db_session, project_template_id=clone_tid, name="final_predictors")
    named = await _add(db_session, template_id=tid, name="final_predictors", entry_label="feature")
    single = await _add(db_session, template_id=tid, name="numeric_performance", cardinality="one")

    await _upgrade(db_session)

    assert await _noun(db_session, clone) is None
    assert await _noun(db_session, named) == "feature"
    assert await _noun(db_session, single) is None


@pytest.mark.asyncio
async def test_is_idempotent(db_session: AsyncSession) -> None:
    tid = await _global_template(db_session)
    predictors = await _add(db_session, template_id=tid, name="final_predictors")

    await _upgrade(db_session)
    assert await _upgrade(db_session) == 0  # nothing left to stamp anywhere

    assert await _noun(db_session, predictors) == "predictor"
