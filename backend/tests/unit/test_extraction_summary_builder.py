"""Unit tests for the Summary sub-builder. Pure — no DB."""

from __future__ import annotations

from uuid import uuid4

from app.models.extraction import (
    ExtractionCardinality,
    ExtractionFieldType,
)
from app.services.exports.extraction.summary import build_summary
from app.services.extraction_export_service import (
    ArticleDescriptor,
    ExportLayout,
    ExportMode,
    ExportNotes,
    FieldDescriptor,
    SectionDescriptor,
)


def _field():
    return FieldDescriptor(
        field_id=uuid4(),
        label="F",
        type=ExtractionFieldType.TEXT,
        allowed_values=(),
    )


def _study_section_two_fields():
    eid = uuid4()
    return SectionDescriptor(
        entity_type_id=eid,
        label="Study",
        parent_entity_type_id=None,
        fields=(_field(), _field()),
        cardinality=ExtractionCardinality.ONE,
        sort_order=0,
    )


def _layout(sections, articles, value_map, notes=None):
    return ExportLayout(
        project_name="P",
        template_name="CHARMS",
        template_version=1,
        sections=sections,
        articles=articles,
        reviewers=(),
        mode=ExportMode.CONSENSUS,
        include_ai_metadata=False,
        anonymize_reviewer_names=False,
        notes=notes or ExportNotes(),
        value_map=value_map,
    )


def _flat(spec) -> str:
    return " \n ".join(
        " | ".join("" if c.value is None else str(c.value) for c in row) for row in spec.rows
    )


def test_summary_one_row_per_article_with_completeness():
    section = _study_section_two_fields()
    inst = uuid4()
    run = uuid4()
    article = ArticleDescriptor(
        article_id=uuid4(),
        header_label="Gaca, 2011",
        run_id=run,
        version_id=None,
        entries={(section.entity_type_id, None): (inst,)},
    )
    f0, f1 = section.fields
    # one of two fields filled → 50% completeness
    value_map = {(run, inst, f0.field_id): "filled"}
    spec = build_summary(_layout((section,), (article,), value_map))
    flat = _flat(spec)
    assert spec.title == "Summary"
    assert "Gaca, 2011" in flat
    # 1/2 fields present
    assert "1" in flat and "2" in flat


def test_summary_has_an_article_row_then_one_row_per_entry():
    """§10: one row per article, THEN one row per entry per root group.

    Was one row per model and NO article row, so a template with a group had
    no whole-article line at all.
    """
    study = _study_section_two_fields()
    container = SectionDescriptor(
        entity_type_id=uuid4(),
        label="Models",
        parent_entity_type_id=None,
        fields=(),
        cardinality=ExtractionCardinality.MANY,
        sort_order=1,
        entry_label="model",
    )
    run = uuid4()
    m_a, m_b = uuid4(), uuid4()
    article = ArticleDescriptor(
        article_id=uuid4(),
        header_label="Gaca, 2011",
        run_id=run,
        version_id=None,
        entries={
            (study.entity_type_id, None): (uuid4(),),
            (container.entity_type_id, None): (m_a, m_b),
        },
    )
    spec = build_summary(_layout((study, container), (article,), {}))

    body = list(spec.rows[1:])
    assert [c[1].value for c in body] == ["", "Model 1", "Model 2"]


def test_an_entry_row_counts_only_its_own_subtree():
    """The Summary face of the flat-tuple defect.

    Entry A's child is filled, entry B's is not. Resolved through a
    `model_index` into `model_instances` — which held BOTH children — B's row
    read A's value and reported itself complete.
    """
    group_id = uuid4()
    child_id = uuid4()
    field_id = uuid4()
    group = SectionDescriptor(
        entity_type_id=group_id,
        label="Models",
        parent_entity_type_id=None,
        fields=(),
        cardinality=ExtractionCardinality.MANY,
        sort_order=0,
        entry_label="model",
    )
    child = SectionDescriptor(
        entity_type_id=child_id,
        label="Development",
        parent_entity_type_id=group_id,
        fields=(
            FieldDescriptor(
                field_id=field_id,
                label="Method",
                type=ExtractionFieldType.TEXT,
                allowed_values=(),
            ),
        ),
        cardinality=ExtractionCardinality.ONE,
        sort_order=1,
    )
    run, m_a, m_b, c_a, c_b = uuid4(), uuid4(), uuid4(), uuid4(), uuid4()
    article = ArticleDescriptor(
        article_id=uuid4(),
        header_label="Gaca, 2011",
        run_id=run,
        version_id=None,
        entries={
            (group_id, None): (m_a, m_b),
            (child_id, m_a): (c_a,),
            (child_id, m_b): (c_b,),
        },
    )
    spec = build_summary(_layout((group, child), (article,), {(run, c_a, field_id): "Logistic"}))

    body = list(spec.rows[1:])
    # article row, then Model 1 (1/1), then Model 2 (0/1).
    assert [(r[1].value, r[2].value, r[3].value) for r in body] == [
        ("", 1, 2),
        ("Model 1", 1, 1),
        ("Model 2", 0, 1),
    ]


def test_summary_includes_omitted_by_stage():
    notes = ExportNotes(omitted_articles_by_stage={"extract": 3, "no_run": 1})
    spec = build_summary(_layout((), (), {}, notes=notes))
    flat = _flat(spec)
    assert "extract" in flat
    assert "3" in flat
