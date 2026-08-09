"""What changed between a published template version and the live draft (B-9a).

Pure comparison over two ``build_template_version_snapshot`` dicts — no DB, no
IO, no persistence (plan D6). The published side is the **raw stored**
``extraction_template_versions.schema_``; the draft side is a fresh
``SNAPSHOT_SQL`` build of the live rows. There is no draft object and no change
log: the draft *is* the live rows, so "what is pending" can only be recovered by
diffing.

Four decisions shape the walk (plan
``docs/superpowers/plans/2026-08-09-template-config-b9a-server-diff.md``):

**D1 — what a change is.** Entity types are indexed by id; **fields are indexed
globally by id**, with the owning entity as a derived attribute. A field id
present on both sides under different parents is ONE :attr:`ChangeKind.MOVED`
change, never remove+add. ``sort_order`` is excluded from the attribute loop
entirely — ``planFieldMove`` renumbers whole sections on every move, so the
integers are noise; reorder is derived from the *relative* sequence of ids
present under the same parent on both sides. Options are bare strings (legacy
rows may be ``{"options": [{value,label}]}``) reduced to their codes via the
shared :func:`normalize_options` and set-differenced — no rename detection is
possible, so callers must never claim one.

**D2 — tiers** answer one question: *can this invalidate data a reviewer already
entered, or change the completion gate of an in-flight run?* :data:`ATTRIBUTE_TIERS`
is exhaustive over the ``SNAPSHOT_SQL`` key set (a unit test asserts it against
the SQL text) and :meth:`_attribute_tier` defaults to ``semantic`` — never
``cosmetic`` — for anything unmapped.

**D3 — value existence is an argument, not a query.** ``fields_with_values`` is
required and keyword-only so no caller can silently under-warn; a count-only
caller passes ``frozenset()`` deliberately.

**D4 — missing keys.** Both sides are normalized through the canonical key set
below before comparing, so a key absent from an older-era baseline (pre-#462
fields without ``allows_not_*``, pre-0051 entities without ``entry_label``)
never yields a phantom change. The one exception is the template-level
``llm_template_instruction``, which participates fully with ``absent ≡ null ≡
""`` — mirroring ``template_instruction_service``'s ``(x or "").strip() or
None``. Without it an instruction-only draft would count zero, since the 0048
triggers only fire on entity-type/field rows.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from typing import Any
from uuid import UUID

from app.domain.template_change import ChangeTier
from app.llm.claim_value import normalize_options

_PATH_SEPARATOR = " → "


class ChangeKind(StrEnum):
    """How a node differs between the two snapshots."""

    ADDED = "added"
    REMOVED = "removed"
    MODIFIED = "modified"
    MOVED = "moved"
    REORDERED = "reordered"


class NodeKind(StrEnum):
    """Which node the change is about."""

    TEMPLATE = "template"
    ENTITY_TYPE = "entity_type"
    FIELD = "field"


# --- The canonical key set (D4), partitioned by how each key is compared -----

#: Top-level key, conditional in the snapshot (``extraction_snapshot.py:137``).
TEMPLATE_INSTRUCTION_KEY = "llm_template_instruction"

IDENTITY_KEY = "id"
ORDER_KEY = "sort_order"
NESTING_KEY = "fields"
#: Compared as a set of option codes, not as an opaque attribute (D1).
OPTION_KEY = "allowed_values"
#: Keys that carry structure rather than meaning: never an attribute change.
STRUCTURAL_KEYS = frozenset({IDENTITY_KEY, ORDER_KEY, NESTING_KEY})

_MODEL_CONTAINER_ROLE = "model_container"
_DEFAULT_ENTRY_LABEL = "model"
ENTRY_LABEL_KEY = "entry_label"

#: Entity-type attributes → the value an absent key means (mirrors the ORM
#: column defaults). ``role`` has no canonical default by design (migration
#: 0016 dropped the server default so an INSERT omitting it fails loudly);
#: baselines old enough to lack it are the pre-0026 "narrow" era, which the
#: caller rejects wholesale via ``snapshot_is_narrow`` (D5).
ENTITY_ATTRIBUTE_DEFAULTS: dict[str, Any] = {
    "name": None,
    "label": None,
    "description": None,
    ENTRY_LABEL_KEY: None,  # role-aware, see _normalize_entity
    "parent_entity_type_id": None,
    "cardinality": "one",
    "role": None,
    "is_required": False,
}

#: Field attributes → the value an absent key means.
FIELD_ATTRIBUTE_DEFAULTS: dict[str, Any] = {
    "name": None,
    "label": None,
    "description": None,
    "field_type": None,
    "is_required": False,
    "validation_schema": None,
    "unit": None,
    "allowed_units": None,
    "llm_description": None,
    "allow_other": False,
    "other_label": None,
    "other_placeholder": None,
    "allows_not_applicable": False,
    "allows_not_evaluated": False,
}

#: D2, exhaustive over the comparable keys of both node kinds. Two entries are
#: a *base* tier :func:`_attribute_tier` escalates: ``allow_other`` (destructive
#: when turned off — it orphans free text) and ``field_type`` (destructive on a
#: field that already holds values). ``allowed_values`` is absent by design: it
#: is diffed per option, not as one opaque attribute.
ATTRIBUTE_TIERS: dict[str, ChangeTier] = {
    # cosmetic — wording only
    "label": ChangeTier.COSMETIC,
    "description": ChangeTier.COSMETIC,
    "llm_description": ChangeTier.COSMETIC,
    "other_label": ChangeTier.COSMETIC,
    "other_placeholder": ChangeTier.COSMETIC,
    # semantic — changes meaning, the gate, or the export shape
    "name": ChangeTier.SEMANTIC,
    "field_type": ChangeTier.SEMANTIC,
    "is_required": ChangeTier.SEMANTIC,
    "cardinality": ChangeTier.SEMANTIC,
    "role": ChangeTier.SEMANTIC,
    "unit": ChangeTier.SEMANTIC,
    "allowed_units": ChangeTier.SEMANTIC,
    "validation_schema": ChangeTier.SEMANTIC,
    "allows_not_applicable": ChangeTier.SEMANTIC,
    "allows_not_evaluated": ChangeTier.SEMANTIC,
    "allow_other": ChangeTier.SEMANTIC,
    # B-8 made entry_label the export record stem + the AI instance-label
    # fallback: changing it silently relabels exported model rows.
    ENTRY_LABEL_KEY: ChangeTier.SEMANTIC,
    # No write path re-parents an entity type today; unmapped in D2 ⇒ default.
    "parent_entity_type_id": ChangeTier.SEMANTIC,
}

#: Tier for a cross-parent move of a field with no recorded values (D2). A move
#: is never cosmetic: it re-keys which instances the completion gate demands the
#: field on, even when nothing is stranded yet.
#:
#: The B-9a plan is self-contradictory here — D2's tier map lists "a ``moved``
#: field with no recorded values" under *semantic*, while the T1 test checklist
#: says *cosmetic*. D2 is the ratified decision and matches its own stated test
#: ("can this ... change the completion gate of an in-flight run?"), so it wins;
#: flipping this single constant reverses the call if B-9b's sheet disagrees.
MOVED_WITHOUT_VALUES_TIER = ChangeTier.SEMANTIC


@dataclass(frozen=True, slots=True)
class TemplateChange:
    """One difference between the published version and the live draft.

    ``before``/``after`` carry the raw snapshot values for a
    :attr:`ChangeKind.MODIFIED` attribute, the removed/added option code for an
    ``allowed_values`` change, and the **parent labels** for a
    :attr:`ChangeKind.MOVED` field ("Section A" → "Section B"). For
    :attr:`ChangeKind.REORDERED`, ``after`` is how many siblings the reorder
    covers.
    """

    kind: ChangeKind
    node_kind: NodeKind
    tier: ChangeTier
    label_path: tuple[str, ...]
    #: The id **exactly as** :func:`_index` keyed the node by, so a caller
    #: that must stay round-trippable never loses one: a junk or absent id
    #: survives here verbatim where :attr:`node_id` gives up on it.
    #: Undefaulted (not merely ``""``) so a construction site that forgets it
    #: fails loudly instead of silently minting a colliding id (e.g.
    #: ``modified:field::label:-``, indistinguishable from every other
    #: forgetful call). Empty only for the template-level instruction change,
    #: which has no node and must pass ``raw_node_id=""`` explicitly.
    raw_node_id: str
    attribute: str | None = None
    before: Any = None
    after: Any = None

    @property
    def node_id(self) -> UUID | None:
        """The parsed id for callers that key off a real ``UUID``.

        Derived rather than stored: it is a pure function of
        :attr:`raw_node_id`, and storing both invited a construction site to
        pass an id that disagreed with itself. ``None`` where
        :func:`_as_uuid` gives up — a junk or absent id — which is why the
        row-id builder keys off the raw string instead.
        """
        return _as_uuid(self.raw_node_id)

    @property
    def label(self) -> str:
        """The label path as one human string, e.g. ``Participants → Age``."""
        return _PATH_SEPARATOR.join(self.label_path)


@dataclass(frozen=True, slots=True)
class TemplateDiff:
    """The full change list, plus the tier buckets a publish sheet renders."""

    changes: tuple[TemplateChange, ...] = ()

    @property
    def total(self) -> int:
        return len(self.changes)

    @property
    def by_tier(self) -> dict[ChangeTier, tuple[TemplateChange, ...]]:
        """Every tier is present, empty tiers included."""
        return {tier: tuple(c for c in self.changes if c.tier is tier) for tier in ChangeTier}


@dataclass(frozen=True, slots=True)
class _Node:
    """An indexed snapshot node with its parent context resolved."""

    node_id: str
    label: str
    data: dict[str, Any]
    parent_id: str | None = None
    parent_label: str = ""


def diff_snapshots(
    baseline: dict[str, Any],
    current: dict[str, Any],
    *,
    fields_with_values: frozenset[UUID],
) -> TemplateDiff:
    """Diff a published snapshot against the live one.

    ``baseline`` must be the **raw stored** ``schema_`` of the active version:
    any reader that re-materializes it (``entity_types_for_version`` and its
    live fallback) erases the key-presence D4 depends on. ``fields_with_values``
    is the set of field ids that already hold recorded values — required, so a
    caller that cannot resolve it must pass ``frozenset()`` on purpose (D3).
    """
    value_ids = {str(field_id) for field_id in fields_with_values}
    base_entities, base_fields, base_order = _index(baseline)
    curr_entities, curr_fields, curr_order = _index(current)

    changes: list[TemplateChange] = []
    changes += _diff_instruction(baseline, current)
    changes += _diff_entity_types(base_entities, curr_entities, curr_fields)
    changes += _diff_fields(base_entities, curr_entities, base_fields, curr_fields, value_ids)
    changes += _diff_field_order(
        base_entities, curr_entities, base_fields, curr_fields, base_order, curr_order
    )
    return TemplateDiff(tuple(changes))


# --------------------------------------------------------------------------
# Indexing + normalization (D4)
# --------------------------------------------------------------------------


def _index(
    snapshot: dict[str, Any],
) -> tuple[dict[str, _Node], dict[str, _Node], dict[str, list[str]]]:
    """Entity types by id, fields by id **globally**, field ids per parent."""
    entities: dict[str, _Node] = {}
    fields: dict[str, _Node] = {}
    order: dict[str, list[str]] = {}

    for raw_entity in snapshot.get("entity_types") or []:
        entity_id = str(raw_entity.get(IDENTITY_KEY))
        entity_label = _label(raw_entity)
        entities[entity_id] = _Node(
            node_id=entity_id, label=entity_label, data=_normalize_entity(raw_entity)
        )
        sibling_ids: list[str] = []
        for raw_field in raw_entity.get(NESTING_KEY) or []:
            field_id = str(raw_field.get(IDENTITY_KEY))
            fields[field_id] = _Node(
                node_id=field_id,
                label=_label(raw_field),
                data=_normalize_field(raw_field),
                parent_id=entity_id,
                parent_label=entity_label,
            )
            sibling_ids.append(field_id)
        order[entity_id] = sibling_ids

    return entities, fields, order


def _normalize_entity(raw: dict[str, Any]) -> dict[str, Any]:
    """Fill absent keys with their canonical defaults (present-but-null stays null)."""
    data = {key: raw.get(key, default) for key, default in ENTITY_ATTRIBUTE_DEFAULTS.items()}
    if ENTRY_LABEL_KEY not in raw and data["role"] == _MODEL_CONTAINER_ROLE:
        # 0051 seeded every repeating group to "model"; a pre-0051 baseline
        # that simply lacks the key describes the same tree.
        data[ENTRY_LABEL_KEY] = _DEFAULT_ENTRY_LABEL
    return data


def _normalize_field(raw: dict[str, Any]) -> dict[str, Any]:
    data = {key: raw.get(key, default) for key, default in FIELD_ATTRIBUTE_DEFAULTS.items()}
    data[OPTION_KEY] = raw.get(OPTION_KEY)
    return data


def _label(raw: dict[str, Any]) -> str:
    return str(raw.get("label") or raw.get("name") or raw.get(IDENTITY_KEY) or "")


def _as_uuid(raw: str | None) -> UUID | None:
    """Snapshot ids are uuid columns rendered by jsonb; tolerate junk anyway."""
    if raw is None:
        return None
    try:
        return UUID(raw)
    except ValueError:
        return None


# --------------------------------------------------------------------------
# Template-level instruction (D4 exception)
# --------------------------------------------------------------------------


def _instruction(snapshot: dict[str, Any]) -> str | None:
    raw = snapshot.get(TEMPLATE_INSTRUCTION_KEY)
    return (str(raw) if raw is not None else "").strip() or None


def _diff_instruction(baseline: dict[str, Any], current: dict[str, Any]) -> list[TemplateChange]:
    before, after = _instruction(baseline), _instruction(current)
    if before == after:
        return []
    if before is None:
        kind = ChangeKind.ADDED
    elif after is None:
        kind = ChangeKind.REMOVED
    else:
        kind = ChangeKind.MODIFIED
    return [
        TemplateChange(
            kind=kind,
            node_kind=NodeKind.TEMPLATE,
            tier=ChangeTier.SEMANTIC,
            label_path=(),
            # No node backs the template-level instruction (see the class
            # docstring); pass the empty id explicitly rather than relying on
            # a default that no longer exists.
            raw_node_id="",
            attribute=TEMPLATE_INSTRUCTION_KEY,
            before=before,
            after=after,
        )
    ]


# --------------------------------------------------------------------------
# Entity types
# --------------------------------------------------------------------------


def _diff_entity_types(
    base_entities: dict[str, _Node],
    curr_entities: dict[str, _Node],
    curr_fields: dict[str, _Node],
) -> list[TemplateChange]:
    """Added / removed / modified sections.

    A whole added or removed section is ONE change: its fields are absorbed
    (reporting "section removed" plus one row per field it contained would
    inflate the count without telling the reviewer anything new).
    """
    changes: list[TemplateChange] = []

    for entity_id, node in curr_entities.items():
        if entity_id in base_entities:
            continue
        has_required = any(
            child.data["is_required"]
            for child in curr_fields.values()
            if child.parent_id == entity_id
        )
        changes.append(
            TemplateChange(
                kind=ChangeKind.ADDED,
                node_kind=NodeKind.ENTITY_TYPE,
                tier=ChangeTier.SEMANTIC if has_required else ChangeTier.ADDITIVE,
                label_path=(node.label,),
                raw_node_id=entity_id,
            )
        )

    for entity_id, node in base_entities.items():
        if entity_id in curr_entities:
            continue
        changes.append(
            TemplateChange(
                kind=ChangeKind.REMOVED,
                node_kind=NodeKind.ENTITY_TYPE,
                tier=ChangeTier.DESTRUCTIVE,
                label_path=(node.label,),
                raw_node_id=entity_id,
            )
        )

    for entity_id, node in curr_entities.items():
        before = base_entities.get(entity_id)
        if before is None:
            continue
        changes += [
            TemplateChange(
                kind=ChangeKind.MODIFIED,
                node_kind=NodeKind.ENTITY_TYPE,
                tier=_attribute_tier(key, before.data[key], node.data[key], has_values=False),
                label_path=(node.label,),
                raw_node_id=entity_id,
                attribute=key,
                before=before.data[key],
                after=node.data[key],
            )
            for key in ENTITY_ATTRIBUTE_DEFAULTS
            if before.data[key] != node.data[key]
        ]

    return changes


# --------------------------------------------------------------------------
# Fields (indexed globally — a cross-parent move is one change, D1)
# --------------------------------------------------------------------------


def _diff_fields(
    base_entities: dict[str, _Node],
    curr_entities: dict[str, _Node],
    base_fields: dict[str, _Node],
    curr_fields: dict[str, _Node],
    value_ids: set[str],
) -> list[TemplateChange]:
    changes: list[TemplateChange] = []

    for field_id, node in curr_fields.items():
        before = base_fields.get(field_id)
        if before is None:
            # Absorbed by the "section added" change when the parent is new.
            if node.parent_id in base_entities:
                changes.append(
                    TemplateChange(
                        kind=ChangeKind.ADDED,
                        node_kind=NodeKind.FIELD,
                        tier=(
                            ChangeTier.SEMANTIC if node.data["is_required"] else ChangeTier.ADDITIVE
                        ),
                        label_path=(node.parent_label, node.label),
                        raw_node_id=field_id,
                    )
                )
            continue

        has_values = field_id in value_ids
        if before.parent_id != node.parent_id:
            changes.append(
                TemplateChange(
                    kind=ChangeKind.MOVED,
                    node_kind=NodeKind.FIELD,
                    # Values are keyed (instance_id, field_id): re-parenting
                    # strands them on the old section's instances.
                    tier=(ChangeTier.DESTRUCTIVE if has_values else MOVED_WITHOUT_VALUES_TIER),
                    label_path=(node.parent_label, node.label),
                    raw_node_id=field_id,
                    before=before.parent_label,
                    after=node.parent_label,
                )
            )
        changes += _diff_field_attributes(before, node, has_values=has_values)
        changes += _diff_options(before, node)

    for field_id, node in base_fields.items():
        if field_id in curr_fields:
            continue
        # Absorbed by the "section removed" change when the parent is gone.
        if node.parent_id in curr_entities:
            changes.append(
                TemplateChange(
                    kind=ChangeKind.REMOVED,
                    node_kind=NodeKind.FIELD,
                    tier=ChangeTier.DESTRUCTIVE,
                    label_path=(node.parent_label, node.label),
                    raw_node_id=field_id,
                )
            )

    return changes


def _diff_field_attributes(
    before: _Node, after: _Node, *, has_values: bool
) -> list[TemplateChange]:
    return [
        TemplateChange(
            kind=ChangeKind.MODIFIED,
            node_kind=NodeKind.FIELD,
            tier=_attribute_tier(key, before.data[key], after.data[key], has_values=has_values),
            label_path=(after.parent_label, after.label),
            raw_node_id=after.node_id,
            attribute=key,
            before=before.data[key],
            after=after.data[key],
        )
        for key in FIELD_ATTRIBUTE_DEFAULTS
        if before.data[key] != after.data[key]
    ]


def _attribute_tier(key: str, before: Any, after: Any, *, has_values: bool) -> ChangeTier:
    """D2. Unmapped keys are ``semantic`` — never cosmetic by accident."""
    if key == "allow_other" and before and not after:
        return ChangeTier.DESTRUCTIVE  # orphans every free-text answer
    if key == "field_type" and has_values:
        return ChangeTier.DESTRUCTIVE  # update_field does not block this today
    return ATTRIBUTE_TIERS.get(key, ChangeTier.SEMANTIC)


# --------------------------------------------------------------------------
# Options — set difference over codes, then a relative-order check (D1)
# --------------------------------------------------------------------------


def _option_codes(allowed_values: Any) -> list[str]:
    """The stored option codes, tolerant of the legacy ``{value,label}`` shape."""
    codes: list[str] = []
    for option in normalize_options(allowed_values):
        if isinstance(option, dict):
            codes.append(str(option.get("value", option)))
        else:
            codes.append(str(option))
    return codes


def _diff_options(before: _Node, after: _Node) -> list[TemplateChange]:
    old = _option_codes(before.data[OPTION_KEY])
    new = _option_codes(after.data[OPTION_KEY])
    if old == new:
        return []

    path = (after.parent_label, after.label)
    old_set, new_set = set(old), set(new)
    changes = [
        TemplateChange(
            kind=ChangeKind.MODIFIED,
            node_kind=NodeKind.FIELD,
            tier=ChangeTier.DESTRUCTIVE,
            label_path=path,
            raw_node_id=after.node_id,
            attribute=OPTION_KEY,
            before=code,
        )
        for code in dict.fromkeys(old)
        if code not in new_set
    ]
    changes += [
        TemplateChange(
            kind=ChangeKind.MODIFIED,
            node_kind=NodeKind.FIELD,
            tier=ChangeTier.ADDITIVE,
            label_path=path,
            raw_node_id=after.node_id,
            attribute=OPTION_KEY,
            after=code,
        )
        for code in dict.fromkeys(new)
        if code not in old_set
    ]

    # Renames are undetectable on bare strings, so only the *relative* order of
    # the options common to both sides can be called a reorder.
    if [c for c in old if c in new_set] != [c for c in new if c in old_set]:
        changes.append(
            TemplateChange(
                kind=ChangeKind.REORDERED,
                node_kind=NodeKind.FIELD,
                tier=ChangeTier.COSMETIC,
                label_path=path,
                raw_node_id=after.node_id,
                attribute=OPTION_KEY,
                after=len(new),
            )
        )
    return changes


# --------------------------------------------------------------------------
# Field order — relative sequence only, never sort_order (D1)
# --------------------------------------------------------------------------


def _diff_field_order(
    base_entities: dict[str, _Node],
    curr_entities: dict[str, _Node],
    base_fields: dict[str, _Node],
    curr_fields: dict[str, _Node],
    base_order: dict[str, list[str]],
    curr_order: dict[str, list[str]],
) -> list[TemplateChange]:
    """One cosmetic change per section whose surviving fields swapped places.

    Ids that were added, removed or re-parented drop out of both sequences
    first, so an insert-in-the-middle or a delete — each of which renumbers
    every following sibling — reports only its own change.
    """
    changes: list[TemplateChange] = []
    for entity_id, node in curr_entities.items():
        if entity_id not in base_entities:
            continue
        before_seq = [
            field_id
            for field_id in base_order.get(entity_id, [])
            if _stayed_under(curr_fields, field_id, entity_id)
        ]
        after_seq = [
            field_id
            for field_id in curr_order.get(entity_id, [])
            if _stayed_under(base_fields, field_id, entity_id)
        ]
        if before_seq != after_seq:
            changes.append(
                TemplateChange(
                    kind=ChangeKind.REORDERED,
                    node_kind=NodeKind.ENTITY_TYPE,
                    tier=ChangeTier.COSMETIC,
                    label_path=(node.label,),
                    raw_node_id=entity_id,
                    after=len(after_seq),
                )
            )
    return changes


def _stayed_under(fields: dict[str, _Node], field_id: str, entity_id: str) -> bool:
    node = fields.get(field_id)
    return node is not None and node.parent_id == entity_id
