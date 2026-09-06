"""Regression: a singleton section UNDER AN ENTRY must still emit tidy rows.

Bug (post-merge review 2026-06-21): ``_build_tidy_tables`` read
``section_instances`` in the cardinality=ONE branch, but a child section's
instances were not there — they were in the flat ``model_instances`` tuple.
Every production CHARMS child section (model_development, model_performance,
model_validation, model_results, model_interpretation — all
``cardinality='one'``) rendered with ZERO rows, silently dropping every
prediction-model value from the publication sheet while the matrix showed it.

Trees B4 removes the tuple the fix was written against, so these keep the
same guard against the tree: a singleton child is reached through its
parent entry, one row per entry, and its rows are labelled with that entry
rather than with a running index over a flat list.
"""

from __future__ import annotations

from uuid import uuid4

from app.models.extraction import (
    ExtractionCardinality,
    ExtractionEntityRole,
    ExtractionFieldType,
)
from app.services.extraction_export_service import (
    ArticleDescriptor,
    ExportMode,
    FieldDescriptor,
    SectionDescriptor,
    _build_tidy_tables,
)

_GROUP_ID = uuid4()


def _field(field_id, label="Method"):
    return FieldDescriptor(
        field_id=field_id, label=label, type=ExtractionFieldType.TEXT, allowed_values=()
    )


def _group(entry_label: str | None = "model"):
    return SectionDescriptor(
        entity_type_id=_GROUP_ID,
        label="Prediction Models",
        role=ExtractionEntityRole.MODEL_CONTAINER,
        parent_entity_type_id=None,
        fields=(),
        cardinality=ExtractionCardinality.MANY,
        entry_label=entry_label,
    )


def _child(field_id):
    return SectionDescriptor(
        entity_type_id=uuid4(),
        label="Model development",
        role=ExtractionEntityRole.MODEL_SECTION,
        parent_entity_type_id=_GROUP_ID,
        fields=(_field(field_id),),
        # Production child sections are cardinality ONE; the N-entry fan-out
        # comes from the entries above them, never from their own cardinality.
        cardinality=ExtractionCardinality.ONE,
    )


def _article(entries, run_id):
    return ArticleDescriptor(
        article_id=uuid4(),
        header_label="Gaca, 2011",
        run_id=run_id,
        version_id=None,
        entries=entries,
    )


def test_a_singleton_child_emits_one_row_per_entry() -> None:
    field_id = uuid4()
    group, child = _group(), _child(field_id)
    run_id, e1, c1 = uuid4(), uuid4(), uuid4()
    article = _article({(_GROUP_ID, None): (e1,), (child.entity_type_id, e1): (c1,)}, run_id)

    tables = _build_tidy_tables(
        (group, child),
        (article,),
        {(run_id, c1, field_id): "Logistic regression"},
        ExportMode.CONSENSUS,
    )

    # The field-less group is the axis, not a record — one table, not two.
    assert len(tables) == 1
    (row,) = tables[0].rows
    assert row.instance_id == c1
    assert row.values == ("Logistic regression",)


def test_each_entry_gets_its_own_row_with_its_own_value() -> None:
    """What the flat tuple got wrong, at tidy grain.

    Two entries, one singleton child each: two rows. Sourced from the flat
    tuple this produced one row per (entry x child section) — with six child
    sections that is twelve rows per sheet, ten of them empty.
    """
    field_id = uuid4()
    group, child = _group(), _child(field_id)
    run_id = uuid4()
    e1, e2, c1, c2 = uuid4(), uuid4(), uuid4(), uuid4()
    article = _article(
        {
            (_GROUP_ID, None): (e1, e2),
            (child.entity_type_id, e1): (c1,),
            (child.entity_type_id, e2): (c2,),
        },
        run_id,
    )
    value_map = {(run_id, c1, field_id): "Logistic", (run_id, c2, field_id): "Cox"}

    rows = _build_tidy_tables((group, child), (article,), value_map, ExportMode.CONSENSUS)[0].rows

    assert [r.values[0] for r in rows] == ["Logistic", "Cox"]
    assert [r.record_label for r in rows] == [
        "Gaca, 2011 — Model 1",
        "Gaca, 2011 — Model 2",
    ]


def test_the_row_label_uses_the_group_entry_noun() -> None:
    field_id = uuid4()
    group, child = _group(entry_label="arm"), _child(field_id)
    run_id, e1, c1 = uuid4(), uuid4(), uuid4()
    article = _article({(_GROUP_ID, None): (e1,), (child.entity_type_id, e1): (c1,)}, run_id)

    rows = _build_tidy_tables((group, child), (article,), {}, ExportMode.CONSENSUS)[0].rows

    assert rows[0].record_label == "Gaca, 2011 — Arm 1"


def test_a_group_with_no_entry_noun_falls_back_to_its_label() -> None:
    field_id = uuid4()
    group, child = _group(entry_label=None), _child(field_id)
    run_id, e1, c1 = uuid4(), uuid4(), uuid4()
    article = _article({(_GROUP_ID, None): (e1,), (child.entity_type_id, e1): (c1,)}, run_id)

    rows = _build_tidy_tables((group, child), (article,), {}, ExportMode.CONSENSUS)[0].rows

    assert rows[0].record_label == "Gaca, 2011 — Prediction Models 1"


def test_a_root_many_section_still_fans_out_per_instance() -> None:
    """The non-group repeating root, unchanged: one row per instance."""
    field_id = uuid4()
    section = SectionDescriptor(
        entity_type_id=uuid4(),
        label="Outcomes",
        role=ExtractionEntityRole.STUDY_SECTION,
        parent_entity_type_id=None,
        fields=(_field(field_id, "Name"),),
        cardinality=ExtractionCardinality.MANY,
    )
    run_id, i1, i2 = uuid4(), uuid4(), uuid4()
    article = _article({(section.entity_type_id, None): (i1, i2)}, run_id)
    value_map = {(run_id, i1, field_id): "OS", (run_id, i2, field_id): "PFS"}

    rows = _build_tidy_tables((section,), (article,), value_map, ExportMode.CONSENSUS)[0].rows

    assert [r.values[0] for r in rows] == ["OS", "PFS"]
