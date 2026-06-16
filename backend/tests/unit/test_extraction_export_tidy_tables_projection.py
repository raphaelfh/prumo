"""Pure unit test for the tidy-tables projection helper."""

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


def _field(parent, label):
    return FieldDescriptor(
        field_id=uuid4(),
        label=label,
        type=ExtractionFieldType.TEXT,
        allowed_values=(),
        parent_section_id=parent,
    )


def _study_section():
    eid = uuid4()
    return SectionDescriptor(
        entity_type_id=eid,
        label="Study characteristics",
        role=ExtractionEntityRole.STUDY_SECTION,
        parent_entity_type_id=None,
        fields=(_field(eid, "Author"), _field(eid, "Year")),
        cardinality=ExtractionCardinality.ONE,
        sort_order=0,
    )


def _model_section():
    eid = uuid4()
    return SectionDescriptor(
        entity_type_id=eid,
        label="Model characteristics",
        role=ExtractionEntityRole.MODEL_SECTION,
        parent_entity_type_id=None,
        fields=(_field(eid, "Method"),),
        cardinality=ExtractionCardinality.MANY,
        sort_order=1,
    )


def test_one_cardinality_section_is_one_row_per_article():
    study = _study_section()
    inst = uuid4()
    run = uuid4()
    article = ArticleDescriptor(
        article_id=uuid4(),
        header_label="Gaca, 2011",
        run_id=run,
        run_stage=None,
        version_id=None,
        model_instances=(),
        section_instances={study.entity_type_id: (inst,)},
    )
    f_author, f_year = study.fields
    value_map = {
        (run, inst, f_author.field_id): "Gaca",
        (run, inst, f_year.field_id): "2011",
    }
    tables = _build_tidy_tables((study,), (article,), value_map, ExportMode.CONSENSUS)
    assert len(tables) == 1
    table = tables[0]
    assert table.title == "Study characteristics"
    assert table.column_labels == ("Author", "Year")
    assert len(table.rows) == 1
    assert table.rows[0].record_label == "Gaca, 2011"
    assert table.rows[0].values == ("Gaca", "2011")


def test_many_cardinality_section_fans_out_per_instance():
    model = _model_section()
    run = uuid4()
    m_a, m_b = uuid4(), uuid4()
    article = ArticleDescriptor(
        article_id=uuid4(),
        header_label="Gaca, 2011",
        run_id=run,
        run_stage=None,
        version_id=None,
        model_instances=(m_a, m_b),
        section_instances={},
    )
    f_method = model.fields[0]
    value_map = {
        (run, m_a, f_method.field_id): "Logistic regression",
        (run, m_b, f_method.field_id): "Cox model",
    }
    tables = _build_tidy_tables((model,), (article,), value_map, ExportMode.CONSENSUS)
    table = tables[0]
    assert len(table.rows) == 2
    assert table.rows[0].record_label.endswith("Model 1")
    assert table.rows[0].values == ("Logistic regression",)
    assert table.rows[1].values == ("Cox model",)


def test_model_container_section_is_skipped():
    container = SectionDescriptor(
        entity_type_id=uuid4(),
        label="Models",
        role=ExtractionEntityRole.MODEL_CONTAINER,
        parent_entity_type_id=None,
        fields=(),
        cardinality=ExtractionCardinality.MANY,
        sort_order=0,
    )
    tables = _build_tidy_tables((container,), (), {}, ExportMode.CONSENSUS)
    assert tables == ()
