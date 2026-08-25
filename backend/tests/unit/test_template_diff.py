"""Unit tests for the pure template-config diff engine (B-9a, T1).

No DB, no fixtures beyond dict literals — ``diff_snapshots`` is a pure
comparison over two snapshot dicts plus the recorded-value id set (D3).

The builders come from ``tests.unit.helpers.snapshot_builders`` (shared with
the read-model suite) and hand-build snapshot dicts in the exact shape
``SNAPSHOT_SQL`` emits (``extraction_snapshot.py:45-97``). The "era" shapes
older stored snapshots really have — pre-#462 field objects without
``allows_not_*``, pre-0051 entity objects without ``entry_label`` — are made
by stripping keys back off below. Those must diff as *unchanged* against a
modern live tree (D4), otherwise every legacy template would report a
phantom draft.
"""

from __future__ import annotations

import re
from typing import Any
from uuid import UUID, uuid4

import pytest

from app.domain.template_change import ChangeTier
from app.services import template_diff
from app.services.extraction_snapshot import SNAPSHOT_SQL
from app.services.template_diff import (
    ChangeKind,
    NodeKind,
    diff_snapshots,
)
from tests.unit.helpers.snapshot_builders import entity_node as _entity
from tests.unit.helpers.snapshot_builders import field_node as _field
from tests.unit.helpers.snapshot_builders import snapshot as _snapshot

NO_VALUES: frozenset[UUID] = frozenset()


def _strip(node: dict[str, Any], *keys: str) -> dict[str, Any]:
    """Drop keys, emulating a snapshot frozen before those columns existed."""
    return {k: v for k, v in node.items() if k not in keys}


def _strip_from_fields(entity: dict[str, Any], *keys: str) -> dict[str, Any]:
    return dict(entity, fields=[_strip(f, *keys) for f in entity["fields"]])


def _only(diff: template_diff.TemplateDiff) -> template_diff.TemplateChange:
    assert diff.total == 1, [(c.kind, c.node_kind, c.attribute, c.tier) for c in diff.changes]
    return diff.changes[0]


# --------------------------------------------------------------------------
# Baseline: identical trees
# --------------------------------------------------------------------------


def test_identical_snapshots_have_no_changes() -> None:
    snapshot = _snapshot(_entity(uuid4(), _field(uuid4()), _field(uuid4())))
    diff = diff_snapshots(snapshot, snapshot, fields_with_values=NO_VALUES)
    assert diff.total == 0
    assert diff.changes == ()


def test_fields_with_values_is_a_required_keyword_argument() -> None:
    """D3: no caller may silently under-warn by omitting the value set."""
    with pytest.raises(TypeError):
        diff_snapshots({}, {})  # type: ignore[call-arg]
    with pytest.raises(TypeError):
        diff_snapshots({}, {}, NO_VALUES)  # type: ignore[misc]


# --------------------------------------------------------------------------
# D4 exception — llm_template_instruction
# --------------------------------------------------------------------------


def test_instruction_added_is_one_semantic_change() -> None:
    entity = _entity(uuid4())
    base = _snapshot(entity)
    curr = _snapshot(entity, instruction="Read tables too.")

    change = _only(diff_snapshots(base, curr, fields_with_values=NO_VALUES))
    assert change.kind is ChangeKind.ADDED
    assert change.node_kind is NodeKind.TEMPLATE
    assert change.tier is ChangeTier.SEMANTIC
    assert change.attribute == "llm_template_instruction"
    assert change.before is None
    assert change.after == "Read tables too."
    assert change.node_id is None


def test_instruction_cleared_is_one_semantic_change() -> None:
    entity = _entity(uuid4())
    base = _snapshot(entity, instruction="Read tables too.")
    curr = _snapshot(entity)

    change = _only(diff_snapshots(base, curr, fields_with_values=NO_VALUES))
    assert change.kind is ChangeKind.REMOVED
    assert change.tier is ChangeTier.SEMANTIC
    assert change.before == "Read tables too."
    assert change.after is None


def test_instruction_changed_is_one_semantic_change() -> None:
    entity = _entity(uuid4())
    base = _snapshot(entity, instruction="Old.")
    curr = _snapshot(entity, instruction="New.")

    change = _only(diff_snapshots(base, curr, fields_with_values=NO_VALUES))
    assert change.kind is ChangeKind.MODIFIED
    assert change.tier is ChangeTier.SEMANTIC
    assert (change.before, change.after) == ("Old.", "New.")


