"""Sub-column enumeration and instance resolution over the entry tree.

Replaces two role branches that could not express the tree:
``matrix._article_fanout_count`` (column count = ``len(model_instances)``)
and ``matrix._resolve_instance_id`` (positional index into that tuple).

A column is "which entry is selected at each repeating section", so a
section's instance is found by walking its ancestor chain — not by index.
"""

from __future__ import annotations

from uuid import uuid4

from app.models.extraction import ExtractionCardinality, ExtractionEntityRole
from app.services.exports.descriptors import (
    EntryColumn,
    build_columns,
    instance_for,
)
from app.services.extraction_export_service import ArticleDescriptor, SectionDescriptor


def _sec(eid, *, parent=None, many=False, order=0):
    return SectionDescriptor(
        entity_type_id=eid,
        label=str(eid)[:8],
        # `role` is still on the dataclass until it is deleted at the end of
        # the slice; nothing under test reads it.
        role=ExtractionEntityRole.STUDY_SECTION,
        parent_entity_type_id=parent,
        fields=(),
        cardinality=ExtractionCardinality.MANY if many else ExtractionCardinality.ONE,
        sort_order=order,
    )


def _article(entries):
    return ArticleDescriptor(
        article_id=uuid4(),
        header_label="Gaca, 2011",
        run_id=uuid4(),
        version_id=None,
        model_instances=(),
        section_instances={},
        entries=entries,
    )


def test_a_template_with_no_repeating_section_has_one_column() -> None:
    s = _sec(uuid4())
    assert len(build_columns((s,), _article({(s.entity_type_id, None): (uuid4(),)}))) == 1


def test_one_column_per_entry_of_the_root_group() -> None:
    g = uuid4()
    e1, e2, e3 = uuid4(), uuid4(), uuid4()
    cols = build_columns((_sec(g, many=True),), _article({(g, None): (e1, e2, e3)}))

    assert [c.selection[g] for c in cols] == [e1, e2, e3]


def test_a_singleton_child_resolves_through_its_own_entry() -> None:
    """The defect in one assertion.

    Two entries, one singleton child section each. Indexing a flat tuple gave
    column 2 the FIRST entry's child; walking the parent edge gives it the
    second entry's.
    """
    g, child = uuid4(), uuid4()
    e1, e2 = uuid4(), uuid4()
    c1, c2 = uuid4(), uuid4()
    group_sec, child_sec = _sec(g, many=True), _sec(child, parent=g)
    sections = (group_sec, child_sec)
    article = _article({(g, None): (e1, e2), (child, e1): (c1,), (child, e2): (c2,)})

    cols = build_columns(sections, article)

    assert len(cols) == 2
    assert [instance_for(child_sec, article, c, sections) for c in cols] == [c1, c2]


def test_a_root_singleton_repeats_across_every_column() -> None:
    """Repeat-not-merge (§5.4): a study section shows the same value in each."""
    g, study = uuid4(), uuid4()
    e1, e2 = uuid4(), uuid4()
    s_inst = uuid4()
    study_sec = _sec(study)
    sections = (_sec(g, many=True), study_sec)
    article = _article({(g, None): (e1, e2), (study, None): (s_inst,)})

    cols = build_columns(sections, article)

    assert [instance_for(study_sec, article, c, sections) for c in cols] == [s_inst, s_inst]


def test_a_root_many_study_section_still_widens_the_axis() -> None:
    """Preserved from today: a repeating section outside any group fans out.

    `extraction-multi-instance.e2e.ts` creates exactly this — a root section
    with cardinality='many' and no group above it. Today's
    `_article_fanout_count` widens for it via the `MANY` branch; dropping that
    would silently collapse those columns to one.
    """
    tests = uuid4()
    i1, i2 = uuid4(), uuid4()
    sec = _sec(tests, many=True)
    article = _article({(tests, None): (i1, i2)})

    cols = build_columns((sec,), article)

    assert [instance_for(sec, article, c, (sec,)) for c in cols] == [i1, i2]


