"""The wire read model over the template-config diff engine (B-9b2a, D4).

:mod:`app.services.template_diff` answers *what changed*; this module answers
*what a client is handed*. It is a sibling rather than more of the engine
because the engine is at its file-size ceiling, and because the vocabulary
here — row ids, wire variants, display strings — is presentation, which the
pure comparison must not learn.

Pure: dataclasses in, wire models out. No DB, no IO, no HTTP.
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Mapping, Sequence
from uuid import UUID

from app.domain.template_change import ChangeVariant, OpaqueValueState
from app.schemas.hitl_session import TemplateChangeRowRead
from app.services.template_diff import (
    OPTION_KEY,
    ChangeKind,
    NodeKind,
    TemplateChange,
)

#: Every ``(kind, node_kind)`` the engine can construct. Exhaustive by test,
#: with no catch-all: a new pair must fail loudly rather than land in a
#: fallback variant nobody designed a row for. The three pairs deliberately
#: absent are the ones no write path produces — ``(MOVED, ENTITY_TYPE)``,
#: ``(MOVED, TEMPLATE)`` and ``(REORDERED, TEMPLATE)``.
#:
#: ``(MODIFIED, FIELD)`` is the one entry :func:`_variant_of` overrides: an
#: ``allowed_values`` change splits by polarity into its own two variants.
VARIANT_BY_KIND: dict[tuple[ChangeKind, NodeKind], ChangeVariant] = {
    (ChangeKind.ADDED, NodeKind.TEMPLATE): ChangeVariant.TEMPLATE_INSTRUCTION_ADDED,
    (ChangeKind.REMOVED, NodeKind.TEMPLATE): ChangeVariant.TEMPLATE_INSTRUCTION_REMOVED,
    (ChangeKind.MODIFIED, NodeKind.TEMPLATE): ChangeVariant.TEMPLATE_INSTRUCTION_MODIFIED,
    (ChangeKind.ADDED, NodeKind.ENTITY_TYPE): ChangeVariant.ENTITY_TYPE_ADDED,
    (ChangeKind.REMOVED, NodeKind.ENTITY_TYPE): ChangeVariant.ENTITY_TYPE_REMOVED,
    (ChangeKind.MODIFIED, NodeKind.ENTITY_TYPE): ChangeVariant.ENTITY_TYPE_MODIFIED,
    (ChangeKind.REORDERED, NodeKind.ENTITY_TYPE): ChangeVariant.ENTITY_TYPE_FIELDS_REORDERED,
    (ChangeKind.ADDED, NodeKind.FIELD): ChangeVariant.FIELD_ADDED,
    (ChangeKind.REMOVED, NodeKind.FIELD): ChangeVariant.FIELD_REMOVED,
    (ChangeKind.MOVED, NodeKind.FIELD): ChangeVariant.FIELD_MOVED,
    (ChangeKind.MODIFIED, NodeKind.FIELD): ChangeVariant.FIELD_MODIFIED,
    (ChangeKind.REORDERED, NodeKind.FIELD): ChangeVariant.FIELD_OPTIONS_REORDERED,
}

#: Reserved :func:`_row_id` node component for the one change that belongs to
#: no node: the template-level instruction (``_diff_instruction`` constructs
#: without an id at all).
TEMPLATE_NODE_ID = "template"

_ID_SEPARATOR = ":"
#: Placeholder for an empty id component, so the arity is always five.
_ID_ABSENT = "-"

#: Attributes whose stored value is opaque JSONB or an id. These are the only
#: ones summarized server-side (D3): a blob has no client-side rendering, and
#: an entity id must never reach the screen. Summarizing *everything* would
#: also satisfy the no-``Any`` rule, but it would fork the i18n boundary —
#: user-facing text belongs in ``frontend/lib/copy`` (``.claude/rules/frontend.md``).
#: Even here the summary is either real data (a joined key/unit list) or a
#: typed :class:`~app.domain.template_change.OpaqueValueState`, never a
#: server-authored English word. ``test_template_diff_read`` pins the
#: complement, so a new JSONB snapshot key cannot land in the scalar arm.
OPAQUE_ATTRIBUTES = frozenset({"validation_schema", "allowed_units", "parent_entity_type_id"})


def with_recorded_data(
    changes: Sequence[TemplateChange],
    parent_children_field_ids: Mapping[UUID, frozenset[UUID]],
    recorded: frozenset[UUID],
) -> tuple[TemplateChangeRowRead, ...]:
    """The wire rows, with ``affects_recorded_data`` resolved (D6).

    ONE post-pass over the finished rows rather than a flag each differ
    computes for itself, because the differs do not all have the answer:
    ``_diff_options`` takes no value information at all and would ship
    ``False`` for a destructive option removal on a field full of recorded
    answers.

    ``parent_children_field_ids`` maps each CURRENT entity type to the field
    ids it owns. It is needed because a section add/remove absorbs its child
    rows (``template_diff._diff_entity_types``), so the change list alone
    cannot tell which fields a section-level row is really about.
    """
    return tuple(
        _to_row(
            change,
            affects_recorded_data=_affects_recorded_data(
                change, parent_children_field_ids, recorded
            ),
        )
        for change in changes
    )


def fingerprint(active_version_id: UUID | None, rows: Sequence[TemplateChangeRowRead]) -> str:
    """What the manager was looking at, in 64 hex chars (B-9b2b).

    Hashes the **projection plus the baseline's identity**, not the live
    snapshot. A concurrent publish leaves the live tree byte-identical while
    making every row in the diff wrong, so a tree hash would still match; and
    a reviewer recording one answer moves a row's ``tier`` or
    ``affects_recorded_data`` without touching the tree at all. Both live in
    the projection, so both are covered here — which is why the raw
    ``fields_with_values`` set is deliberately NOT hashed on top (it would
    refuse a publish for answers that moved no row the manager saw).

    Canonicalises its own row order rather than trusting the caller's:
    ``SNAPSHOT_SQL`` orders by an unconstrained ``sort_order``
    (``extraction_snapshot.py:82``, ``:88``), so two sections can swap
    between two reads of an unchanged tree. Sorting here — not on the wire —
    is what leaves the shipped B-9b2a row order untouched. The sort key is
    the composite id, which is provably unique; ``(label_path, attribute,
    option_code)`` is not, because nothing enforces unique section labels.

    ``model_dump`` rather than a hand-listed tuple, on purpose: a field added
    to the row model joins the hash automatically instead of quietly escaping
    the drift check.
    """
    payload = {
        "active_version_id": str(active_version_id) if active_version_id else None,
        "rows": [row.model_dump(mode="json") for row in sorted(rows, key=lambda r: r.id)],
    }
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _affects_recorded_data(
    change: TemplateChange,
    parent_children_field_ids: Mapping[UUID, frozenset[UUID]],
    recorded: frozenset[UUID],
) -> bool:
    """Does publishing this change touch work someone already recorded?

    A REMOVED node is structurally always ``False``, and not merely as a
    side effect of ``recorded`` being resolved from live ids: every
    workflow ``field_id`` FK is ON DELETE RESTRICT, so a node that left the
    live tree provably held no recorded work — the delete would have been
    refused. Stated here rather than left to the caller's id set, so a
    future caller resolving a wider set cannot turn it into a lie.

    A section is answered from its child fields, and Discard's section gate
    now agrees: it reads
    ``ExtractionFieldReferenceRepository.sections_with_recorded_work``,
    which asks the same five tables. The gate used to test instance
    OWNERSHIP instead, so a section a session had merely opened read "no
    recorded work" here and was still refused there; that divergence is
    closed.

    One asymmetry survives, and it is the gate's to have: the gate also
    matches on ``instance_id``, which catches work recorded before its
    field was moved to another section. This flag is field-derived, so it
    attributes that work to the field's CURRENT section — the right answer
    for "does publishing this change touch recorded work", and a subset of
    what the delete/discard gate must refuse.
    """
    if change.kind is ChangeKind.REMOVED or change.node_id is None:
        return False
    if change.node_kind is NodeKind.FIELD:
        return change.node_id in recorded
    if change.node_kind is NodeKind.ENTITY_TYPE:
        return not parent_children_field_ids.get(change.node_id, frozenset()).isdisjoint(recorded)
    # The template-level instruction belongs to no node and owns no values.
    return False


def _to_row(change: TemplateChange, *, affects_recorded_data: bool) -> TemplateChangeRowRead:
    """One change, with the engine's overloaded slots pulled apart (D3).

    A reorder is the whole reason ``before``/``after`` cannot be passed
    through: the engine puts a sibling *count* in ``after`` there, which is
    neither a before-value nor a display string.
    """
    reordered = change.kind is ChangeKind.REORDERED
    empty: tuple[str | bool | None, OpaqueValueState | None] = (None, None)
    before, before_state = empty if reordered else _wire_value(change.attribute, change.before)
    after, after_state = empty if reordered else _wire_value(change.attribute, change.after)
    return TemplateChangeRowRead(
        id=_row_id(change),
        variant=_variant_of(change),
        tier=change.tier,
        label_path=list(change.label_path),
        attribute=change.attribute,
        before=before,
        after=after,
        before_opaque_state=before_state,
        after_opaque_state=after_state,
        reorder_count=int(change.after) if reordered else None,
        affects_recorded_data=affects_recorded_data,
    )


# --------------------------------------------------------------------------
# The discriminator (D1)
# --------------------------------------------------------------------------


def _variant_of(change: TemplateChange) -> ChangeVariant:
    """The row's discriminator: one variant per change, never a catch-all."""
    if change.attribute == OPTION_KEY and change.kind is ChangeKind.MODIFIED:
        # Option add and option remove share a ``(kind, node_kind)``; only the
        # polarity of the engine's before/after tells them apart.
        return (
            ChangeVariant.FIELD_OPTION_REMOVED
            if change.after is None
            else ChangeVariant.FIELD_OPTION_ADDED
        )
    return VARIANT_BY_KIND[(change.kind, change.node_kind)]


