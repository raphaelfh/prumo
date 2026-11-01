"""Pure unit test for the tidy-tables projection helper."""

from __future__ import annotations

from uuid import uuid4

from app.models.extraction import (
    ExtractionCardinality,
    ExtractionFieldType,
)
from app.services.exports.descriptors import value_key
from app.services.exports.values import ExportValue, to_export_value
from app.services.extraction_export_service import (
    ArticleDescriptor,
    FieldDescriptor,
    SectionDescriptor,
    _build_tidy_tables,
)


def _tv(raw: object) -> ExportValue:
    """``raw`` typed against a TEXT field, as a value-map entry."""
    return to_export_value(
        {"value": raw},
        FieldDescriptor(
            field_id=uuid4(), label="T", type=ExtractionFieldType.TEXT, allowed_values=()
        ),
        {},
    )


def _field(label):
    return FieldDescriptor(
        field_id=uuid4(),
        label=label,
        type=ExtractionFieldType.TEXT,
        allowed_values=(),
    )


def _study_section():
    eid = uuid4()
    return SectionDescriptor(
        entity_type_id=eid,
        label="Study characteristics",
        parent_entity_type_id=None,
        fields=(_field("Author"), _field("Year")),
        cardinality=ExtractionCardinality.ONE,
        sort_order=0,
    )


def _model_section():
    eid = uuid4()
    return SectionDescriptor(
        entity_type_id=eid,
        label="Model characteristics",
        parent_entity_type_id=None,
        fields=(_field("Method"),),
        cardinality=ExtractionCardinality.MANY,
        sort_order=1,
    )


def test_one_cardinality_section_is_one_row_per_article():
    study = _study_section()
    inst = uuid4()
    run = uuid4()
    article = ArticleDescriptor(
        article_id=uuid4(),
        article_label="Gaca, 2011",
        run_id=run,
        version_id=None,
        entries={(study.entity_type_id, None): (inst,)},
    )
    f_author, f_year = study.fields
    value_map = {
        value_key(run, inst, f_author.field_id): _tv("Gaca"),
        value_key(run, inst, f_year.field_id): _tv("2011"),
    }
    tables = _build_tidy_tables((study,), (article,), value_map, None)
    assert len(tables) == 1
    table = tables[0]
    assert table.title == "Study characteristics"
    assert table.column_labels == ("Author", "Year")
    assert len(table.rows) == 1
    assert table.rows[0].record_label == "Gaca, 2011"
    assert table.rows[0].values == ("Gaca", "2011")


def test_tidy_cell_reads_the_given_rater_slot():
    study = _study_section()
    inst = uuid4()
    run = uuid4()
    reviewer = uuid4()
    article = ArticleDescriptor(
        article_id=uuid4(),
        article_label="Gaca, 2011",
        run_id=run,
        version_id=None,
        entries={(study.entity_type_id, None): (inst,)},
    )
    f_author = study.fields[0]
    value_map = {value_key(run, inst, f_author.field_id, reviewer): _tv("Mine")}
    row = _build_tidy_tables((study,), (article,), value_map, reviewer)[0].rows[0]
    assert row.values[0] == "Mine"
    assert _build_tidy_tables((study,), (article,), value_map, None)[0].rows[0].values[0] in (
        None,
        "",
    )


def test_many_cardinality_section_fans_out_per_instance():
    model = _model_section()
    run = uuid4()
    m_a, m_b = uuid4(), uuid4()
    article = ArticleDescriptor(
        article_id=uuid4(),
        article_label="Gaca, 2011",
        run_id=run,
        version_id=None,
        entries={(model.entity_type_id, None): (m_a, m_b)},
    )
    f_method = model.fields[0]
    value_map = {
        value_key(run, m_a, f_method.field_id): _tv("Logistic regression"),
        value_key(run, m_b, f_method.field_id): _tv("Cox model"),
    }
    tables = _build_tidy_tables((model,), (article,), value_map, None)
    table = tables[0]
    assert len(table.rows) == 2
    # A root repeating section with no entry noun is named by its label.
    assert table.rows[0].record_label.endswith("Model characteristics 1")
    assert table.rows[0].values == ("Logistic regression",)
    assert table.rows[1].values == ("Cox model",)


def test_model_container_section_is_skipped():
    container = SectionDescriptor(
        entity_type_id=uuid4(),
        label="Models",
        parent_entity_type_id=None,
        fields=(),
        cardinality=ExtractionCardinality.MANY,
        sort_order=0,
    )
    tables = _build_tidy_tables((container,), (), {}, None)
    assert tables == ()
