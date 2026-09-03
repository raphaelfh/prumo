"""Unit tests for the template-diff read model (B-9b2a, T1).

Pure: hand-built snapshot dicts go through ``diff_snapshots`` and the
resulting ``TemplateChange`` stream is turned into wire rows — no DB, no
HTTP. The snapshot builders are shared with the sibling ``test_template_diff``
module, whose ``_snapshot_sql_keys()`` drift guard is what keeps them honest
against ``SNAPSHOT_SQL``.
"""

from __future__ import annotations

import re
from collections.abc import Callable
from typing import Any
from uuid import UUID, uuid4

import pytest

from app.domain.template_change import ChangeTier, ChangeVariant, DiffStatus, OpaqueValueState
from app.schemas.hitl_session import (
    TemplateChangeRowRead,
    TemplateConfigDiffBuckets,
    TemplateConfigDiffRead,
)
from app.services import template_diff, template_diff_read
from app.services.template_diff import (
    ChangeKind,
    NodeKind,
    TemplateDiff,
    diff_snapshots,
)
from app.services.template_diff_read import (
    VARIANT_BY_KIND,
    with_recorded_data,
)
from tests.unit.helpers.snapshot_builders import entity_node as _entity
from tests.unit.helpers.snapshot_builders import field_node as _field
from tests.unit.helpers.snapshot_builders import snapshot as _snapshot

NO_VALUES: frozenset[UUID] = frozenset()
NO_CHILDREN: dict[UUID, frozenset[UUID]] = {}


def _select(field_id: UUID, allowed: Any, **over: Any) -> dict[str, Any]:
    return _field(field_id, field_type="select", allowed_values=allowed, **over)


def _rows(baseline: dict[str, Any], current: dict[str, Any]) -> tuple[TemplateChangeRowRead, ...]:
    diff: TemplateDiff = diff_snapshots(baseline, current, fields_with_values=NO_VALUES)
    return with_recorded_data(diff.changes, {}, frozenset())


def _only(rows: tuple[TemplateChangeRowRead, ...]) -> TemplateChangeRowRead:
    assert len(rows) == 1, [row.id for row in rows]
    return rows[0]


# --------------------------------------------------------------------------
# D2 — the composite id
# --------------------------------------------------------------------------


def test_row_id_is_kind_node_kind_id_attribute_and_option_code() -> None:
    section_id, field_id = uuid4(), uuid4()
    base = _snapshot(_entity(section_id, _field(field_id)))
    curr = _snapshot(_entity(section_id, _field(field_id, label="Age (years)")))

    row = _only(_rows(base, curr))
    assert row.id == f"modified:field:{field_id}:label:-"


def test_row_id_leaves_the_option_slot_empty_when_no_option_is_involved() -> None:
    section_id = uuid4()
    base = _snapshot(_entity(section_id, label="Participants"))
    curr = _snapshot(_entity(section_id, label="Population"))

    assert _only(_rows(base, curr)).id == f"modified:entity_type:{section_id}:label:-"


def test_instruction_row_id_uses_the_reserved_template_node_id() -> None:
    """The instruction change carries no node id at all (``template_diff:345``)."""
    entity = _entity(uuid4())
    base, curr = _snapshot(entity), _snapshot(entity, instruction="Read tables too.")

    row = _only(_rows(base, curr))
    assert row.id == "added:template:template:llm_template_instruction:-"


def test_two_option_removals_on_one_field_get_distinct_ids() -> None:
    section_id, field_id = uuid4(), uuid4()
    base = _snapshot(_entity(section_id, _select(field_id, ["yes", "no", "unclear"])))
    curr = _snapshot(_entity(section_id, _select(field_id, ["yes"])))

    rows = _rows(base, curr)
    assert {row.id for row in rows} == {
        f"modified:field:{field_id}:allowed_values:no",
        f"modified:field:{field_id}:allowed_values:unclear",
    }


