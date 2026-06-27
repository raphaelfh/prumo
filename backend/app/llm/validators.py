"""Semantic output validators.

Raising ModelRetry feeds the message back to the model for another
attempt — the structured replacement for the legacy silent-empty-dict
fallback. Pydantic itself already enforces types, enums, and the 0-1
confidence range; these validators cover what a type system cannot.

Read-time predicates (``evidence_is_grounded``, ``anchor_kind``) are
pure, never-raising helpers used in the citation read path — they are
distinct from the extraction-time ``evidence_is_plausible`` validator
and must never raise ``ModelRetry`` or any exception."""

from typing import Any, Literal

from pydantic import ValidationError
from pydantic_ai import ModelRetry

from app.schemas.extraction import PositionV1, parse_position


def evidence_is_plausible(output: Any) -> Any:
    """Reject impossible evidence so it never reaches the database.

    Assumes every field in ``type(output).model_fields`` carries a
    ``field_info.alias`` matching the schema property name the model was
    shown (the ``build_output_models`` convention) — the retry message
    must reference names the model can map back to its schema.
    """
    for field_name, field_info in type(output).model_fields.items():
        label = field_info.alias or field_name
        field_result = getattr(output, field_name)
        evidence_list = getattr(field_result, "evidence", None) or []
        for idx, evidence in enumerate(evidence_list):
            if not evidence.text.strip():
                raise ModelRetry(
                    f"Field '{label}' evidence[{idx}]: evidence.text must be a "
                    "non-empty quote; omit the entry when there is no quote."
                )
            if evidence.page_number is not None and evidence.page_number < 1:
                raise ModelRetry(
                    f"Field '{label}' evidence[{idx}]: page_number must be a "
                    "1-based page number or null."
                )
    return output


def evidence_is_grounded(position: dict[str, Any] | None) -> bool:
    """Return True iff ``position`` parses to a valid anchored ``PositionV1``.

    Pure read-time predicate — never raises. Used by ``citation_read_service``
    to derive the ``verified`` flag without a schema migration.

    Returns False for:
    - None or empty dict  (no position stored / legacy row)
    - dicts that fail ``PositionV1`` validation  (corrupted data)
    """
    if not position:
        return False
    try:
        parsed: PositionV1 | None = parse_position(position)
    except ValidationError:
        return False
    return parsed is not None


def anchor_kind(position: dict[str, Any] | None) -> Literal["text", "region", "hybrid"] | None:
    """Return the anchor ``kind`` string when ``position`` is a valid ``PositionV1``.

    Returns None for unanchored / invalid positions. Pure, never raises.
    Possible non-None values: ``"text"``, ``"region"``, ``"hybrid"``.
    """
    if not position:
        return None
    try:
        parsed: PositionV1 | None = parse_position(position)
    except ValidationError:
        return None
    if parsed is None:
        return None
    return parsed.anchor.kind