def test_instruction_absent_null_and_blank_are_equivalent() -> None:
    entity = _entity(uuid4())
    absent = _snapshot(entity)
    blank = _snapshot(entity, instruction="   ")
    null = _snapshot(entity)
    null["llm_template_instruction"] = None

    assert diff_snapshots(absent, blank, fields_with_values=NO_VALUES).total == 0
    assert diff_snapshots(blank, null, fields_with_values=NO_VALUES).total == 0
    assert diff_snapshots(null, absent, fields_with_values=NO_VALUES).total == 0


def test_instruction_only_draft_counts_exactly_one_change() -> None:
    """The structural triggers never fire for an instruction edit (D4)."""
    entity = _entity(uuid4(), _field(uuid4()), _field(uuid4()))
    base = _snapshot(entity)
    curr = _snapshot(entity, instruction="Prefer the abstract.")

    assert diff_snapshots(base, curr, fields_with_values=NO_VALUES).total == 1


# --------------------------------------------------------------------------
# D4 — era fixtures (older baselines must not report phantom changes)
# --------------------------------------------------------------------------

_PRE_0038_KEYS = ("allows_not_applicable", "allows_not_evaluated")


def _modern_tree() -> tuple[UUID, UUID, dict[str, Any]]:
    """A live tree: one study section + the repeating model container."""
    section_id, field_id, container_id = uuid4(), uuid4(), uuid4()
    section = _entity(section_id, _field(field_id))
    container = _entity(
        container_id,
        _field(uuid4(), name="auc", label="AUC"),
        name="prediction_models",
        label="Prediction models",
        role="model_container",
        cardinality="many",
        entry_label="model",
    )
    return section_id, field_id, _snapshot(section, container)


def _rename_field(snapshot: dict[str, Any], field_id: UUID, label: str) -> dict[str, Any]:
    return {
        "entity_types": [
            dict(
                et,
                fields=[
                    dict(f, label=label) if f["id"] == str(field_id) else f for f in et["fields"]
                ],
            )
            for et in snapshot["entity_types"]
        ]
    }


def _pre_0038(snapshot: dict[str, Any]) -> dict[str, Any]:
    return {
        "entity_types": [_strip_from_fields(et, *_PRE_0038_KEYS) for et in snapshot["entity_types"]]
    }


def _pre_0051(snapshot: dict[str, Any]) -> dict[str, Any]:
    return {"entity_types": [_strip(et, "entry_label") for et in snapshot["entity_types"]]}


def test_pre_0038_baseline_diffs_clean_against_unedited_live_tree() -> None:
    _, _, live = _modern_tree()
    assert diff_snapshots(_pre_0038(live), live, fields_with_values=NO_VALUES).total == 0


def test_pre_0038_baseline_reports_exactly_the_one_rename() -> None:
    _, field_id, live = _modern_tree()
    edited = _rename_field(live, field_id, "Age (years)")

    change = _only(diff_snapshots(_pre_0038(live), edited, fields_with_values=NO_VALUES))
    assert (change.attribute, change.after) == ("label", "Age (years)")


def test_pre_0051_baseline_diffs_clean_against_unedited_live_tree() -> None:
    """``entry_label`` defaults to 'model' on a repeating group only (D4)."""
    _, _, live = _modern_tree()
    assert diff_snapshots(_pre_0051(live), live, fields_with_values=NO_VALUES).total == 0


def test_pre_0051_baseline_reports_exactly_the_one_rename() -> None:
    _, field_id, live = _modern_tree()
    edited = _rename_field(live, field_id, "Age (years)")

    change = _only(diff_snapshots(_pre_0051(live), edited, fields_with_values=NO_VALUES))
    assert change.attribute == "label"


def test_mixed_era_baseline_diffs_clean_against_unedited_live_tree() -> None:
    _, _, live = _modern_tree()
    mixed = {
        "entity_types": [
            _strip(_pre_0038(live)["entity_types"][0], "entry_label"),
            live["entity_types"][1],
        ]
    }
    assert diff_snapshots(mixed, live, fields_with_values=NO_VALUES).total == 0


def test_mixed_era_baseline_reports_exactly_the_one_rename() -> None:
    _, field_id, live = _modern_tree()
    mixed = {
        "entity_types": [
            _strip(_pre_0038(live)["entity_types"][0], "entry_label"),
            live["entity_types"][1],
        ]
    }
    edited = _rename_field(live, field_id, "Age (years)")
    assert diff_snapshots(mixed, edited, fields_with_values=NO_VALUES).total == 1


