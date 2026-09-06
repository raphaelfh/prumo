"""The export's entry map: instance ids grouped under their parent.

Replaces the role partition in ``_load_descriptors``, which sorted instances
into ``model_instances`` (every child-section instance, flat) and
``section_instances`` (keyed by entity type alone). Neither key says WHICH
entry an instance belongs to, which is why one model rendered as six
sub-columns on a diagonal — see
``test_extraction_export_golden_charms.py``.

``parent_instance_id`` already carries that, so the grouping needs no role
map and no second query.
"""

from __future__ import annotations

from uuid import uuid4

from app.models.extraction import ExtractionInstance
from app.services.exports.descriptors import build_entries


def _inst(entity_type_id, parent_instance_id=None, sort_order=0, iid=None):
    return ExtractionInstance(
        id=iid or uuid4(),
        project_id=uuid4(),
        article_id=uuid4(),
        template_id=uuid4(),
        entity_type_id=entity_type_id,
        parent_instance_id=parent_instance_id,
        label="x",
        sort_order=sort_order,
    )


def test_root_entries_are_keyed_by_a_null_parent() -> None:
    group = uuid4()
    a, b = _inst(group, sort_order=0), _inst(group, sort_order=1)

    entries = build_entries([a, b])

    assert entries[(group, None)] == (a.id, b.id)


def test_each_entry_owns_its_own_children() -> None:
    """The distinction the flat tuple could not make.

    Two entries, each with the same two singleton child sections. Keyed only
    by entity type, all four children collapse into one list and a consumer
    indexing it positionally reads entry A's section in entry B's column.
    """
    group, child_x, child_y = uuid4(), uuid4(), uuid4()
    m1, m2 = _inst(group, sort_order=0), _inst(group, sort_order=1)
    m1x, m1y = _inst(child_x, m1.id), _inst(child_y, m1.id)
    m2x, m2y = _inst(child_x, m2.id), _inst(child_y, m2.id)

    entries = build_entries([m1, m2, m1x, m1y, m2x, m2y])

    assert entries[(child_x, m1.id)] == (m1x.id,)
    assert entries[(child_x, m2.id)] == (m2x.id,)
    assert entries[(child_y, m1.id)] == (m1y.id,)
    assert entries[(child_y, m2.id)] == (m2y.id,)


def test_orders_by_sort_order_then_id() -> None:
    """Column order must be stable across exports of the same data.

    The rows arrive ordered by ``(entity_type_id, sort_order)`` — a UUID
    first, and no tiebreak when two siblings share a sort_order, so equal
    keys came back in whatever order Postgres chose. Entry columns would
    swap between two exports of an unchanged article.
    """
    group = uuid4()
    low = uuid4()
    high = uuid4()
    lo, hi = (low, high) if low < high else (high, low)
    tied_b = _inst(group, sort_order=0, iid=hi)
    tied_a = _inst(group, sort_order=0, iid=lo)
    later = _inst(group, sort_order=5)

    entries = build_entries([later, tied_b, tied_a])

    assert entries[(group, None)] == (lo, hi, later.id)


def test_ignores_an_instance_with_no_entity_type() -> None:
    assert build_entries([]) == {}
