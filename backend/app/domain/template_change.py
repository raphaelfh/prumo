"""Shared vocabulary for the template-config diff engine and its wire read model.

``app.services.template_diff`` computes changes and ``app.services.template_diff_read``
projects them onto wire rows; both need these two enums, and so does
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
