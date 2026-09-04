"""The seed's entry-noun declarations, read WITHOUT touching a database.

``app.seed`` early-returns on an existing template, so a DB-backed assertion
would test whichever seed happened to run against the shared stack (the
``test_seed_entity_keys`` argument). The seeds run against the recording
session instead; migration 0068's own test pins the database state.
"""

from __future__ import annotations

import pathlib

import pytest

from app.llm.prompts import entry_identification
from app.models.extraction import ExtractionEntityType
from app.seed import seed_charms, seed_charms_mm
from tests.unit.conftest import CapturingSession

# One pair covers both containers: CHARMS and CHARMS + Multimodal name the
# section identically. The container's noun rode B-8's 0051 backfill; the
# other two are what migration 0068 stamps onto existing global rows.
EXPECTED_NOUNS = frozenset(
    {
        ("prediction_models", "model"),
        ("final_predictors", "predictor"),
        ("numeric_performance", "validation"),
    }
)
BACKFILLED_BY_0068 = EXPECTED_NOUNS - {("prediction_models", "model")}


async def seeded_entity_types() -> list[ExtractionEntityType]:
    rows: list[ExtractionEntityType] = []
    for seed in (seed_charms, seed_charms_mm):
        session = CapturingSession()
        await seed(session)
        rows.extend(o for o in session.added if isinstance(o, ExtractionEntityType))
    return rows


@pytest.mark.asyncio
async def test_every_seeded_repeating_section_carries_its_noun() -> None:
    rows = await seeded_entity_types()
    repeating = {(r.name, r.entry_label) for r in rows if r.cardinality == "many"}
    assert repeating == EXPECTED_NOUNS
    assert all(r.entry_label is None for r in rows if r.cardinality != "many")


@pytest.mark.asyncio
async def test_seeded_noun_reaches_the_identification_prompt() -> None:
    predictors = next(r for r in await seeded_entity_types() if r.name == "final_predictors")
    assert predictors.entry_label is not None
    prompt = entry_identification.render(
        group_label=predictors.label,
        entry_label=predictors.entry_label,
        key_label="Predictor name",
        article_text="…",
    )
    assert "identify every predictor it describes" in prompt


def test_migration_0068_stamps_the_same_nouns() -> None:
    """The migration is the only thing that reaches an existing install; a
    noun added to the seed without it would reach fresh databases only."""
    sql = (
        pathlib.Path(__file__).parents[2] / "alembic" / "versions" / "0068_seeded_entry_nouns.py"
    ).read_text()
    for entity_type, noun in BACKFILLED_BY_0068:
        assert f"('{entity_type}', '{noun}')" in sql, (entity_type, noun)