# --------------------------------------------------------------------------
# D1 — global field indexing: a cross-parent move is ONE change
# --------------------------------------------------------------------------


_SECTION_A_ID, _SECTION_B_ID = uuid4(), uuid4()
_KEPT_FIELD_ID, _MOVED_FIELD_ID, _OTHER_FIELD_ID = uuid4(), uuid4(), uuid4()


def _two_sections(*, moved_first: bool) -> dict[str, Any]:
    """Two sections; ``moved`` sits in the first or the second one."""
    section_a_fields = [_field(_KEPT_FIELD_ID, name="kept", label="Kept")]
    section_b_fields = [_field(_OTHER_FIELD_ID, name="other", label="Other")]
    target = _field(_MOVED_FIELD_ID, name="moved", label="Moved")
    (section_a_fields if moved_first else section_b_fields).append(target)
    return _snapshot(
        _entity(_SECTION_A_ID, *section_a_fields, name="a", label="Section A"),
        _entity(_SECTION_B_ID, *section_b_fields, name="b", label="Section B"),
    )


def test_cross_section_move_is_one_moved_change_when_no_values_exist() -> None:
    base, curr = _two_sections(moved_first=True), _two_sections(moved_first=False)

    change = _only(diff_snapshots(base, curr, fields_with_values=NO_VALUES))
    assert change.kind is ChangeKind.MOVED
    assert change.node_kind is NodeKind.FIELD
    assert change.node_id == _MOVED_FIELD_ID
    assert (change.before, change.after) == ("Section A", "Section B")
    # D2: a move can still re-key the completion gate, so it is never cosmetic.
    assert change.tier is ChangeTier.SEMANTIC


def test_cross_section_move_is_destructive_when_the_field_holds_values() -> None:
    base, curr = _two_sections(moved_first=True), _two_sections(moved_first=False)
    held = frozenset({_MOVED_FIELD_ID})

    change = _only(diff_snapshots(base, curr, fields_with_values=held))
    assert change.kind is ChangeKind.MOVED
    assert change.tier is ChangeTier.DESTRUCTIVE


def test_move_plus_whole_section_renumber_stays_one_change() -> None:
    """``planFieldMove`` renumbers whole sections — no reorder rows (D1)."""
    a_id, b_id = uuid4(), uuid4()
    first, moved, last, other = uuid4(), uuid4(), uuid4(), uuid4()
    base = _snapshot(
        _entity(
            a_id,
            _field(first, name="first", label="First"),
            _field(moved, name="moved", label="Moved"),
            _field(last, name="last", label="Last"),
            label="Section A",
        ),
        _entity(b_id, _field(other, name="other", label="Other"), label="Section B"),
    )
    curr = _snapshot(
        _entity(
            a_id,
            _field(first, name="first", label="First"),
            _field(last, name="last", label="Last"),
            label="Section A",
        ),
        _entity(
            b_id,
            _field(other, name="other", label="Other"),
            _field(moved, name="moved", label="Moved"),
            label="Section B",
        ),
    )

    change = _only(diff_snapshots(base, curr, fields_with_values=NO_VALUES))
    assert change.kind is ChangeKind.MOVED


# --------------------------------------------------------------------------
# D1 — reorder is derived from the relative sequence, not from sort_order
# --------------------------------------------------------------------------


def test_insert_in_the_middle_reports_only_the_addition() -> None:
    section_id, first, last, inserted = uuid4(), uuid4(), uuid4(), uuid4()
    base = _snapshot(_entity(section_id, _field(first), _field(last, name="last")))
    curr = _snapshot(
        _entity(
            section_id,
            _field(first),
            _field(inserted, name="inserted", label="Inserted"),
            _field(last, name="last"),
        )
    )

    change = _only(diff_snapshots(base, curr, fields_with_values=NO_VALUES))
    assert change.kind is ChangeKind.ADDED
    assert change.tier is ChangeTier.ADDITIVE


def test_delete_with_renumber_reports_only_the_deletion() -> None:
    section_id, first, gone, last = uuid4(), uuid4(), uuid4(), uuid4()
    base = _snapshot(
        _entity(
            section_id,
            _field(first),
            _field(gone, name="gone", label="Gone"),
            _field(last, name="last"),
        )
    )
    curr = _snapshot(_entity(section_id, _field(first), _field(last, name="last")))

    change = _only(diff_snapshots(base, curr, fields_with_values=NO_VALUES))
    assert change.kind is ChangeKind.REMOVED
    assert change.node_kind is NodeKind.FIELD
    assert change.tier is ChangeTier.DESTRUCTIVE
    assert change.node_id == gone