def test_two_fields_losing_the_same_option_code_get_distinct_ids() -> None:
    section_id, first_id, second_id = uuid4(), uuid4(), uuid4()
    base = _snapshot(
        _entity(
            section_id,
            _select(first_id, ["yes", "no"]),
            _select(second_id, ["yes", "no"], name="risk", label="Risk"),
        )
    )
    curr = _snapshot(
        _entity(
            section_id,
            _select(first_id, ["yes"]),
            _select(second_id, ["yes"], name="risk", label="Risk"),
        )
    )

    rows = _rows(base, curr)
    assert {row.id for row in rows} == {
        f"modified:field:{first_id}:allowed_values:no",
        f"modified:field:{second_id}:allowed_values:no",
    }


def test_an_options_reorder_never_borrows_the_option_slot_for_its_count() -> None:
    """``after`` is the sibling count there, not a code (``template_diff:587``)."""
    section_id, field_id = uuid4(), uuid4()
    base = _snapshot(_entity(section_id, _select(field_id, ["yes", "no", "unclear"])))
    curr = _snapshot(_entity(section_id, _select(field_id, ["unclear", "yes", "no"])))

    row = _only(_rows(base, curr))
    assert row.id == f"reordered:field:{field_id}:allowed_values:-"


def test_junk_node_id_stays_greppable_in_the_row_id() -> None:
    """``_as_uuid`` swallows the parse error; the raw string still keys the row."""
    junk = _entity(uuid4(), label="Junk")
    junk["id"] = "not-a-uuid"
    base, curr = _snapshot(junk), _snapshot(dict(junk, label="Junk renamed"))

    assert _only(_rows(base, curr)).id == "modified:entity_type:not-a-uuid:label:-"


def test_absent_node_id_stringifies_the_way_the_index_keyed_it() -> None:
    """``_index`` keys an id-less node by ``str(None)`` (``template_diff:273``)."""
    anonymous = _entity(uuid4(), label="Anon")
    del anonymous["id"]
    base, curr = _snapshot(anonymous), _snapshot(dict(anonymous, label="Anon renamed"))

    assert _only(_rows(base, curr)).id == "modified:entity_type:None:label:-"


def test_every_row_of_a_wide_diff_has_a_unique_id() -> None:
    """One diff touching every emission site at once."""
    kept_id, gone_id, new_id, moved_to_id = uuid4(), uuid4(), uuid4(), uuid4()
    renamed_id, removed_id, added_id, moved_id, option_id = (
        uuid4(),
        uuid4(),
        uuid4(),
        uuid4(),
        uuid4(),
    )
    swapped_a, swapped_b = uuid4(), uuid4()

    base = _snapshot(
        _entity(
            kept_id,
            _field(renamed_id, name="renamed"),
            _field(removed_id, name="removed"),
            _field(moved_id, name="moved"),
            _select(option_id, ["yes", "no", "unclear"], name="opt"),
            _field(swapped_a, name="swapped_a"),
            _field(swapped_b, name="swapped_b"),
            label="Kept",
        ),
        _entity(gone_id, _field(uuid4()), label="Gone"),
        _entity(moved_to_id, label="Destination"),
        instruction="Old.",
    )
    curr = _snapshot(
        _entity(
            kept_id,
            _field(renamed_id, name="renamed", label="Renamed"),
            _select(option_id, ["no", "yes", "later"], name="opt"),
            _field(swapped_b, name="swapped_b"),
            _field(swapped_a, name="swapped_a"),
            _field(added_id, name="added"),
            label="Kept renamed",
        ),
        _entity(moved_to_id, _field(moved_id, name="moved"), label="Destination"),
        _entity(new_id, _field(uuid4()), label="New"),
        instruction="New.",
    )

    rows = _rows(base, curr)
    assert len(rows) >= 10, [row.id for row in rows]
    assert len({row.id for row in rows}) == len(rows), sorted(row.id for row in rows)


