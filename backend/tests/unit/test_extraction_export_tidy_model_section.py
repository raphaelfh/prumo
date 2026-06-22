"""Regression: cardinality=ONE MODEL_SECTION tidy tables must source rows from
``model_instances`` (role-first), mirroring the matrix builder. Pure — no DB.

Bug (post-merge review 2026-06-21): ``_build_tidy_tables`` read
``section_instances`` in the cardinality=ONE branch, but model-section
instances live in ``model_instances``. Every production CHARMS model section
(model_development / model_performance / model_validation / model_results /
model_interpretation — all ``cardinality='one'``) therefore rendered with zero
rows, silently dropping every prediction-model value from the publication
tidy-table sheet while the matrix sheet showed them correctly.
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


def _model_section(field_id):
    return SectionDescriptor(
        entity_type_id=uuid4(),
        label="Model development",
        role=ExtractionEntityRole.MODEL_SECTION,
        parent_entity_type_id=uuid4(),
        fields=(
            FieldDescriptor(
                field_id=field_id,
                label="Method",
                type=ExtractionFieldType.TEXT,
                allowed_values=(),
                parent_section_id=uuid4(),
            ),
        ),
        # Production model sections are cardinality ONE; the N-model fan-out
        # is sourced from model_instances, never from cardinality MANY.
        cardinality=ExtractionCardinality.ONE,
    )


def test_cardinality_one_model_section_emits_one_row_per_model():
    field_id = uuid4()
    section = _model_section(field_id)
    run_id = uuid4()
    model_iid = uuid4()
    article = ArticleDescriptor(
        article_id=uuid4(),
        header_label="Gaca, 2011",
        run_id=run_id,
        run_stage=None,
        version_id=None,
        model_instances=(model_iid,),
        section_instances={},  # model sections never populate section_instances
    )
    value_map = {(run_id, model_iid, field_id): "Logistic regression"}

    tables = _build_tidy_tables((section,), (article,), value_map, ExportMode.CONSENSUS)

    assert len(tables) == 1
    rows = tables[0].rows
    assert len(rows) == 1, "cardinality=ONE model section must emit a row from model_instances"
    assert rows[0].instance_id == model_iid
    assert rows[0].values == ("Logistic regression",)


def test_cardinality_many_study_section_fans_out_over_section_instances():
    # Non-model MANY branch: one row per section_instance (not model_instances).
    field_id = uuid4()
    section = SectionDescriptor(
        entity_type_id=uuid4(),
        label="Outcomes",
        role=ExtractionEntityRole.STUDY_SECTION,
        parent_entity_type_id=None,
        fields=(
            FieldDescriptor(
                field_id=field_id,
                label="Name",
                type=ExtractionFieldType.TEXT,
                allowed_values=(),
                parent_section_id=uuid4(),
            ),
        ),
        cardinality=ExtractionCardinality.MANY,
    )
    run_id = uuid4()
    i1, i2 = uuid4(), uuid4()
    article = ArticleDescriptor(
        article_id=uuid4(),
        header_label="Gaca, 2011",
        run_id=run_id,
        run_stage=None,
        version_id=None,
        model_instances=(),
        section_instances={section.entity_type_id: (i1, i2)},
    )
    value_map = {
        (run_id, i1, field_id): "OS",
        (run_id, i2, field_id): "PFS",
    }

    tables = _build_tidy_tables((section,), (article,), value_map, ExportMode.CONSENSUS)

    rows = tables[0].rows
    assert [r.values[0] for r in rows] == ["OS", "PFS"]
    assert [r.record_label for r in rows] == [
        "Gaca, 2011 — Outcomes 1",
        "Gaca, 2011 — Outcomes 2",
    ]


def test_cardinality_one_model_section_fans_out_over_multiple_models():
    field_id = uuid4()
    section = _model_section(field_id)
    run_id = uuid4()
    m1, m2 = uuid4(), uuid4()
    article = ArticleDescriptor(
        article_id=uuid4(),
        header_label="Gaca, 2011",
        run_id=run_id,
        run_stage=None,
        version_id=None,
        model_instances=(m1, m2),
        section_instances={},
    )
    value_map = {
        (run_id, m1, field_id): "Logistic regression",
        (run_id, m2, field_id): "Cox model",
    }

    tables = _build_tidy_tables((section,), (article,), value_map, ExportMode.CONSENSUS)

    rows = tables[0].rows
    assert [r.values[0] for r in rows] == ["Logistic regression", "Cox model"]
    assert [r.record_label for r in rows] == [
        "Gaca, 2011 — Model 1",
        "Gaca, 2011 — Model 2",
    ]