def test_true_sibling_swap_is_one_cosmetic_reorder() -> None:
    section_id, first, second = uuid4(), uuid4(), uuid4()
    base = _snapshot(
        _entity(section_id, _field(first), _field(second, name="second", label="Second"))
    )
    curr = _snapshot(
        _entity(section_id, _field(second, name="second", label="Second"), _field(first))
    )

    change = _only(diff_snapshots(base, curr, fields_with_values=NO_VALUES))
    assert change.kind is ChangeKind.REORDERED
    assert change.node_kind is NodeKind.ENTITY_TYPE
    assert change.node_id == section_id
    assert change.tier is ChangeTier.COSMETIC
    assert change.label_path == ("Participants",)


# --------------------------------------------------------------------------
# D1 — options (bare strings, legacy dict shape, no rename detection)
# --------------------------------------------------------------------------


def _select(field_id: UUID, allowed: Any) -> dict[str, Any]:
    return _field(field_id, field_type="select", allowed_values=allowed)


def test_dict_shaped_legacy_options_match_the_bare_list() -> None:
    section_id, field_id = uuid4(), uuid4()
    base = _snapshot(_entity(section_id, _select(field_id, {"options": ["yes", "no"]})))
    curr = _snapshot(_entity(section_id, _select(field_id, ["yes", "no"])))

    assert diff_snapshots(base, curr, fields_with_values=NO_VALUES).total == 0


def test_dict_shaped_value_label_options_match_the_bare_codes() -> None:
    section_id, field_id = uuid4(), uuid4()
    legacy = {"options": [{"value": "yes", "label": "Yes"}, {"value": "no", "label": "No"}]}
    base = _snapshot(_entity(section_id, _select(field_id, legacy)))
    curr = _snapshot(_entity(section_id, _select(field_id, ["yes", "no"])))

    assert diff_snapshots(base, curr, fields_with_values=NO_VALUES).total == 0


def test_removed_option_is_destructive() -> None:
    section_id, field_id = uuid4(), uuid4()
    base = _snapshot(_entity(section_id, _select(field_id, ["yes", "no", "unclear"])))
    curr = _snapshot(_entity(section_id, _select(field_id, ["yes", "no"])))

    change = _only(diff_snapshots(base, curr, fields_with_values=NO_VALUES))
    assert change.tier is ChangeTier.DESTRUCTIVE
    assert change.attribute == "allowed_values"
    assert (change.before, change.after) == ("unclear", None)


def test_added_option_is_additive() -> None:
    section_id, field_id = uuid4(), uuid4()
    base = _snapshot(_entity(section_id, _select(field_id, ["yes", "no"])))
    curr = _snapshot(_entity(section_id, _select(field_id, ["yes", "no", "unclear"])))

    change = _only(diff_snapshots(base, curr, fields_with_values=NO_VALUES))
    assert change.tier is ChangeTier.ADDITIVE
    assert (change.before, change.after) == (None, "unclear")


def test_reordered_options_are_one_cosmetic_change_for_the_field() -> None:
    section_id, field_id = uuid4(), uuid4()
    base = _snapshot(_entity(section_id, _select(field_id, ["yes", "no", "unclear"])))
    curr = _snapshot(_entity(section_id, _select(field_id, ["unclear", "yes", "no"])))

    change = _only(diff_snapshots(base, curr, fields_with_values=NO_VALUES))
    assert change.kind is ChangeKind.REORDERED
    assert change.node_kind is NodeKind.FIELD
    assert change.attribute == "allowed_values"
    assert change.tier is ChangeTier.COSMETIC


# --------------------------------------------------------------------------
# D2 — tier map
# --------------------------------------------------------------------------


def test_new_required_field_is_semantic_not_additive() -> None:
    section_id, existing, added = uuid4(), uuid4(), uuid4()
    base = _snapshot(_entity(section_id, _field(existing)))
    curr = _snapshot(
        _entity(section_id, _field(existing), _field(added, name="new", is_required=True))
    )

    change = _only(diff_snapshots(base, curr, fields_with_values=NO_VALUES))
    assert change.kind is ChangeKind.ADDED
    assert change.tier is ChangeTier.SEMANTIC