# --------------------------------------------------------------------------
# The composite id (D2)
# --------------------------------------------------------------------------


def _row_id(change: TemplateChange) -> str:
    """``kind:node_kind:node_id:attribute:option_code``, stable across runs.

    Every component is content-derived, never ordinal: recomputing the diff
    with the snapshot dicts in a different key order mints the same ids, which
    is what lets a client key rows by this and a later slice re-validate an
    acknowledgement against a fresh diff.

    The node component is the **raw** id string, never
    :attr:`TemplateChange.node_id`: ``_as_uuid`` returns ``None`` for a junk id
    and ``_index`` stringifies an absent one to ``"None"``, so the parsed value
    would fuse two distinct nodes into one row.
    """
    node_id = TEMPLATE_NODE_ID if change.node_kind is NodeKind.TEMPLATE else change.raw_node_id
    return _ID_SEPARATOR.join(
        (
            change.kind,
            change.node_kind,
            node_id,
            change.attribute or _ID_ABSENT,
            _option_code(change) or _ID_ABSENT,
        )
    )


def _option_code(change: TemplateChange) -> str | None:
    """The added or removed option code, for the only rows that carry one.

    An options *reorder* also has ``attribute == "allowed_values"`` but puts a
    sibling count in ``after``, so the kind must be checked too.
    """
    if change.attribute != OPTION_KEY or change.kind is not ChangeKind.MODIFIED:
        return None
    code = change.before if change.before is not None else change.after
    return str(code) if code is not None else None


