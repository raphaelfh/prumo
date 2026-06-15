"""Unit tests for the tidy-tables sub-builder. Pure — no DB."""

from __future__ import annotations

from uuid import uuid4

from app.models.extraction import ExtractionCardinality
from app.services.exports.extraction.tidy_tables import build_tidy_tables
from app.services.extraction_export_service import (
    ExportLayout,
    ExportMode,
    ExportNotes,
    TidyRow,
    TidyTable,
)


def _layout(tables: tuple[TidyTable, ...]) -> ExportLayout:
    return ExportLayout(
        project_name="P",
        template_name="CHARMS",
        template_version=1,
        sections=(),
        articles=(),
        reviewers=(),
        mode=ExportMode.CONSENSUS,
        include_ai_metadata=False,
        anonymize_reviewer_names=False,
        notes=ExportNotes(),
        value_map={},
        tidy_tables=tables,
    )


def _study_table() -> TidyTable:
    fid_a, fid_b = uuid4(), uuid4()
    return TidyTable(
        section_id=uuid4(),
        title="Study characteristics",
        cardinality=ExtractionCardinality.ONE,
        column_field_ids=(fid_a, fid_b),
        column_labels=("Author", "Year"),
        rows=(
            TidyRow(
                article_id=uuid4(),
                instance_id=None,
                record_label="Gaca, 2011",
                values=("Gaca", 2011),
            ),
            TidyRow(
                article_id=uuid4(),
                instance_id=None,
                record_label="De Feo, 2012",
                values=("De Feo", 2012),
            ),
        ),
    )


def _model_table() -> TidyTable:
    fid = uuid4()
    aid = uuid4()
    return TidyTable(
        section_id=uuid4(),
        title="Model characteristics",
        cardinality=ExtractionCardinality.MANY,
        column_field_ids=(fid,),
        column_labels=("Method",),
        rows=(
            TidyRow(
                article_id=aid,
                instance_id=uuid4(),
                record_label="Gaca, 2011 — Model 1",
                values=("Logistic regression",),
            ),
            TidyRow(
                article_id=aid,
                instance_id=uuid4(),
                record_label="Gaca, 2011 — Model 2",
                values=("Cox model",),
            ),
        ),
    )


def test_one_sheet_per_tidy_table():
    specs = build_tidy_tables(_layout((_study_table(), _model_table())))
    assert [s.title for s in specs] == ["Study characteristics", "Model characteristics"]


def test_tidy_table_header_is_record_plus_field_labels():
    spec = build_tidy_tables(_layout((_study_table(),)))[0]
    header = [c.value for c in spec.rows[0]]
    assert header == ["Record", "Author", "Year"]


def test_tidy_table_one_row_per_record_with_baked_values():
    spec = build_tidy_tables(_layout((_study_table(),)))[0]
    body = spec.rows[1:]
    assert [r[0].value for r in body] == ["Gaca, 2011", "De Feo, 2012"]
    assert body[0][1].value == "Gaca"
    assert body[0][2].value == 2011  # numeric preserved
    assert body[1][1].value == "De Feo"


def test_many_cardinality_records_each_instance():
    spec = build_tidy_tables(_layout((_model_table(),)))[0]
    body = spec.rows[1:]
    assert [r[0].value for r in body] == ["Gaca, 2011 — Model 1", "Gaca, 2011 — Model 2"]
    assert body[0][1].value == "Logistic regression"
    assert body[1][1].value == "Cox model"


def test_empty_tidy_tables_returns_empty_list():
    assert build_tidy_tables(_layout(())) == []