def test_a_nested_group_widens_only_its_own_entry_columns() -> None:
    """§10: the fan-out width under an entry is its largest nested entry count.

    Not a future shape — seeded CHARMS already ships one. ``final_predictors``
    (``seed.py``) names ``prediction_models`` as its parent with
    ``cardinality="many"``, so every CHARMS project has a repeating group
    inside a repeating group today. Its MANY-ness is simply masked, because
    ``matrix._resolve_instance_id`` tests ``role`` before cardinality and
    sends it to the flat tuple with the singletons.
    """
    g, nested = uuid4(), uuid4()
    e1, e2 = uuid4(), uuid4()
    n1a, n1b, n1c = uuid4(), uuid4(), uuid4()
    n2a = uuid4()
    group_sec, nested_sec = _sec(g, many=True), _sec(nested, parent=g, many=True)
    sections = (group_sec, nested_sec)
    article = _article(
        {(g, None): (e1, e2), (nested, e1): (n1a, n1b, n1c), (nested, e2): (n2a,)}
    )

    cols = build_columns(sections, article)

    # e1 brings three columns, e2 brings one — NOT max(3,1) x 2 columns.
    assert [c.selection[g] for c in cols] == [e1, e1, e1, e2]
    assert [instance_for(nested_sec, article, c, sections) for c in cols] == [
        n1a,
        n1b,
        n1c,
        n2a,
    ]


def test_a_child_of_an_entry_with_no_instance_resolves_to_nothing() -> None:
    g, child = uuid4(), uuid4()
    e1 = uuid4()
    child_sec = _sec(child, parent=g)
    sections = (_sec(g, many=True), child_sec)
    article = _article({(g, None): (e1,)})  # no child instance under e1

    (col,) = build_columns(sections, article)

    assert instance_for(child_sec, article, col, sections) is None


def test_expansion_descends_past_two_levels() -> None:
    """Depth three, REPEATING at every level — group -> group -> group.

    The first version of this test put a SINGLETON at level three and was
    vacuous: a singleton is resolved by `instance_for`'s parent walk, never
    by `_expand`, so deleting the recursive call kept it green (verified by
    mutation). Only a repeating section at level three reaches the recursion.

    `n1` holds two deep entries and `n2` holds one, so the widths must
    compose per branch — three columns, not `max(2,1) * 2`.
    """
    g, nested, deep = uuid4(), uuid4(), uuid4()
    e1 = uuid4()
    n1, n2 = uuid4(), uuid4()
    d1a, d1b, d2a = uuid4(), uuid4(), uuid4()
    deep_sec = _sec(deep, parent=nested, many=True)
    sections = (_sec(g, many=True), _sec(nested, parent=g, many=True), deep_sec)
    article = _article(
        {
            (g, None): (e1,),
            (nested, e1): (n1, n2),
            (deep, n1): (d1a, d1b),
            (deep, n2): (d2a,),
        }
    )

    cols = build_columns(sections, article)

    assert [instance_for(deep_sec, article, c, sections) for c in cols] == [d1a, d1b, d2a]
    assert [c.selection[nested] for c in cols] == [n1, n1, n2]


def test_a_parent_cycle_terminates_instead_of_hanging() -> None:
    """0069 makes `parent_entity_type_id` a self-referential FK with no CHECK.

    Nothing then forbids A -> B -> A, and an export worker that recursed on
    one would hang rather than fail. Unreachable today (0016's trigger), so
    this pins the guard, not a behaviour anyone can trigger yet.
    """
    a, b = uuid4(), uuid4()
    ea, eb = uuid4(), uuid4()
    sections = (_sec(a, parent=b, many=True), _sec(b, parent=a, many=True))
    article = _article({(a, None): (ea,), (b, ea): (eb,), (a, eb): (ea,)})

    # No root (both sections name a parent) -> single empty column, no hang.
    assert build_columns(sections, article) == (EntryColumn(selection={}),)
