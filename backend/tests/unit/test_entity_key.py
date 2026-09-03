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

from datetime import UTC, datetime
from types import SimpleNamespace
from uuid import uuid4

import pytest

from app.schemas.extraction_run import RunViewEntityType, RunViewField
from app.services.entity_key import (
    HISTORY_KEY,
    STORE_KEY,
    MissingEntityKeyError,
    key_field_of,
    normalize_key,
    rekey_instance,
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


# ---------------------------------------------------------------------------
# rekey_instance — a reviewer action, append-only (constitution §IX)
# ---------------------------------------------------------------------------


def _instance(metadata: dict | None) -> SimpleNamespace:
    return SimpleNamespace(metadata_=metadata)


def test_rekey_rewrites_the_identity_and_appends_who_when_from_to() -> None:
    actor = uuid4()
    when = datetime(2026, 9, 3, 12, 0, tzinfo=UTC)
    instance = _instance(stamp({"ai_extracted": True}, "XGBoost"))

    changed = rekey_instance(instance, key_value="  Gradient  Boosting ", actor_id=actor, at=when)

    assert changed is True
    assert instance.metadata_[STORE_KEY] == "gradient boosting"
    assert instance.metadata_["ai_extracted"] is True, "the rest of the record survives"
    assert instance.metadata_[HISTORY_KEY] == [
        {"who": str(actor), "when": when.isoformat(), "from": "xgboost", "to": "gradient boosting"}
    ]


def test_rekey_is_append_only_across_successive_changes() -> None:
    instance = _instance(stamp({}, "A"))
    rekey_instance(instance, key_value="B", actor_id=uuid4())
    rekey_instance(instance, key_value="C", actor_id=uuid4())
    assert [h["from"] for h in instance.metadata_[HISTORY_KEY]] == ["a", "b"]
    assert [h["to"] for h in instance.metadata_[HISTORY_KEY]] == ["b", "c"]
    assert instance.metadata_[STORE_KEY] == "c"


def test_rekey_to_the_same_identity_writes_nothing() -> None:
    """Case and spacing are not identity — a no-op leaves no history row."""
    instance = _instance(stamp({}, "XGBoost"))
    before = dict(instance.metadata_)
    assert rekey_instance(instance, key_value="  xgboost ", actor_id=uuid4()) is False
    assert instance.metadata_ == before
    assert HISTORY_KEY not in instance.metadata_


def test_rekey_records_a_pre_0059_row_as_keyless_before() -> None:
    instance = _instance({"created_via": "hitl_session"})
    rekey_instance(instance, key_value="LightGBM", actor_id=uuid4())
    assert instance.metadata_[HISTORY_KEY][0]["from"] is None
    assert instance.metadata_[STORE_KEY] == "lightgbm"


def test_rekey_replaces_the_metadata_object_so_the_orm_sees_the_change() -> None:
    """An in-place mutation of a JSONB dict is invisible to SQLAlchemy's
    change tracking; the write has to be a reassignment."""
    original = stamp({}, "A")
    instance = _instance(original)
    rekey_instance(instance, key_value="B", actor_id=uuid4())
    assert instance.metadata_ is not original
    assert STORE_KEY in original and original[STORE_KEY] == "a", "the old dict is untouched"
