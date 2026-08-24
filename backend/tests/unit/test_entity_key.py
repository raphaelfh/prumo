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

from app.services.entity_key import STORE_KEY, normalize_key, stamp


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