def test_row_ids_are_stable_when_the_snapshot_key_order_flips() -> None:
    """Recomputation in the opposite dict order must mint identical ids.

    An ordinal-suffixed id (``…:1``, ``…:2``) passes every other test here
    and fails this one, which is the only reason it exists.
    """
    a_id, b_id = uuid4(), uuid4()
    a_renamed, a_added, b_renamed, b_added = uuid4(), uuid4(), uuid4(), uuid4()

    base_a = _entity(a_id, _field(a_renamed, name="a1"), label="A")
    base_b = _entity(b_id, _field(b_renamed, name="b1"), label="B")
    curr_a = _entity(
        a_id, _field(a_renamed, name="a1", label="A1"), _field(a_added, name="a2"), label="A"
    )
    curr_b = _entity(
        b_id, _field(b_renamed, name="b1", label="B1"), _field(b_added, name="b2"), label="B"
    )

    forward = _rows(_snapshot(base_a, base_b), _snapshot(curr_a, curr_b))
    reverse = _rows(_snapshot(base_b, base_a), _snapshot(curr_b, curr_a))

    assert len(forward) == len(reverse) == 4
    assert {row.id for row in forward} == {row.id for row in reverse}
    # Guards the guard: a vacuous pass if the emission order had not flipped.
    assert [row.id for row in forward] != [row.id for row in reverse]


# --------------------------------------------------------------------------
# D1 — one scenario per reachable variant, reused by the exhaustiveness guard
# --------------------------------------------------------------------------

_Pair = tuple[dict[str, Any], dict[str, Any]]


def _instruction_added() -> _Pair:
    entity = _entity(uuid4())
    return _snapshot(entity), _snapshot(entity, instruction="Read tables too.")


def _instruction_removed() -> _Pair:
    entity = _entity(uuid4())
    return _snapshot(entity, instruction="Read tables too."), _snapshot(entity)


def _instruction_modified() -> _Pair:
    entity = _entity(uuid4())
    return _snapshot(entity, instruction="Old."), _snapshot(entity, instruction="New.")


def _entity_type_added() -> _Pair:
    kept = _entity(uuid4(), _field(uuid4()), label="Kept")
    return _snapshot(kept), _snapshot(kept, _entity(uuid4(), _field(uuid4()), label="New"))


def _entity_type_removed() -> _Pair:
    kept = _entity(uuid4(), _field(uuid4()), label="Kept")
    return _snapshot(kept, _entity(uuid4(), _field(uuid4()), label="Gone")), _snapshot(kept)


def _entity_type_modified() -> _Pair:
    section_id = uuid4()
    return (
        _snapshot(_entity(section_id, label="Participants")),
        _snapshot(_entity(section_id, label="Population")),
    )


def _entity_type_reordered() -> _Pair:
    section_id = uuid4()
    first = _field(uuid4(), name="first", label="First")
    second = _field(uuid4(), name="second", label="Second")
    return (
        _snapshot(_entity(section_id, first, second)),
        _snapshot(_entity(section_id, second, first)),
    )


def _field_added() -> _Pair:
    section_id, kept_id, added_id = uuid4(), uuid4(), uuid4()
    return (
        _snapshot(_entity(section_id, _field(kept_id))),
        _snapshot(_entity(section_id, _field(kept_id), _field(added_id, name="new", label="New"))),
    )


def _field_removed() -> _Pair:
    section_id, kept_id, gone_id = uuid4(), uuid4(), uuid4()
    return (
        _snapshot(_entity(section_id, _field(kept_id), _field(gone_id, name="gone", label="Gone"))),
        _snapshot(_entity(section_id, _field(kept_id))),
    )


def _field_moved() -> _Pair:
    a_id, b_id, moved_id = uuid4(), uuid4(), uuid4()
    moved = _field(moved_id, name="moved", label="Moved")
    return (
        _snapshot(
            _entity(a_id, moved, name="a", label="Section A"),
            _entity(b_id, name="b", label="Section B"),
        ),
        _snapshot(
            _entity(a_id, name="a", label="Section A"),
            _entity(b_id, moved, name="b", label="Section B"),
        ),
    )


def _field_modified() -> _Pair:
    section_id, field_id = uuid4(), uuid4()
    return (
        _snapshot(_entity(section_id, _field(field_id))),
        _snapshot(_entity(section_id, _field(field_id, label="Age (years)"))),
    )


def _field_option_added() -> _Pair:
    section_id, field_id = uuid4(), uuid4()
    return (
        _snapshot(_entity(section_id, _select(field_id, ["yes", "no"]))),
        _snapshot(_entity(section_id, _select(field_id, ["yes", "no", "unclear"]))),
    )


