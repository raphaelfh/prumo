"""Tree-derived export descriptors (trees B4, spec §10).

Lives directly under ``exports/`` rather than in ``exports/extraction/``
for the reason ``extraction_scope_marking`` gives: that package's
``__init__`` imports ``workbook``, which imports this service at module
level, so a module-level import of anything inside it from the service
closes a cycle. Verified rather than assumed — the import fails with
``cannot import name 'AIProposalRow' from partially initialized module``.

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

from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from typing import TYPE_CHECKING
from uuid import UUID

from app.models.extraction import ExtractionCardinality, ExtractionInstance

if TYPE_CHECKING:  # descriptors live in the service; importing them at
    # runtime would close an import cycle.
    from app.services.extraction_export_service import (
        ArticleDescriptor,
        SectionDescriptor,
    )

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


@dataclass(frozen=True)
class EntryColumn:
    """One sub-column of one article: the entry chosen at each repeating section.

    Replaces the integer ``model_index`` the matrix and summary builders
    passed around. An index only works against a single flat axis; once a
    group owns a group, a column is a CHOICE PER LEVEL, and that is what a
    section walks up to find its own instance.
    """

    selection: Mapping[UUID, UUID]


def _children_of(
    sections: Sequence[SectionDescriptor], parent_id: UUID | None
) -> list[SectionDescriptor]:
    return sorted(
        (s for s in sections if s.parent_entity_type_id == parent_id),
        key=lambda s: (s.sort_order, str(s.entity_type_id)),
    )


def _repeats(section: SectionDescriptor) -> bool:
    """Spec §10 calls this ``repeats``; ``cardinality`` already says it.

    Carrying a second field would be derivable state that can disagree with
    the one it is derived from.
    """
    return section.cardinality is ExtractionCardinality.MANY


def build_columns(
    sections: Sequence[SectionDescriptor],
    article: ArticleDescriptor,
) -> tuple[EntryColumn, ...]:
    """Enumerate an article's sub-columns.

    Root repeating sections share ONE axis rather than being crossed with
    each other (spec §5.4: one instance axis per article, a shorter one
    repeating its last entry). Below a root entry the axis widens by that
    entry's own nested count — ``e1`` with three nested entries and ``e2``
    with one give four columns, not eight (spec §10).
    """
    roots = _children_of(sections, None)
    repeating_roots = [s for s in roots if _repeats(s)]
    root_positions = max(
        (len(article.entries.get((s.entity_type_id, None), ())) for s in repeating_roots),
        default=0,
    )
    if root_positions == 0:
        return (EntryColumn(selection={}),)

    columns: list[EntryColumn] = []
    for position in range(root_positions):
        selection: dict[UUID, UUID] = {}
        for root in repeating_roots:
            ids = article.entries.get((root.entity_type_id, None), ())
            if ids:
                # A shorter axis repeats its last entry rather than blanking.
                selection[root.entity_type_id] = ids[min(position, len(ids) - 1)]
        roots_added = list(selection)
        columns.extend(
            _expand(sections, article, selection, roots_added, frozenset(roots_added))
        )
    return tuple(columns)


def _expand(
    sections: Sequence[SectionDescriptor],
    article: ArticleDescriptor,
    selection: dict[UUID, UUID],
    frontier: Sequence[UUID],
    seen: frozenset[UUID],
) -> list[EntryColumn]:
    """Widen one root position by the nested groups under its chosen entries.

    ``frontier`` is the levels added by the previous round, so each round
    descends exactly one level; walking the whole selection again would keep
    rediscovering the level above and never terminate. ``seen`` is the cycle
    guard: after 0069 (B5) ``parent_entity_type_id`` is a self-referential FK
    with nothing forbidding a cycle, and an export worker that recurses on
    one hangs rather than fails.
    """
    nested: list[tuple[SectionDescriptor, tuple[UUID, ...]]] = []
    for entity_type_id in frontier:
        instance_id = selection[entity_type_id]
        for child in _children_of(sections, entity_type_id):
            if not _repeats(child) or child.entity_type_id in seen:
                continue
            ids = article.entries.get((child.entity_type_id, instance_id), ())
            if ids:
                nested.append((child, ids))
    if not nested:
        return [EntryColumn(selection=dict(selection))]

    # Sibling nested groups share the entry's columns rather than crossing —
    # the same one-axis rule the roots follow, one level down.
    width = max(len(ids) for _, ids in nested)
    out: list[EntryColumn] = []
    for j in range(width):
        deeper = dict(selection)
        for child, ids in nested:
            deeper[child.entity_type_id] = ids[min(j, len(ids) - 1)]
        added = [child.entity_type_id for child, _ in nested]
        out.extend(_expand(sections, article, deeper, added, seen | frozenset(added)))
    return out


def instance_for(
    section: SectionDescriptor,
    article: ArticleDescriptor,
    column: EntryColumn,
    sections: Sequence[SectionDescriptor],
) -> UUID | None:
    """The instance whose values feed this section in this column.

    Walks ``parent_entity_type_id`` up to a root, so a singleton child is
    resolved UNDER the entry the column selected — the whole fix. A
    repeating section reads the column's own choice; a singleton reads the
    one instance under its resolved parent.
    """
    parent_instance_id: UUID | None = None
    if section.parent_entity_type_id is not None:
        parent = next(
            (s for s in sections if s.entity_type_id == section.parent_entity_type_id),
            None,
        )
        if parent is None:
            return None
        parent_instance_id = instance_for(parent, article, column, sections)
        if parent_instance_id is None:
            return None

    if _repeats(section):
        return column.selection.get(section.entity_type_id)
    ids = article.entries.get((section.entity_type_id, parent_instance_id), ())
    return ids[0] if ids else None
