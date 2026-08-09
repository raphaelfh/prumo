"""The wire read model over the template-config diff engine (B-9b2a, D4).

:mod:`app.services.template_diff` answers *what changed*; this module answers
*what a client is handed*. It is a sibling rather than more of the engine
because the engine is at its file-size ceiling, and because the vocabulary
here — row ids, wire variants, display strings — is presentation, which the
pure comparison must not learn.

Pure: dataclasses in, dataclasses out. No DB, no IO, no HTTP.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum

from app.services.template_diff import (
    OPTION_KEY,
    ChangeKind,
    ChangeTier,
    NodeKind,
    TemplateChange,
    TemplateDiff,
)


class ChangeVariant(StrEnum):
    """The shape of one row — the client's discriminator (D1).

    One member per reachable ``(kind, node_kind[, option polarity])`` the
    engine can emit, so a renderer never has to re-derive which of the
    engine's overloaded fields are meaningful.
    """

    TEMPLATE_INSTRUCTION_ADDED = "template_instruction_added"
    TEMPLATE_INSTRUCTION_REMOVED = "template_instruction_removed"
    TEMPLATE_INSTRUCTION_MODIFIED = "template_instruction_modified"
    ENTITY_TYPE_ADDED = "entity_type_added"
    ENTITY_TYPE_REMOVED = "entity_type_removed"
    ENTITY_TYPE_MODIFIED = "entity_type_modified"
    ENTITY_TYPE_FIELDS_REORDERED = "entity_type_fields_reordered"
    FIELD_ADDED = "field_added"
    FIELD_REMOVED = "field_removed"
    FIELD_MOVED = "field_moved"
    FIELD_MODIFIED = "field_modified"
    FIELD_OPTION_ADDED = "field_option_added"
    FIELD_OPTION_REMOVED = "field_option_removed"
    FIELD_OPTIONS_REORDERED = "field_options_reordered"


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

#: Reserved :attr:`TemplateChangeRow.id` node component for the one change
#: that belongs to no node: the template-level instruction (``_diff_instruction``
#: constructs without an id at all).
TEMPLATE_NODE_ID = "template"

_ID_SEPARATOR = ":"
#: Placeholder for an empty id component, so the arity is always five.
_ID_ABSENT = "-"

#: Attributes whose stored value is opaque JSONB or an id. These are the only
#: ones rendered server-side (D3): a blob has no client-side rendering, and an
#: entity id must never reach the screen. Rendering *everything* here would
#: also satisfy the no-``Any`` rule, but it would fork the i18n boundary —
#: user-facing text belongs in ``frontend/lib/copy`` (``.claude/rules/frontend.md``).
OPAQUE_ATTRIBUTES = frozenset({"validation_schema", "allowed_units", "parent_entity_type_id"})

#: The complement: attributes that ship typed for the copy layer to render.
#: Listed literally rather than derived, so that adding a snapshot key to
#: ``ENTITY_ATTRIBUTE_DEFAULTS`` / ``FIELD_ATTRIBUTE_DEFAULTS`` breaks the
#: partition test instead of silently defaulting into this arm.
SCALAR_ATTRIBUTES = frozenset(
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
    }
)

#: Stand-in for an opaque value with no listable content — an id, or a scalar
#: the snapshot stored off-contract.
_OPAQUE_PRESENT = "set"

#: Stand-in for a present-but-empty container (``{}`` or ``[]``). Never
#: collapsed to ``None``: ``None`` means the attribute is absent, and an empty
#: container is a distinct, reachable state (e.g. a field's ``validation_schema``
#: starting as ``{}``) that must not be presented as if nothing were there.
_OPAQUE_EMPTY = "empty"


@dataclass(frozen=True, slots=True)
class TemplateChangeRow:
    """One :class:`~app.services.template_diff.TemplateChange` on the wire."""

    #: The composite id (D2): ``kind:node_kind:node_id:attribute:option_code``.
    id: str
    #: The row's discriminator (D1) — tells the client which shape it got.
    variant: ChangeVariant
    #: Severity tier, passed through from the engine unchanged.
    tier: ChangeTier
    #: Section → field labels for display; empty for the template instruction.
    label_path: tuple[str, ...]
    #: The changed key, or ``None`` for a row with no single attribute (a
    #: section add/remove, a field move, or a reorder).
    attribute: str | None = None
    #: The prior display value. ``None`` for an added row or a reorder.
    before: str | bool | None = None
    #: The new display value. ``None`` for a removed row or a reorder.
    after: str | bool | None = None
    #: Sibling count for a reorder row, pulled out of the engine's overloaded
    #: ``after`` (see :func:`_to_row`). ``None`` for every other row.
    #:
    #: The two reorder variants count **different populations** and the copy
    #: layer must not write one sentence for both: a section's count
    #: (``ENTITY_TYPE_FIELDS_REORDERED``) EXCLUDES fields added in the same
    #: diff — the engine's ``after_seq`` keeps only ids that also existed
    #: under the same parent in the baseline (``template_diff.py``,
    #: ``_diff_field_order``). A field's option count
    #: (``FIELD_OPTIONS_REORDERED``) INCLUDES options added in the same diff —
    #: the engine reports ``len(new)`` over the full new option list
    #: (``template_diff.py``, ``_diff_options``).
    reorder_count: int | None = None


def to_rows(diff: TemplateDiff) -> tuple[TemplateChangeRow, ...]:
    """Project a diff onto its wire rows, preserving the engine's order."""
    return tuple(_to_row(change) for change in diff.changes)


def _to_row(change: TemplateChange) -> TemplateChangeRow:
    """One change, with the engine's overloaded slots pulled apart (D3).

    A reorder is the whole reason ``before``/``after`` cannot be passed
    through: the engine puts a sibling *count* in ``after`` there, which is
    neither a before-value nor a display string.
    """
    reordered = change.kind is ChangeKind.REORDERED
    return TemplateChangeRow(
        id=_row_id(change),
        variant=_variant_of(change),
        tier=change.tier,
        label_path=change.label_path,
        attribute=change.attribute,
        before=None if reordered else _wire_value(change.attribute, change.before),
        after=None if reordered else _wire_value(change.attribute, change.after),
        reorder_count=int(change.after) if reordered else None,
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


def _wire_value(attribute: str | None, raw: object) -> str | bool | None:
    """Narrow one engine value to the wire types (D3).

    Two arms, and the second is a fail-safe rather than a fallthrough: the
    baseline side is raw stored JSONB, so a value that is not already a
    display-safe scalar gets summarized instead of shipped, whatever the
    attribute claims to be. ``attribute is None`` (a move's parent labels) and
    ``allowed_values`` (an option code) are strings the engine built itself.
    """
    if attribute in OPAQUE_ATTRIBUTES or not isinstance(raw, bool | str | None):
        return _render_opaque(raw)
    return raw


def _render_opaque(value: object) -> str | None:
    """A one-line stand-in for a blob or an id — never the raw value.

    ``None`` means absent — it must stay reserved for that, so a
    present-but-empty container renders as :data:`_OPAQUE_EMPTY` rather than
    falling through to ``None``. Collapsing the two would make an empty
    ``validation_schema`` (present) indistinguishable on the wire from a
    ``validation_schema`` that was never set (absent).
    """
    if value is None:
        return None
    if isinstance(value, list):
        return ", ".join(str(item) for item in value) or _OPAQUE_EMPTY
    if isinstance(value, dict):
        return ", ".join(sorted(str(key) for key in value)) or _OPAQUE_EMPTY
    return _OPAQUE_PRESENT