def _field_option_removed() -> _Pair:
    section_id, field_id = uuid4(), uuid4()
    return (
        _snapshot(_entity(section_id, _select(field_id, ["yes", "no", "unclear"]))),
        _snapshot(_entity(section_id, _select(field_id, ["yes", "no"]))),
    )


def _field_options_reordered() -> _Pair:
    section_id, field_id = uuid4(), uuid4()
    return (
        _snapshot(_entity(section_id, _select(field_id, ["yes", "no", "unclear"]))),
        _snapshot(_entity(section_id, _select(field_id, ["unclear", "yes", "no"]))),
    )


#: One renderer-facing expectation per reachable variant:
#: ``(scenario, variant, before, after, attribute, reorder_count, label_path, tier)``.
#: Every row is pinned in full, so the columns document what ``before``/``after``
#: mean per variant — and pin that a reorder's sibling COUNT never squats in
#: ``after``. The asymmetry between the two reorder variants is deliberate and
#: visible here: only the options reorder names an attribute.
_RENDERER_CASES: tuple[
    tuple[
        Callable[[], _Pair],
        ChangeVariant,
        str | bool | None,
        str | bool | None,
        str | None,
        int | None,
        list[str],
        ChangeTier,
    ],
    ...,
] = (
    (
        _instruction_added,
        ChangeVariant.TEMPLATE_INSTRUCTION_ADDED,
        None,
        "Read tables too.",
        "llm_template_instruction",
        None,
        [],
        ChangeTier.SEMANTIC,
    ),
    (
        _instruction_removed,
        ChangeVariant.TEMPLATE_INSTRUCTION_REMOVED,
        "Read tables too.",
        None,
        "llm_template_instruction",
        None,
        [],
        ChangeTier.SEMANTIC,
    ),
    (
        _instruction_modified,
        ChangeVariant.TEMPLATE_INSTRUCTION_MODIFIED,
        "Old.",
        "New.",
        "llm_template_instruction",
        None,
        [],
        ChangeTier.SEMANTIC,
    ),
    (
        _entity_type_added,
        ChangeVariant.ENTITY_TYPE_ADDED,
        None,
        None,
        None,
        None,
        ["New"],
        ChangeTier.ADDITIVE,
    ),
    (
        _entity_type_removed,
        ChangeVariant.ENTITY_TYPE_REMOVED,
        None,
        None,
        None,
        None,
        ["Gone"],
        ChangeTier.DESTRUCTIVE,
    ),
    (
        _entity_type_modified,
        ChangeVariant.ENTITY_TYPE_MODIFIED,
        "Participants",
        "Population",
        "label",
        None,
        ["Population"],
        ChangeTier.COSMETIC,
    ),
    (
        _entity_type_reordered,
        ChangeVariant.ENTITY_TYPE_FIELDS_REORDERED,
        None,
        None,
        None,
        2,
        ["Participants"],
        ChangeTier.COSMETIC,
    ),
    (
        _field_added,
        ChangeVariant.FIELD_ADDED,
        None,
        None,
        None,
        None,
        ["Participants", "New"],
        ChangeTier.ADDITIVE,
    ),
    (
        _field_removed,
        ChangeVariant.FIELD_REMOVED,
        None,
        None,
        None,
        None,
        ["Participants", "Gone"],
        ChangeTier.DESTRUCTIVE,
    ),
    (
        _field_moved,
        ChangeVariant.FIELD_MOVED,
        "Section A",
        "Section B",
        None,
        None,
        ["Section B", "Moved"],
        ChangeTier.SEMANTIC,
    ),
    (
        _field_modified,
        ChangeVariant.FIELD_MODIFIED,
        "Age",
        "Age (years)",
        "label",
        None,
        ["Participants", "Age (years)"],
        ChangeTier.COSMETIC,
    ),
    (
        _field_option_added,
        ChangeVariant.FIELD_OPTION_ADDED,
        None,
        "unclear",
        "allowed_values",
        None,
        ["Participants", "Age"],
        ChangeTier.ADDITIVE,
    ),
    (
        _field_option_removed,
        ChangeVariant.FIELD_OPTION_REMOVED,
        "unclear",
        None,
        "allowed_values",
        None,
        ["Participants", "Age"],
        ChangeTier.DESTRUCTIVE,
    ),
    (
        _field_options_reordered,
        ChangeVariant.FIELD_OPTIONS_REORDERED,
        None,
        None,
        "allowed_values",
        3,
        ["Participants", "Age"],
        ChangeTier.COSMETIC,
    ),
)

