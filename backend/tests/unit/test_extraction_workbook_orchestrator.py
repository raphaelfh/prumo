"""Orchestrator: spec-order sheet assembly."""

from __future__ import annotations

import io
from dataclasses import replace
from uuid import uuid4

import pytest
from openpyxl import load_workbook

from app.models.extraction import ExtractionCardinality, ExtractionFieldType
from app.services.exports.extraction.sheet_spec import RESERVED_TITLES
from app.services.exports.extraction.workbook import (
    ExportShape,
    allocate_titles,
    build_workbook,
)
from app.services.exports.values import to_export_value
from app.services.extraction_export_service import (
    AppraisalModel,
    AppraisalRow,
    ArticleDescriptor,
    ExportLayout,
    ExportMode,
    ExportNotes,
    FieldDescriptor,
    SectionDescriptor,
)
from tests.unit.helpers.export_layouts import make_layout


def _one_field_layout(*, include_ai: bool, n_articles: int = 1) -> ExportLayout:
    sec_id = uuid4()
    field = FieldDescriptor(
        field_id=uuid4(),
        label="Source",
        type=ExtractionFieldType.TEXT,
        allowed_values=(),
    )
    section = SectionDescriptor(
        entity_type_id=sec_id,
        label="Source of data",
        parent_entity_type_id=None,
        fields=(field,),
    )
    articles = tuple(
        ArticleDescriptor(
            article_id=uuid4(),
            article_label=f"Art {i}",
            run_id=uuid4(),
            version_id=None,
            entries={(sec_id, None): (uuid4(),)},
        )
        for i in range(n_articles)
    )
    return ExportLayout(
        project_name="P",
        template_name="Matrix",
        template_version=1,
        sections=(section,),
        articles=articles,
        reviewers=(),
        mode=ExportMode.CONSENSUS,
        include_ai_metadata=include_ai,
        anonymize_reviewer_names=False,
        notes=ExportNotes(),
        value_map={},
    )


def _many(name: str, *, order: int) -> SectionDescriptor:
    """A fielded repeating section: one level sheet of its own."""
    return SectionDescriptor(
        entity_type_id=uuid4(),
        label=name,
        parent_entity_type_id=None,
        fields=(
            FieldDescriptor(
                field_id=uuid4(),
                label="Text",
                type=ExtractionFieldType.TEXT,
                allowed_values=(),
                name="text",
            ),
        ),
        cardinality=ExtractionCardinality.MANY,
        sort_order=order,
        name=name,
    )


def _art() -> ArticleDescriptor:
    return ArticleDescriptor(
        article_id=uuid4(), article_label="Art 2020", run_id=uuid4(), version_id=None
    )


def _appraisal_model() -> AppraisalModel:
    risk = FieldDescriptor(
        field_id=uuid4(), label="RoB", type=ExtractionFieldType.SELECT, allowed_values=()
    )
    return AppraisalModel(
        domain_section_ids=(uuid4(),),
        domain_labels=("Participants",),
        domain_fields=(risk,),
        rows=(
            AppraisalRow(
                article_id=uuid4(),
                record_label="Gaca, 2011",
                domain_verdicts=(to_export_value({"value": "High"}, risk, {}),),
                overall="High",
                per_reviewer_overall={},
            ),
        ),
    )


def test_sheet_order_without_ai() -> None:
    # §3 order: README → Summary → Matrix → Articles → Codebook. The fielded
    # root ONE section lands on Articles; there is no repeating level and no
    # coded option, so no Options sheet.
    data = build_workbook(
        _one_field_layout(include_ai=False), ExportShape.COMPLETE, include_matrix=True
    )
    wb = load_workbook(io.BytesIO(data))
    assert wb.sheetnames == ["README", "Summary", "Matrix", "Articles", "Codebook"]


def test_sheet_order_with_ai() -> None:
    # §3: AI proposals sits after the level sheets and before the Codebook.
    data = build_workbook(
        _one_field_layout(include_ai=True), ExportShape.COMPLETE, include_matrix=True
    )
    wb = load_workbook(io.BytesIO(data))
    assert wb.sheetnames == [
        "README",
        "Summary",
        "Matrix",
        "Articles",
        "AI proposals",
        "Codebook",
    ]


def test_sections_named_history_and_data_get_suffixed_titles() -> None:
    layout = make_layout(
        sections=(_many("history", order=0), _many("data", order=1)), articles=(_art(),)
    )
    wb = load_workbook(
        io.BytesIO(build_workbook(layout, ExportShape.COMPLETE, include_matrix=True))
    )
    assert wb.sheetnames == [
        "README",
        "Summary",
        "Matrix",
        "Articles",
        "history (2)",
        "data (2)",
        "Codebook",
    ]


@pytest.mark.parametrize("shape", list(ExportShape))
@pytest.mark.parametrize("include_ai", [False, True])
def test_readme_contents_equal_sheetnames_for_every_shape(
    shape: ExportShape, include_ai: bool
) -> None:  # Review Focus 1
    layout = make_layout(
        sections=(_many("Sec", order=0),), articles=(_art(),), include_ai_metadata=include_ai
    )
    assert layout.front_matter is None  # contents must not depend on front_matter
    titles = allocate_titles(layout, shape, include_matrix=True)
    wb = load_workbook(io.BytesIO(build_workbook(layout, shape, include_matrix=True)))
    assert tuple(wb.sheetnames) == titles.order
    readme = [r[1] for r in wb["README"].iter_rows(values_only=True) if r[0] in ("", None) and r[1]]
    assert tuple(readme[: len(titles.order)]) == titles.order


def test_fixed_titles_are_the_reserved_names() -> None:  # Review Focus 6, R7
    layout = replace(_one_field_layout(include_ai=True), appraisal=_appraisal_model())
    t = allocate_titles(layout, ExportShape.COMPLETE, include_matrix=True)
    assert (t.fixed["matrix"], t.fixed["appraisal_summary"], t.fixed["ai_proposals"]) == (
        "Matrix",
        "Appraisal",
        "AI proposals",
    )
    assert {t.fixed[r] for r in ("matrix", "appraisal_summary", "ai_proposals")} <= set(
        RESERVED_TITLES
    )
