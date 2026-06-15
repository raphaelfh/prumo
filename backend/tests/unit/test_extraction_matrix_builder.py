"""Unit tests for the extraction matrix builder fan-out (cardinality, any role)."""

from __future__ import annotations

import io
from datetime import UTC, datetime
from uuid import uuid4

from openpyxl import load_workbook

from app.models.extraction import (
    ExtractionCardinality,
    ExtractionEntityRole,
    ExtractionFieldType,
)
from app.services.exports.extraction_xlsx_builder import build_workbook
from app.services.extraction_export_service import (
    ArticleDescriptor,
    ExportLayout,
    ExportMode,
    ExportNotes,
    FieldDescriptor,
    SectionDescriptor,
)


def _layout(sections, articles, value_map):
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
        notes=ExportNotes(generated_at=datetime(2026, 6, 14, tzinfo=UTC)),
        value_map=value_map,
    )


def test_many_cardinality_study_section_fans_out_one_subcolumn_per_instance():
    eid = uuid4()
    fid = uuid4()
    field = FieldDescriptor(
        field_id=fid,
        label="Index test name",
        type=ExtractionFieldType.TEXT,
        allowed_values=(),
        parent_section_id=eid,
    )
    section = SectionDescriptor(
        entity_type_id=eid,
        label="Index tests",
        role=ExtractionEntityRole.STUDY_SECTION,  # NOT a model section
        parent_entity_type_id=None,
        fields=(field,),
        cardinality=ExtractionCardinality.MANY,
    )
    inst_a, inst_b = uuid4(), uuid4()
    run_id = uuid4()
    article = ArticleDescriptor(
        article_id=uuid4(),
        header_label="Gaca, 2011",
        run_id=run_id,
        run_stage=None,
        version_id=None,
        model_instances=(),
        section_instances={eid: (inst_a, inst_b)},
    )
    data = build_workbook(
        _layout(
            (section,),
            (article,),
            {
                (run_id, inst_a, fid): "CT angiography",
                (run_id, inst_b, fid): "MRI",
            },
        )
    )
    ws = load_workbook(io.BytesIO(data))["CHARMS"]

    # Article header spans TWO instance sub-columns (merged C1:D1).
    assert ws.cell(row=1, column=3).value == "Gaca, 2011"
    assert ws.cell(row=1, column=4).value is None  # trailing merged cell

    field_row = None
    for r in range(2, ws.max_row + 1):
        if ws.cell(row=r, column=2).value == "Index test name":
            field_row = r
            break
    assert field_row is not None
    # One distinct value per instance — NO collapse.
    assert ws.cell(row=field_row, column=3).value == "CT angiography"
    assert ws.cell(row=field_row, column=4).value == "MRI"