_SCENARIOS = tuple(case[0] for case in _RENDERER_CASES)


def _one_row(scenario: Callable[[], _Pair]) -> TemplateChangeRowRead:
    return _only(_rows(*scenario()))


# --------------------------------------------------------------------------
# D1 — exhaustiveness
# --------------------------------------------------------------------------

#: ``(kind, node_kind)`` pairs the engine provably never constructs: no write
#: path re-parents an entity type, and the template node has a single
#: instruction attribute with no children to reorder.
#:
#: This is an assumption pinned by test, not something CI verifies against the
#: engine: if a future write path ever made the engine emit one of these
#: pairs, no test here would fail. The runtime guard is
#: :func:`~app.services.template_diff_read._variant_of` raising ``KeyError``
#: on the ``VARIANT_BY_KIND`` lookup at request time, not this set.
_UNREACHABLE_KIND_PAIRS = frozenset(
    {
        (ChangeKind.MOVED, NodeKind.TEMPLATE),
        (ChangeKind.MOVED, NodeKind.ENTITY_TYPE),
        (ChangeKind.REORDERED, NodeKind.TEMPLATE),
    }
)


def test_variant_map_is_exhaustive_over_the_reachable_kind_pairs() -> None:
    """A new ``ChangeKind`` or ``NodeKind`` must fail here, not default silently.

    Bounded claim: this catches a new *pair*, not a future sub-split inside an
    existing one — the way ``_diff_options`` already splits
    ``(MODIFIED, FIELD, allowed_values)`` by polarity. That split stays covered
    by the per-variant cases below.
    """
    every_pair = {(kind, node_kind) for kind in ChangeKind for node_kind in NodeKind}
    assert set(VARIANT_BY_KIND) == every_pair - _UNREACHABLE_KIND_PAIRS


def test_no_variant_exists_outside_the_map_and_the_option_split() -> None:
    assert set(VARIANT_BY_KIND.values()) | {
        ChangeVariant.FIELD_OPTION_ADDED,
        ChangeVariant.FIELD_OPTION_REMOVED,
    } == set(ChangeVariant)
    assert len(ChangeVariant) == 14


def test_every_variant_is_reachable_from_a_real_diff() -> None:
    """No variant may be decorative: each one comes out of an actual diff."""
    produced = {row.variant for scenario in _SCENARIOS for row in _rows(*scenario())}
    assert produced == set(ChangeVariant)


# --------------------------------------------------------------------------
# One renderer-facing case per variant: before/after mean the same thing in
# every row, and a count never squats in ``after``.
# --------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("scenario", "variant", "before", "after", "attribute", "reorder_count", "label_path", "tier"),
    _RENDERER_CASES,
    ids=[case[1].value for case in _RENDERER_CASES],
)
def test_each_variant_ships_its_own_renderer_facing_shape(
    scenario: Callable[[], _Pair],
    variant: ChangeVariant,
    before: str | bool | None,
    after: str | bool | None,
    attribute: str | None,
    reorder_count: int | None,
    label_path: list[str],
    tier: ChangeTier,
) -> None:
    """Every reachable variant, pinned in full.

    ``before``/``after`` must mean the same thing in every row, so a reorder's
    sibling count lives in ``reorder_count`` and never squats in ``after``.
    The two reorder rows also pin their asymmetry: only the options reorder
    names the attribute it reordered.
    """
    row = _one_row(scenario)

    assert row.variant is variant
    assert (row.before, row.after) == (before, after)
    assert (row.attribute, row.reorder_count) == (attribute, reorder_count)
    assert (row.label_path, row.tier) == (label_path, tier)


