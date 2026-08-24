"""Migration 0059 — the entity-key column, its index, and the backfill.

The backfill is the part that ships the fix. ``app.seed`` early-returns on
an existing template (``seed.py:241`` for CHARMS, ``:2030`` for CHARMS +
Multimodal), so editing the seed stamps nothing in any database that
already has them — which is every existing installation, production
included. The seed covers fresh installs; this migration covers the rest.

Coordinates are matched by NAME, never by id: a project clone of a seeded
template carries fresh ids for every row.
"""

from __future__ import annotations

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

pytestmark = pytest.mark.asyncio

# (entity type name, key field name) — both seeded lineages.
SEEDED_COORDINATES = [
    ("prediction_models", "model_name"),
    ("prediction_models", "mdl_name"),
    ("final_predictors", "predictor_name"),
    ("numeric_performance", "pnum_validation_type"),
]


@pytest.mark.parametrize(("entity_type_name", "field_name"), SEEDED_COORDINATES)
async def test_backfill_flags_every_seeded_coordinate(
    db_session: AsyncSession, entity_type_name: str, field_name: str
) -> None:
    rows = (
        await db_session.execute(
            text(
                "SELECT f.is_entity_key "
                "FROM public.extraction_fields f "
                "JOIN public.extraction_entity_types et ON et.id = f.entity_type_id "
                "WHERE et.name = :et AND f.name = :f"
            ),
            {"et": entity_type_name, "f": field_name},
        )
    ).scalars().all()
    assert rows, f"seed did not create ({entity_type_name}, {field_name})"
    assert all(rows), f"backfill missed ({entity_type_name}, {field_name})"


async def test_non_key_fields_are_left_alone(db_session: AsyncSession) -> None:
    """The backfill must be surgical — `modelling_method` is not an identity."""
    flagged = (
        await db_session.execute(
            text(
                "SELECT bool_or(f.is_entity_key) "
                "FROM public.extraction_fields f "
                "JOIN public.extraction_entity_types et ON et.id = f.entity_type_id "
                "WHERE et.name = 'prediction_models' AND f.name = 'modelling_method'"
            )
        )
    ).scalar_one()
    assert flagged is False


async def test_only_one_key_per_entity_type(db_session: AsyncSession) -> None:
    """The partial unique index is the floor under the service-layer guard."""
    entity_type_id = (
        await db_session.execute(
            text(
                "SELECT f.entity_type_id FROM public.extraction_fields f "
                "WHERE f.is_entity_key "
                "  AND EXISTS (SELECT 1 FROM public.extraction_fields o "
                "              WHERE o.entity_type_id = f.entity_type_id AND NOT o.is_entity_key) "
                "LIMIT 1"
            )
        )
    ).scalar_one()
    with pytest.raises(IntegrityError):
        await db_session.execute(
            text(
                "UPDATE public.extraction_fields SET is_entity_key = true "
                "WHERE entity_type_id = :et AND NOT is_entity_key"
            ),
            {"et": entity_type_id},
        )
        await db_session.flush()
    await db_session.rollback()
