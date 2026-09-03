"""Hand-built snapshot dicts in the exact shape ``SNAPSHOT_SQL`` emits.

Shared by ``test_template_diff`` (the engine) and ``test_template_diff_read``
(the wire read model) so a new snapshot column cannot update one copy and
leave the other silently testing the old shape. ``test_template_diff``'s
``_snapshot_sql_keys()`` drift guard is what pins these against the real
builder (``extraction_snapshot.py``), and it now protects both suites.

Deliberately NOT tolerant of missing keys: the "era" shapes older stored
snapshots really have (pre-#462 fields without ``allows_not_*``, pre-0051
entities without ``entry_label``) are produced by stripping keys back off in
the test that cares, so the default here stays the modern wide shape.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID


def field_node(field_id: UUID, **over: Any) -> dict[str, Any]:
    """A field object with every wide-builder key present."""
    node: dict[str, Any] = {
        "id": str(field_id),
        "name": "age",
        "label": "Age",
        "description": None,
        "field_type": "text",
        "is_required": False,
        "validation_schema": {},
        "allowed_values": None,
        "unit": None,
        "allowed_units": None,
        "sort_order": 0,
        "llm_description": None,
        "allow_other": False,
        "other_label": None,
        "other_placeholder": None,
        "allows_not_applicable": False,
        "allows_not_evaluated": False,
        "allows_no_information": True,
        "is_entity_key": False,
    }
    node.update(over)
    return node


def entity_node(entity_id: UUID, *fields: dict[str, Any], **over: Any) -> dict[str, Any]:
    """An entity-type object; nested fields get ``sort_order`` by position.

    Positional ``sort_order`` is what the SQL builder produces (fields are
    aggregated ``ORDER BY f.sort_order``), so inserting or deleting a
    sibling here renumbers the rest exactly like ``planFieldMove`` does.
    """
    node: dict[str, Any] = {
        "id": str(entity_id),
        "name": "participants",
        "label": "Participants",
        "description": None,
        "entry_label": None,
        "parent_entity_type_id": None,
        "cardinality": "one",
        "role": "study_section",
        "sort_order": 0,
        "is_required": False,
        "fields": [dict(f, sort_order=i) for i, f in enumerate(fields)],
    }
    node.update(over)
    return node


def snapshot(*entity_types: dict[str, Any], instruction: str | None = None) -> dict[str, Any]:
    """A whole snapshot; ``instruction`` is omitted entirely when None.

    Omission is the point: ``llm_template_instruction`` is conditional in the
    real snapshot, and the D4 exception treats ``absent ≡ null ≡ ""``.
    """
    built: dict[str, Any] = {
        "entity_types": [dict(et, sort_order=i) for i, et in enumerate(entity_types)]
    }
    if instruction is not None:
        built["llm_template_instruction"] = instruction
    return built