# --------------------------------------------------------------------------
# D3 — only the opaque attributes render server-side
# --------------------------------------------------------------------------


def test_boolean_attributes_ship_typed_for_the_copy_layer() -> None:
    """Rendering these here would fork the i18n boundary (D3)."""
    section_id, field_id = uuid4(), uuid4()
    base = _snapshot(_entity(section_id, _field(field_id, is_required=False)))
    curr = _snapshot(_entity(section_id, _field(field_id, is_required=True)))

    row = _only(_rows(base, curr))
    assert row.attribute == "is_required"
    assert row.before is False
    assert row.after is True


def test_validation_schema_ships_a_summary_not_the_blob() -> None:
    section_id, field_id = uuid4(), uuid4()
    base = _snapshot(_entity(section_id, _field(field_id, validation_schema={})))
    curr = _snapshot(
        _entity(section_id, _field(field_id, validation_schema={"maximum": 120, "minimum": 0}))
    )

    row = _only(_rows(base, curr))
    assert row.attribute == "validation_schema"
    # A present-but-empty {} is not the same state as an absent (None) value,
    # so it reports a typed EMPTY rather than collapsing to None.
    assert (row.before, row.before_opaque_state) == (None, OpaqueValueState.EMPTY)
    assert (row.after, row.after_opaque_state) == ("maximum, minimum", None)


def test_emptiness_is_decided_on_the_container_not_the_joined_string() -> None:
    """A stored key that reads like the marker is still real content.

    ``", ".join(...) or EMPTY`` would call a ``validation_schema`` whose only
    key is ``""`` empty, and would do the same to ``allowed_units == [""]``.
    """
    section_id, first_id, second_id = uuid4(), uuid4(), uuid4()
    base = _snapshot(
        _entity(
            section_id,
            _field(first_id, validation_schema={}, allowed_units=[]),
            _field(second_id, name="mass", label="Mass", validation_schema={}, allowed_units=[]),
        )
    )
    curr = _snapshot(
        _entity(
            section_id,
            _field(first_id, validation_schema={"": 1}, allowed_units=[]),
            _field(second_id, name="mass", label="Mass", validation_schema={}, allowed_units=[""]),
        )
    )

    rows = {row.attribute: row for row in _rows(base, curr)}
    assert (rows["validation_schema"].before, rows["validation_schema"].after) == (None, "")
    assert rows["validation_schema"].before_opaque_state is OpaqueValueState.EMPTY
    assert rows["validation_schema"].after_opaque_state is None
    assert (rows["allowed_units"].before, rows["allowed_units"].after) == (None, "")
    assert rows["allowed_units"].before_opaque_state is OpaqueValueState.EMPTY
    assert rows["allowed_units"].after_opaque_state is None


def test_allowed_units_ships_the_unit_list_as_one_string() -> None:
    section_id, field_id = uuid4(), uuid4()
    base = _snapshot(_entity(section_id, _field(field_id, allowed_units=None)))
    curr = _snapshot(_entity(section_id, _field(field_id, allowed_units=["kg", "lb"])))

    row = _only(_rows(base, curr))
    assert (row.before, row.after) == (None, "kg, lb")
    assert (row.before_opaque_state, row.after_opaque_state) == (None, None)


def test_parent_entity_type_id_never_puts_an_id_on_the_wire() -> None:
    """An id has no listable content, so it ships as typed state only — the
    copy layer writes the word, and no server-authored English crosses."""
    section_id, parent_id = uuid4(), uuid4()
    base = _snapshot(_entity(section_id))
    curr = _snapshot(_entity(section_id, parent_entity_type_id=str(parent_id)))

    row = _only(_rows(base, curr))
    assert row.attribute == "parent_entity_type_id"
    assert (row.before, row.after) == (None, None)
    assert (row.before_opaque_state, row.after_opaque_state) == (
        None,
        OpaqueValueState.PRESENT,
    )
    assert str(parent_id) not in row.id


