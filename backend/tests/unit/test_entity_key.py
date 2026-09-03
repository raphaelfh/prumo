"""Pure helpers of the entity-key concept — no database.

Identity is materialized on the instance row at creation, NOT derived from
the key field's value (spec §5.1.1). The reason is blind review: the only
value resolver, ``resolve_caller_current_values``, is caller-scoped and is
the 4th lockstep copy of migration 0025's blind predicate. Read it scoped
and a second reviewer cannot see the first reviewer's value, so the
duplicate is created anyway; read it unscoped and reviewer judgment leaks
across the boundary ADR-0012 exists to hold.
"""

from __future__ import annotations

from types import SimpleNamespace
from uuid import uuid4

import pytest

from app.schemas.extraction_run import RunViewEntityType, RunViewField
from app.services.entity_key import (
    STORE_KEY,
    MissingEntityKeyError,
    key_field_of,
    normalize_key,
    stamp,
)


def test_normalize_is_case_and_whitespace_insensitive() -> None:
    assert normalize_key("  XGBoost  ") == normalize_key("xgboost")
    assert normalize_key("Gradient  Boosting") == normalize_key("gradient boosting")
    assert normalize_key("Random\tForest") == normalize_key("random forest")


def test_normalize_keeps_distinct_entities_distinct() -> None:
    assert normalize_key("XGBoost") != normalize_key("LightGBM")


def test_stamp_materializes_the_normalized_key_without_dropping_metadata() -> None:
    out = stamp({"ai_extracted": True, "ai_run_id": "r1"}, "  XGBoost ")
    assert out[STORE_KEY] == "xgboost"
    assert out["ai_extracted"] is True
    assert out["ai_run_id"] == "r1"


def test_stamp_does_not_mutate_its_input() -> None:
    original = {"ai_extracted": True}
    stamp(original, "XGBoost")
    assert STORE_KEY not in original


def test_stamp_overwrites_a_previous_key() -> None:
    once = stamp({}, "XGBoost")
    twice = stamp(once, "LightGBM")
    assert twice[STORE_KEY] == "lightgbm"


# ---------------------------------------------------------------------------
# key_field_of — the declaration is read from the tree the run is pinned to
# ---------------------------------------------------------------------------


def _field(name: str, *, key: bool) -> RunViewField:
    return RunViewField(
        id=uuid4(),
        name=name,
        label=name.replace("_", " ").title(),
        field_type="text",
        is_required=False,
        sort_order=0,
        is_entity_key=key,
    )


def _entity_type(cardinality: str, fields: list[RunViewField]) -> RunViewEntityType:
    return RunViewEntityType(
        id=uuid4(),
        name="numeric_performance",
        label="Numeric performance",
        cardinality=cardinality,
        role="study_section",
        sort_order=0,
        is_required=False,
        fields=fields,
    )


def test_key_field_of_is_none_for_a_section_that_does_not_repeat() -> None:
    """A key on a cardinality='one' section is inert, not an error (spec §6.1)."""
    assert key_field_of(_entity_type("one", [_field("model_name", key=True)])) is None


def test_key_field_of_returns_the_declared_key_of_a_repeating_group() -> None:
    key = _field("validation_type", key=True)
    found = key_field_of(_entity_type("many", [_field("c_statistic", key=False), key]))
    assert found is not None
    assert found.id == key.id


def test_key_field_of_refuses_a_keyless_repeating_group_naming_the_section() -> None:
    """A UUID does not tell the manager which section to open."""
    entity_type = _entity_type("many", [_field("c_statistic", key=False)])
    with pytest.raises(MissingEntityKeyError) as excinfo:
        key_field_of(entity_type)
    assert "'Numeric performance'" in str(excinfo.value)
    assert str(entity_type.id) not in str(excinfo.value)
    assert excinfo.value.entity_type_id == entity_type.id


def test_key_field_of_accepts_the_live_row_shape_the_pin_falls_back_to() -> None:
    """Both AI services fall back to the live ORM row when the pinned tree does
    not carry the section (a re-pin race, or a narrow pre-0026 snapshot), so
    the reader is duck-typed over the columns the two shapes share."""
    key = SimpleNamespace(id=uuid4(), label="Model Name", is_entity_key=True)
    live = SimpleNamespace(
        id=uuid4(),
        name="prediction_models",
        label="Prediction Models",
        cardinality="many",
        fields=[SimpleNamespace(id=uuid4(), label="Method", is_entity_key=False), key],
    )
    assert key_field_of(live) is key