def test_new_optional_field_is_additive() -> None:
    section_id, existing, added = uuid4(), uuid4(), uuid4()
    base = _snapshot(_entity(section_id, _field(existing)))
    curr = _snapshot(_entity(section_id, _field(existing), _field(added, name="new")))

    assert _only(diff_snapshots(base, curr, fields_with_values=NO_VALUES)).tier is (
        ChangeTier.ADDITIVE
    )


def test_allow_other_turned_off_is_destructive() -> None:
    section_id, field_id = uuid4(), uuid4()
    base = _snapshot(_entity(section_id, _field(field_id, allow_other=True)))
    curr = _snapshot(_entity(section_id, _field(field_id, allow_other=False)))

    change = _only(diff_snapshots(base, curr, fields_with_values=NO_VALUES))
    assert change.attribute == "allow_other"
    assert change.tier is ChangeTier.DESTRUCTIVE


def test_allow_other_turned_on_is_semantic() -> None:
    section_id, field_id = uuid4(), uuid4()
    base = _snapshot(_entity(section_id, _field(field_id, allow_other=False)))
    curr = _snapshot(_entity(section_id, _field(field_id, allow_other=True)))

    assert _only(diff_snapshots(base, curr, fields_with_values=NO_VALUES)).tier is (
        ChangeTier.SEMANTIC
    )


def test_field_type_change_is_semantic_without_recorded_values() -> None:
    section_id, field_id = uuid4(), uuid4()
    base = _snapshot(_entity(section_id, _field(field_id, field_type="text")))
    curr = _snapshot(_entity(section_id, _field(field_id, field_type="number")))

    change = _only(diff_snapshots(base, curr, fields_with_values=NO_VALUES))
    assert change.attribute == "field_type"
    assert change.tier is ChangeTier.SEMANTIC


def test_field_type_change_is_destructive_with_recorded_values() -> None:
    section_id, field_id = uuid4(), uuid4()
    base = _snapshot(_entity(section_id, _field(field_id, field_type="text")))
    curr = _snapshot(_entity(section_id, _field(field_id, field_type="number")))

    change = _only(diff_snapshots(base, curr, fields_with_values=frozenset({field_id})))
    assert change.tier is ChangeTier.DESTRUCTIVE


def test_field_label_rename_is_cosmetic_and_carries_the_label_path() -> None:
    section_id, field_id = uuid4(), uuid4()
    base = _snapshot(_entity(section_id, _field(field_id)))
    curr = _snapshot(_entity(section_id, _field(field_id, label="Age (years)")))

    change = _only(diff_snapshots(base, curr, fields_with_values=NO_VALUES))
    assert change.kind is ChangeKind.MODIFIED
    assert change.tier is ChangeTier.COSMETIC
    assert change.label_path == ("Participants", "Age (years)")
    assert change.label == "Participants → Age (years)"
    assert change.node_id == field_id


def test_field_name_change_is_semantic() -> None:
    section_id, field_id = uuid4(), uuid4()
    base = _snapshot(_entity(section_id, _field(field_id, name="age")))
    curr = _snapshot(_entity(section_id, _field(field_id, name="age_years")))

    assert _only(diff_snapshots(base, curr, fields_with_values=NO_VALUES)).tier is (
        ChangeTier.SEMANTIC
    )


def test_entry_label_change_is_semantic() -> None:
    """B-8 made ``entry_label`` the export record stem — never cosmetic."""
    container_id = uuid4()
    base = _snapshot(_entity(container_id, role="model_container", entry_label="model"))
    curr = _snapshot(_entity(container_id, role="model_container", entry_label="algorithm"))

    change = _only(diff_snapshots(base, curr, fields_with_values=NO_VALUES))
    assert change.node_kind is NodeKind.ENTITY_TYPE
    assert change.attribute == "entry_label"
    assert change.tier is ChangeTier.SEMANTIC


def test_section_label_rename_is_cosmetic() -> None:
    section_id = uuid4()
    base = _snapshot(_entity(section_id, label="Participants"))
    curr = _snapshot(_entity(section_id, label="Population"))

    change = _only(diff_snapshots(base, curr, fields_with_values=NO_VALUES))
    assert change.tier is ChangeTier.COSMETIC
    assert change.label_path == ("Population",)


