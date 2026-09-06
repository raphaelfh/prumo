"""Tree-derived export descriptors (trees B4, spec §10).

The export used to partition an article's instances by ``role``: every
child-section instance into one flat ``model_instances`` tuple, everything
else into ``section_instances`` keyed by entity type. Neither key records
WHICH entry an instance belongs to, so a consumer that wanted "the third
model's column" could only index the flat tuple positionally — and with one
instance per (entry, singleton child), that tuple is
``entries x child sections`` long. One CHARMS model rendered as six
sub-columns with its values on a diagonal.

``parent_instance_id`` already carries the missing edge. Grouping on it
needs no role, no enum and no second query.
"""

from __future__ import annotations

from collections.abc import Iterable
from uuid import UUID

from app.models.extraction import ExtractionInstance

# (entity_type_id, parent_instance_id) — ``None`` parent for a root section.
EntryKey = tuple[UUID, UUID | None]


def build_entries(
    instances: Iterable[ExtractionInstance],
) -> dict[EntryKey, tuple[UUID, ...]]:
    """Group instance ids by ``(entity_type_id, parent_instance_id)``.

    Ordered by ``(sort_order, id)``. The id tiebreak is load-bearing: the
    loader orders by ``(entity_type_id, sort_order)`` with nothing after it,
    so two siblings sharing a ``sort_order`` came back in whatever order
    Postgres chose and an article's entry columns could swap between two
    exports of unchanged data.
    """
    grouped: dict[EntryKey, list[ExtractionInstance]] = {}
    for inst in instances:
        grouped.setdefault((inst.entity_type_id, inst.parent_instance_id), []).append(inst)
    return {
        key: tuple(i.id for i in sorted(rows, key=lambda i: (i.sort_order or 0, str(i.id))))
        for key, rows in grouped.items()
    }
