"""The seed's entity-key declarations, read WITHOUT touching a database.

``app.seed`` early-returns on an existing template (``seed.py:241``,
``:2030``), so a DB-backed assertion here would really be testing whichever
seed happened to run against the shared stack. Assert the declaration
instead; migration 0059's test pins the resulting database state.

The constant exists so the seed (fresh installs) and the migration
backfill (every existing install) cannot drift apart — they are two
mechanisms that must agree on one list.
"""

from __future__ import annotations

import pathlib

from app.seed import ENTITY_KEY_FIELDS

EXPECTED = frozenset(
    {
        ("prediction_models", "model_name"),
        ("prediction_models", "mdl_name"),
        ("final_predictors", "predictor_name"),
        ("numeric_performance", "pnum_validation_type"),
    }
)


def test_the_four_repeating_groups_declare_their_key() -> None:
    assert ENTITY_KEY_FIELDS == EXPECTED


def test_prediction_models_is_the_only_name_shared_by_two_lineages() -> None:
    """CHARMS calls it ``model_name``, CHARMS + Multimodal ``mdl_name``.

    Any OTHER entity-type name appearing twice would mean one repeating
    group claiming two keys, which the partial unique index rejects.
    """
    seen: dict[str, int] = {}
    for entity_type, _ in ENTITY_KEY_FIELDS:
        seen[entity_type] = seen.get(entity_type, 0) + 1
    assert [name for name, n in seen.items() if n > 1] == ["prediction_models"]


def test_migration_backfill_names_the_same_coordinates() -> None:
    """The backfill SQL is the only thing that reaches existing installs.

    If someone adds a key to the seed and forgets the migration, fresh
    databases get it and production silently does not.
    """
    sql = (
        pathlib.Path(__file__).parents[2]
        / "alembic"
        / "versions"
        / "0059_entity_key_field.py"
    ).read_text()
    for entity_type, field in ENTITY_KEY_FIELDS:
        assert f"'{entity_type}'" in sql, f"backfill is missing entity type {entity_type}"
        assert f"'{field}'" in sql, f"backfill is missing field {field}"