def test_a_scalar_attribute_holding_a_stored_blob_is_summarized_not_shipped() -> None:
    """The baseline is raw stored JSONB: its values are not type-checked.

    ``unit`` is in the scalar arm, so a dict there is off-contract — the row
    must still narrow it rather than hand a blob to the client.
    """
    section_id, field_id = uuid4(), uuid4()
    base = _snapshot(_entity(section_id, _field(field_id, unit={"legacy": "kg"})))
    curr = _snapshot(_entity(section_id, _field(field_id, unit="kg")))

    row = _only(_rows(base, curr))
    assert (row.before, row.after) == ("legacy", "kg")


# --------------------------------------------------------------------------
# Guards — the wire types, and the attribute partition behind them
# --------------------------------------------------------------------------

#: The complement of ``template_diff_read.OPAQUE_ATTRIBUTES``: attributes that
#: ship typed for the copy layer to render. Listed literally rather than
#: derived, so adding a snapshot key to ``ENTITY_ATTRIBUTE_DEFAULTS`` /
#: ``FIELD_ATTRIBUTE_DEFAULTS`` breaks the partition test below instead of
#: silently defaulting into the scalar arm. Lives here rather than in app code
#: because the partition assertion is its only reader.
_SCALAR_ATTRIBUTES = frozenset(
    {
        "name",
        "label",
        "description",
        "entry_label",
        "cardinality",
        "role",
        "is_required",
        "field_type",
        "unit",
        "llm_description",
        "allow_other",
        "other_label",
        "other_placeholder",
        "allows_not_applicable",
        "allows_not_evaluated",
        "allows_no_information",
        "is_entity_key",
    }
)


def test_no_read_model_field_is_typed_any() -> None:
    """``Any`` on the wire is how raw JSONB leaks to the client (D3)."""
    annotations = {
        name: str(info.annotation) for name, info in TemplateChangeRowRead.model_fields.items()
    }
    # Guards the guard: a renamed or dropped field must not pass vacuously.
    assert set(annotations) == {
        "id",
        "variant",
        "tier",
        "label_path",
        "attribute",
        "before",
        "after",
        "before_opaque_state",
        "after_opaque_state",
        "reorder_count",
        "affects_recorded_data",
    }
    assert [name for name, hint in annotations.items() if re.search(r"\bAny\b", hint)] == []


def test_opaque_and_scalar_attributes_partition_the_snapshot_attributes() -> None:
    """A future JSONB snapshot key cannot silently land in the scalar arm."""
    opaque = template_diff_read.OPAQUE_ATTRIBUTES
    assert opaque | _SCALAR_ATTRIBUTES == (
        set(template_diff.ENTITY_ATTRIBUTE_DEFAULTS) | set(template_diff.FIELD_ATTRIBUTE_DEFAULTS)
    )
    assert not opaque & _SCALAR_ATTRIBUTES


def test_every_tier_has_a_bucket_named_after_its_wire_value() -> None:
    """A client buckets by ``row.tier``, so the bucket keys must BE the tier
    values. Renaming one field silently breaks that lookup."""
    assert set(TemplateConfigDiffBuckets.model_fields) == {tier.value for tier in ChangeTier}


def test_an_unavailable_diff_ships_empty_buckets_by_default() -> None:
    """The default is the safe one: a shape that cannot diff must not be able
    to ship rows by omission."""
    read = TemplateConfigDiffRead(project_template_id=uuid4(), status=DiffStatus.BASELINE_TOO_OLD)

    buckets = read.changes
    assert (buckets.additive, buckets.cosmetic, buckets.semantic, buckets.destructive) == (
        [],
        [],
        [],
        [],
    )


# --------------------------------------------------------------------------
# D6 — the affects_recorded_data post-pass
# --------------------------------------------------------------------------


def _recorded_rows(
    baseline: dict[str, Any],
    current: dict[str, Any],
    *,
    recorded: frozenset[UUID],
    children: dict[UUID, frozenset[UUID]] = NO_CHILDREN,
) -> tuple[TemplateChangeRowRead, ...]:
    diff = diff_snapshots(baseline, current, fields_with_values=recorded)
    return with_recorded_data(diff.changes, children, recorded)


