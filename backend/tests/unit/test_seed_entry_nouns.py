"""The seed's entry-noun declarations, read WITHOUT touching a database.

``app.seed`` early-returns on an existing template, so a DB-backed assertion
would test whichever seed happened to run against the shared stack (the
``test_seed_entity_keys`` argument). The seeds run against the recording
session instead; migration 0068's own test pins the database state.
"""

from __future__ import annotations

import pathlib

import pytest

from app.models.extraction import ExtractionEntityType
from app.seed import seed_charms, seed_charms_mm
from tests.unit.conftest import CapturingSession

# What 0068 stamps onto existing global rows. The container's noun rode B-8's
# 0051 backfill, and one pair covers both containers (CHARMS and CHARMS +
# Multimodal name the section identically).
BACKFILLED_BY_0068 = frozenset(
    {("final_predictors", "predictor"), ("numeric_performance", "validation")}
)
EXPECTED_NOUNS = BACKFILLED_BY_0068 | {("prediction_models", "model")}


@pytest.mark.asyncio
async def test_every_seeded_repeating_section_carries_its_noun() -> None:
    rows: list[ExtractionEntityType] = []
    for seed in (seed_charms, seed_charms_mm):
        session = CapturingSession()
        await seed(session)
        rows.extend(o for o in session.added if isinstance(o, ExtractionEntityType))

    repeating = {(r.name, r.entry_label) for r in rows if r.cardinality == "many"}
    assert repeating == EXPECTED_NOUNS
    assert all(r.entry_label is None for r in rows if r.cardinality != "many")


def test_migration_0068_stamps_the_same_nouns() -> None:
    """The migration is the only thing that reaches an existing install; a
    noun added to the seed without it would reach fresh databases only."""
    sql = (
        pathlib.Path(__file__).parents[2] / "alembic" / "versions" / "0068_seeded_entry_nouns.py"
    ).read_text()
    for entity_type, noun in BACKFILLED_BY_0068:
        assert f"('{entity_type}', '{noun}')" in sql, (entity_type, noun)