def test_removed_section_absorbs_its_fields_into_one_destructive_change() -> None:
    kept_id, gone_id = uuid4(), uuid4()
    kept = _entity(kept_id, _field(uuid4()), label="Kept")
    base = _snapshot(
        kept,
        _entity(gone_id, _field(uuid4()), _field(uuid4()), label="Gone"),
    )
    curr = _snapshot(kept)

    change = _only(diff_snapshots(base, curr, fields_with_values=NO_VALUES))
    assert change.kind is ChangeKind.REMOVED
    assert change.node_kind is NodeKind.ENTITY_TYPE
    assert change.node_id == gone_id
    assert change.tier is ChangeTier.DESTRUCTIVE


def test_added_section_with_a_required_field_is_one_semantic_change() -> None:
    kept_id, new_id = uuid4(), uuid4()
    kept = _entity(kept_id, _field(uuid4()), label="Kept")
    base = _snapshot(kept)
    curr = _snapshot(
        kept,
        _entity(new_id, _field(uuid4(), is_required=True), _field(uuid4()), label="New"),
    )

    change = _only(diff_snapshots(base, curr, fields_with_values=NO_VALUES))
    assert change.kind is ChangeKind.ADDED
    assert change.node_kind is NodeKind.ENTITY_TYPE
    assert change.tier is ChangeTier.SEMANTIC


def test_added_section_without_required_fields_is_one_additive_change() -> None:
    kept_id, new_id = uuid4(), uuid4()
    kept = _entity(kept_id, _field(uuid4()), label="Kept")
    base = _snapshot(kept)
    curr = _snapshot(kept, _entity(new_id, _field(uuid4()), label="New"))

    assert _only(diff_snapshots(base, curr, fields_with_values=NO_VALUES)).tier is (
        ChangeTier.ADDITIVE
    )


# --------------------------------------------------------------------------
# TemplateDiff surface
# --------------------------------------------------------------------------


def test_diff_exposes_total_and_per_tier_buckets() -> None:
    section_id, renamed, removed, added = uuid4(), uuid4(), uuid4(), uuid4()
    base = _snapshot(_entity(section_id, _field(renamed), _field(removed, name="removed")))
    curr = _snapshot(
        _entity(
            section_id,
            _field(renamed, label="Age (years)"),
            _field(added, name="added"),
        )
    )

    diff = diff_snapshots(base, curr, fields_with_values=NO_VALUES)
    assert diff.total == len(diff.changes) == 3
    assert set(diff.by_tier) == set(ChangeTier)
    assert len(diff.by_tier[ChangeTier.COSMETIC]) == 1
    assert len(diff.by_tier[ChangeTier.ADDITIVE]) == 1
    assert len(diff.by_tier[ChangeTier.DESTRUCTIVE]) == 1
    assert diff.by_tier[ChangeTier.SEMANTIC] == ()


# --------------------------------------------------------------------------
# Guard — the tier map must stay exhaustive over SNAPSHOT_SQL
# --------------------------------------------------------------------------


def _snapshot_sql_keys() -> set[str]:
    """Keys ``SNAPSHOT_SQL`` builds for an entity-type / field object.

    Column-bound keys are ``'<key>', et.<col>`` / ``'<key>', f.<col>``;
    ``fields`` is the only COALESCE-bound node key (``entity_types`` is the
    snapshot root, not a node attribute).
    """
    return set(re.findall(r"'(\w+)',\s*(?:et|f)\.", str(SNAPSHOT_SQL))) | {"fields"}


def test_snapshot_key_regex_still_matches_the_builder() -> None:
    """Guards the guard: a silent regex miss must not vacuously pass."""
    keys = _snapshot_sql_keys()
    assert {"id", "entry_label", "allowed_values", "allows_not_evaluated"} <= keys
    assert "entity_types" not in keys


def test_tier_map_is_exhaustive_over_the_snapshot_key_set() -> None:
    """A new SNAPSHOT_SQL key must fail here, not default silently (D2)."""
    covered = (
        set(template_diff.ENTITY_ATTRIBUTE_DEFAULTS)
        | set(template_diff.FIELD_ATTRIBUTE_DEFAULTS)
        | {template_diff.OPTION_KEY}
        # Structural keys carry nesting/identity, never an attribute change.
        | {template_diff.IDENTITY_KEY, template_diff.ORDER_KEY, template_diff.NESTING_KEY}
    )
    assert covered == _snapshot_sql_keys()
    assert set(template_diff.ATTRIBUTE_TIERS) == (
        set(template_diff.ENTITY_ATTRIBUTE_DEFAULTS) | set(template_diff.FIELD_ATTRIBUTE_DEFAULTS)
    )