def test_field_row_is_flagged_when_the_field_holds_recorded_work() -> None:
    section_id, field_id = uuid4(), uuid4()
    base = _snapshot(_entity(section_id, _field(field_id)))
    curr = _snapshot(_entity(section_id, _field(field_id, label="Age (years)")))

    assert _only(_recorded_rows(base, curr, recorded=frozenset({field_id}))).affects_recorded_data
    assert not _only(_recorded_rows(base, curr, recorded=NO_VALUES)).affects_recorded_data


def test_option_removal_is_flagged_even_though_the_option_differ_is_value_blind() -> None:
    """The reason this is ONE post-pass and not per-differ (D6).

    ``_diff_options`` receives no value information at all, so a
    per-differ flag would ship ``false`` for a destructive option removal
    on a field full of recorded answers."""
    section_id, field_id = uuid4(), uuid4()
    base = _snapshot(_entity(section_id, _select(field_id, ["yes", "no"])))
    curr = _snapshot(_entity(section_id, _select(field_id, ["yes"])))

    row = _only(_recorded_rows(base, curr, recorded=frozenset({field_id})))
    assert row.variant is ChangeVariant.FIELD_OPTION_REMOVED
    assert row.affects_recorded_data is True


def test_entity_type_row_is_flagged_from_its_live_child_fields() -> None:
    """A section carries no values itself; it inherits the answer from the
    fields it owns in the CURRENT tree."""
    section_id, field_id = uuid4(), uuid4()
    base = _snapshot(_entity(section_id, _field(field_id)))
    curr = _snapshot(_entity(section_id, _field(field_id), label="Population"))
    children = {section_id: frozenset({field_id})}

    flagged = _only(_recorded_rows(base, curr, recorded=frozenset({field_id}), children=children))
    assert flagged.variant is ChangeVariant.ENTITY_TYPE_MODIFIED
    assert flagged.affects_recorded_data is True


def test_entity_type_row_ignores_recorded_fields_of_other_sections() -> None:
    section_id, field_id, elsewhere = uuid4(), uuid4(), uuid4()
    base = _snapshot(_entity(section_id, _field(field_id)))
    curr = _snapshot(_entity(section_id, _field(field_id), label="Population"))
    children = {section_id: frozenset({field_id})}

    row = _only(_recorded_rows(base, curr, recorded=frozenset({elsewhere}), children=children))
    assert row.affects_recorded_data is False


def test_template_instruction_row_is_never_flagged() -> None:
    """The template-level instruction belongs to no node, so no recorded
    set can make it true."""
    section_id, field_id = uuid4(), uuid4()
    entity = _entity(section_id, _field(field_id))
    base, curr = _snapshot(entity), _snapshot(entity, instruction="Read tables too.")

    row = _only(
        _recorded_rows(
            base,
            curr,
            recorded=frozenset({field_id}),
            children={section_id: frozenset({field_id})},
        )
    )
    assert row.variant is ChangeVariant.TEMPLATE_INSTRUCTION_ADDED
    assert row.affects_recorded_data is False


def test_removed_row_is_never_flagged_even_if_the_caller_claims_otherwise() -> None:
    """Structural, not accidental (the RESTRICT argument).

    Every workflow ``field_id`` FK is ON DELETE RESTRICT, so a field that
    left the live tree provably held no recorded work — the delete would
    have been refused. The flag says so even when handed a ``recorded``
    set that names the departed id, which is the only way to tell the
    guard apart from the coincidence that the diff read resolves LIVE
    ids only."""
    section_id, gone = uuid4(), uuid4()
    base = _snapshot(_entity(section_id, _field(gone)))
    curr = _snapshot(_entity(section_id))

    row = _only(_recorded_rows(base, curr, recorded=frozenset({gone})))
    assert row.variant is ChangeVariant.FIELD_REMOVED
    assert row.affects_recorded_data is False


def test_to_rows_never_claims_recorded_work() -> None:
    """The no-value-information entry point: every row reads ``false``,
    because a caller that resolved nothing cannot claim otherwise."""
    section_id, field_id = uuid4(), uuid4()
    base = _snapshot(_entity(section_id, _field(field_id)))
    curr = _snapshot(_entity(section_id, _field(field_id, label="Age (years)")))

    assert [row.affects_recorded_data for row in _rows(base, curr)] == [False]