# --------------------------------------------------------------------------
# Display-safe values (D3)
# --------------------------------------------------------------------------


def _wire_value(
    attribute: str | None, raw: object
) -> tuple[str | bool | None, OpaqueValueState | None]:
    """Narrow one engine value to the wire types (D3).

    Returns the display value and, when there is nothing listable to display,
    the typed state the copy layer renders instead — never both.

    Two arms, and the second is a fail-safe rather than a fallthrough: the
    baseline side is raw stored JSONB, so a value that is not already a
    display-safe scalar gets summarized instead of shipped, whatever the
    attribute claims to be. ``attribute is None`` (a move's parent labels) and
    ``allowed_values`` (an option code) are strings the engine built itself.
    """
    if attribute in OPAQUE_ATTRIBUTES or not isinstance(raw, bool | str | None):
        return _render_opaque(raw)
    return raw, None


def _render_opaque(value: object) -> tuple[str | None, OpaqueValueState | None]:
    """A one-line stand-in for a blob or an id — never the raw value.

    ``None`` with no state means absent, and that pairing stays reserved for
    it: a present-but-empty container reports
    :attr:`~app.domain.template_change.OpaqueValueState.EMPTY` instead.
    Collapsing the two would make an empty ``validation_schema`` (present)
    indistinguishable on the wire from one that was never set (absent).

    Emptiness is decided on the CONTAINER, not on the joined string, so a
    ``validation_schema`` whose only key is ``""`` — or an ``allowed_units``
    of ``[""]`` — is not mistaken for an empty one.
    """
    if value is None:
        return None, None
    if isinstance(value, list):
        if not value:
            return None, OpaqueValueState.EMPTY
        return ", ".join(str(item) for item in value), None
    if isinstance(value, dict):
        if not value:
            return None, OpaqueValueState.EMPTY
        return ", ".join(sorted(str(key) for key in value)), None
    return None, OpaqueValueState.PRESENT
