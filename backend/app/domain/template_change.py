"""Shared vocabulary for the template-config diff engine and its wire read model.

``app.services.template_diff`` computes changes and ``app.services.template_diff_read``
projects them onto wire rows; both need these enums, and so does
``app.schemas.hitl_session`` (the wire model references them directly, so the
generated client's unions cannot drift from the engine's). Defined here rather
than in either service module because a schema importing a service would be a
package-level layering cycle: six services already import
``app.schemas.hitl_session``. ``app.domain`` is a cross-cutting support prefix
both ``app/schemas`` and ``app/services`` may depend on
(``scripts/fitness/check_layered_arch.py``), so this is the one home both
sides can share without either importing the other.
"""

from __future__ import annotations

from enum import StrEnum


class DiffStatus(StrEnum):
    """Whether a config diff could be computed, and when not, why (D9).

    One closed 3-way choice rather than a pair of booleans plus a reason: an
    un-diffable template is a state the Publish sheet renders, never an
    error, and only :attr:`AVAILABLE` can carry rows. Encoding it as
    independent fields would make "no diff, yet here are some changes"
    expressible, which is exactly the payload no client should have to
    defend against.
    """

    #: The ordinary computed diff.
    AVAILABLE = "available"
    #: Nothing published yet, so there is no baseline and every node is new.
    INITIAL_VERSION = "initial_version"
    #: A baseline the diff engine cannot be trusted with — pre-0026 "narrow",
    #: which manufactures a phantom SEMANTIC ``role`` row per entity type.
    BASELINE_TOO_OLD = "baseline_too_old"


class OpaqueValueState(StrEnum):
    """A summarized opaque value that has no listable content (D3).

    The wire row ships this instead of a server-rendered English word, so the
    copy layer owns the sentence (``.claude/rules/frontend.md``) and a stored
    value that happens to read like the marker cannot be mistaken for it.
    """

    #: An id, or a scalar the snapshot stored off-contract.
    PRESENT = "present"
    #: A present-but-empty container (``{}`` or ``[]``). Distinct from an
    #: ABSENT attribute, which ships no state at all.
    EMPTY = "empty"


class ChangeTier(StrEnum):
    """Severity tier (D2) — what a reviewer stands to lose."""

    ADDITIVE = "additive"
    COSMETIC = "cosmetic"
    SEMANTIC = "semantic"
    DESTRUCTIVE = "destructive"


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
