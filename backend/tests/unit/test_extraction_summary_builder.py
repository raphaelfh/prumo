"""Unit tests for the Summary sub-builder. Pure — no DB."""

from __future__ import annotations

from uuid import uuid4

from app.models.extraction import (
    ExtractionCardinality,
    ExtractionEntityRole,
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


def _field(parent):
    return FieldDescriptor(
        field_id=uuid4(),
        label="F",
        type=ExtractionFieldType.TEXT,
        allowed_values=(),
        parent_section_id=parent,
    )


def _study_section_two_fields():
    eid = uuid4()
    return SectionDescriptor(
        entity_type_id=eid,
        label="Study",
        role=ExtractionEntityRole.STUDY_SECTION,
        parent_entity_type_id=None,
        fields=(_field(eid), _field(eid)),
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
        run_stage=None,
        version_id=None,
        model_instances=(),
        section_instances={section.entity_type_id: (inst,)},
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


def test_summary_fans_out_per_model_when_model_container_present():
    study = _study_section_two_fields()
    container = SectionDescriptor(
        entity_type_id=uuid4(),
        label="Models",
        role=ExtractionEntityRole.MODEL_CONTAINER,
        parent_entity_type_id=None,
        fields=(),
        cardinality=ExtractionCardinality.MANY,
        sort_order=1,
    )
    run = uuid4()
    m_a, m_b = uuid4(), uuid4()
    article = ArticleDescriptor(
        article_id=uuid4(),
        header_label="Gaca, 2011",
        run_id=run,
        run_stage=None,
        version_id=None,
        model_instances=(m_a, m_b),
        section_instances={study.entity_type_id: (uuid4(),)},
    )
    spec = build_summary(_layout((study, container), (article,), {}))
    # 2 model rows (header excluded)
    body = list(spec.rows[1:])
    assert len(body) == 2


def test_summary_includes_omitted_by_stage():
    notes = ExportNotes(omitted_articles_by_stage={"extract": 3, "no_run": 1})
    spec = build_summary(_layout((), (), {}, notes=notes))
    flat = _flat(spec)
    assert "extract" in flat
    assert "3" in flat
