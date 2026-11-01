"""Unit tests for the extraction matrix builder fan-out (cardinality, any role).

The lower block (``build_matrix`` / SheetSpec assertions) is the §5.4
sub-builder lift: ``_write_main_sheet`` re-expressed as a pure ``SheetSpec``
producer, asserted on the rendered worksheet so the split keeps cell values,
merged record headers and study-section repeat-not-merge identical.
"""

from __future__ import annotations

import io
from dataclasses import replace
from datetime import UTC, datetime
from uuid import UUID, uuid4

from openpyxl import Workbook, load_workbook

from app.models.extraction import (
    ExtractionCardinality,
    ExtractionFieldType,
)
from app.services.exports.descriptors import value_key
from app.services.exports.extraction.matrix import build_matrix
from app.services.exports.extraction.sheet_spec import _render_sheet_spec
from app.services.exports.extraction.workbook import ExportShape, allocate_titles, build_workbook
from app.services.exports.values import ExportValue, build_option_labels, to_export_value
from app.services.extraction_export_service import (
    AllowedValue,
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
    )
    section = SectionDescriptor(
        entity_type_id=eid,
        label="Index tests",
        # NOT a model section
        parent_entity_type_id=None,
        fields=(field,),
        cardinality=ExtractionCardinality.MANY,
    )
    inst_a, inst_b = uuid4(), uuid4()
    run_id = uuid4()
    article = ArticleDescriptor(
        article_id=uuid4(),
        article_label="Gaca, 2011",
        run_id=run_id,
        version_id=None,
        entries={(eid, None): (inst_a, inst_b)},
    )
    data = build_workbook(
        _layout(
            (section,),
            (article,),
            {
                value_key(run_id, inst_a, fid): to_export_value("CT angiography", field, {}),
                value_key(run_id, inst_b, fid): to_export_value("MRI", field, {}),
            },
        ),
        ExportShape.COMPLETE,
        include_matrix=True,
    )
    ws = load_workbook(io.BytesIO(data))["Matrix"]

    # Article header spans TWO instance sub-columns (merged C1:D1).
    assert ws.cell(row=1, column=3).value == "Gaca, 2011"
    assert ws.cell(row=1, column=4).value is None  # trailing merged cell

    field_row = None
    for r in range(2, ws.max_row + 1):
        # Hierarchical numbering prefixes the section.field index (§9).
        if ws.cell(row=r, column=2).value == "1.1 Index test name":
            field_row = r
            break
    assert field_row is not None
    # One distinct value per instance — NO collapse.
    assert ws.cell(row=field_row, column=3).value == "CT angiography"
    assert ws.cell(row=field_row, column=4).value == "MRI"


# ----------------------------------------------------------------------
# §5.4 sub-builder: build_matrix -> SheetSpec, asserted on the rendered
# worksheet so the verbatim lift keeps cell values / merges identical.
# ----------------------------------------------------------------------


def _render_matrix(layout: ExportLayout):
    spec = build_matrix(layout, allocate_titles(layout, ExportShape.COMPLETE, include_matrix=True))
    wb = Workbook()
    wb.remove(wb.active)
    ws = wb.create_sheet(title="tmp")
    _render_sheet_spec(ws, spec)
    return ws


def _spec_field(label: str, ftype: ExtractionFieldType) -> FieldDescriptor:
    return FieldDescriptor(
        field_id=uuid4(),
        label=label,
        type=ftype,
        allowed_values=(),
    )


def _spec_layout(
    *,
    sections: tuple[SectionDescriptor, ...],
    articles: tuple[ArticleDescriptor, ...],
    value_map: dict | None = None,
    mode: ExportMode = ExportMode.CONSENSUS,
    reviewers: tuple = (),
    reviewer_id: UUID | None = None,
) -> ExportLayout:
    return ExportLayout(
        project_name="P",
        template_name="My Template",
        template_version=1,
        sections=sections,
        articles=articles,
        reviewers=reviewers,
        mode=mode,
        include_ai_metadata=False,
        anonymize_reviewer_names=False,
        notes=ExportNotes(),
        value_map=value_map or {},
        reviewer_id=reviewer_id,
    )


def test_header_block_labels() -> None:
    sec_id = uuid4()
    field = _spec_field("1.1 Source", ExtractionFieldType.TEXT)
    section = SectionDescriptor(
        entity_type_id=sec_id,
        label="1. Source of data",
        parent_entity_type_id=None,
        fields=(field,),
    )
    run_id, inst_id, art_id = uuid4(), uuid4(), uuid4()
    article = ArticleDescriptor(
        article_id=art_id,
        article_label="Smith, 2020",
        run_id=run_id,
        version_id=None,
        entries={(sec_id, None): (inst_id,)},
    )
    layout = _spec_layout(
        sections=(section,),
        articles=(article,),
        value_map={
            value_key(run_id, inst_id, field.field_id): to_export_value("Registry", field, {})
        },
    )
    ws = _render_matrix(layout)
    assert ws.cell(row=1, column=1).value == "Section"
    assert ws.cell(row=1, column=2).value == "Field"
    assert ws.cell(row=1, column=3).value == "Smith, 2020"
    # field value rendered in column C under the article.
    assert "Registry" in {ws.cell(row=r, column=3).value for r in range(1, ws.max_row + 1)}


def test_empty_articles_placeholder() -> None:
    layout = _spec_layout(sections=(), articles=())
    ws = _render_matrix(layout)
    assert ws.cell(row=1, column=1).value == "(No eligible articles for the selected mode.)"


def test_study_section_repeats_not_merges_across_models() -> None:
    # The model fan-out width is driven by a MODEL_SECTION in the layout
    # (verbatim ``_article_fanout_count`` semantics — model_instances alone
    # does NOT widen the article when no model section is present). A study
    # section's value must then repeat identically across every model
    # sub-column (FR-010 repeat-not-merge), never merged.
    study_id = uuid4()
    model_id = uuid4()
    study_field = _spec_field("Author", ExtractionFieldType.TEXT)
    model_field = _spec_field("Method", ExtractionFieldType.TEXT)
    study = SectionDescriptor(
        entity_type_id=study_id,
        label="Study",
        parent_entity_type_id=None,
        fields=(study_field,),
    )
    # Was `role=MODEL_SECTION, parent=None` — a shape 0016 forbids (a model
    # section's parent must BE the container) that only rendered because role
    # was read before structure. The repeating ROOT group is the real shape
    # with the same two sub-columns.
    model = SectionDescriptor(
        entity_type_id=model_id,
        label="Model development",
        parent_entity_type_id=None,
        fields=(model_field,),
        cardinality=ExtractionCardinality.MANY,
    )
    run_id, study_inst = uuid4(), uuid4()
    m1, m2 = uuid4(), uuid4()
    article = ArticleDescriptor(
        article_id=uuid4(),
        article_label="A",
        run_id=run_id,
        version_id=None,
        entries={(model_id, None): (m1, m2), (study_id, None): (study_inst,)},
    )
    layout = _spec_layout(
        sections=(study, model),
        articles=(article,),
        value_map={
            value_key(run_id, study_inst, study_field.field_id): to_export_value(
                "Doe", study_field, {}
            )
        },
    )
    ws = _render_matrix(layout)
    # Study value repeated across BOTH model sub-columns (C and D), not merged.
    row = next(r for r in range(1, ws.max_row + 1) if ws.cell(row=r, column=3).value == "Doe")
    assert ws.cell(row=row, column=4).value == "Doe"
    merged = {str(m) for m in ws.merged_cells.ranges}
    assert f"C{row}:D{row}" not in merged


def test_matrix_structural_styling() -> None:
    sec_id = uuid4()
    f1 = _spec_field("Source", ExtractionFieldType.TEXT)
    f2 = _spec_field("Year", ExtractionFieldType.TEXT)
    section = SectionDescriptor(
        entity_type_id=sec_id,
        label="Source of data",
        parent_entity_type_id=None,
        fields=(f1, f2),
    )
    run_id, inst_id = uuid4(), uuid4()
    article = ArticleDescriptor(
        article_id=uuid4(),
        article_label="A",
        run_id=run_id,
        version_id=None,
        entries={(sec_id, None): (inst_id,)},
    )
    layout = _spec_layout(sections=(section,), articles=(article,))
    spec = build_matrix(layout, allocate_titles(layout, ExportShape.COMPLETE, include_matrix=True))

    # Freeze locks label block (A,B) + header row -> first scrollable cell C2.
    assert spec.freeze == "C2"
    assert spec.tab_color is not None

    # Header row 1 is bold.
    assert spec.rows[0][0].style is not None and spec.rows[0][0].style.bold

    # The section-band row is bold + filled across the row.
    band = next(
        row
        for row in spec.rows
        if row[0].value == "1. Source of data" or row[0].value == "Source of data"
    )
    assert band[0].style is not None and band[0].style.bold
    assert band[0].style.fill is not None

    # Hierarchical numbering on field labels: section 1 -> "1.1 Source".
    labels = {row[1].value for row in spec.rows if row[1].value is not None}
    assert "1.1 Source" in labels
    assert "1.2 Year" in labels


def test_matrix_freeze_all_users_uses_two_header_rows() -> None:
    from app.services.extraction_export_service import ReviewerDescriptor

    sec_id = uuid4()
    f1 = _spec_field("Source", ExtractionFieldType.TEXT)
    section = SectionDescriptor(
        entity_type_id=sec_id,
        label="Source",
        parent_entity_type_id=None,
        fields=(f1,),
    )
    rid = uuid4()
    run_id, inst_id = uuid4(), uuid4()
    article = ArticleDescriptor(
        article_id=uuid4(),
        article_label="A",
        run_id=run_id,
        version_id=None,
        entries={(sec_id, None): (inst_id,)},
    )
    layout = _spec_layout(
        sections=(section,),
        articles=(article,),
        mode=ExportMode.ALL_USERS,
        reviewers=(ReviewerDescriptor(reviewer_id=rid, display_label="R1"),),
    )
    spec = build_matrix(layout, allocate_titles(layout, ExportShape.COMPLETE, include_matrix=True))
    assert spec.freeze == "C3"


def _value_cell(ws, field: FieldDescriptor):
    """Return the rendered cell value for ``field`` in the article column (C)."""
    label_prefix = field.label
    for r in range(1, ws.max_row + 1):
        col_b = ws.cell(row=r, column=2).value
        if col_b is not None and label_prefix in str(col_b):
            return ws.cell(row=r, column=3).value
    raise AssertionError(f"no row found for field {field.label!r}")


def _single_field_layout(
    field: FieldDescriptor, value: ExportValue, *, sec_id: UUID, rater: UUID | None = None
) -> ExportLayout:
    section = SectionDescriptor(
        entity_type_id=sec_id,
        label="Section",
        parent_entity_type_id=None,
        fields=(field,),
    )
    run_id, inst_id = uuid4(), uuid4()
    article = ArticleDescriptor(
        article_id=uuid4(),
        article_label="A",
        run_id=run_id,
        version_id=None,
        entries={(sec_id, None): (inst_id,)},
    )
    return _spec_layout(
        sections=(section,),
        articles=(article,),
        value_map={value_key(run_id, inst_id, field.field_id, rater): value},
    )


def test_boolean_false_value_renders_no_not_yes() -> None:
    # Regression for the boolean-inversion data-corruption: a stored ``False``
    # must render "No", never a truthy "Yes".
    sec_id = uuid4()
    field = _spec_field("BoolFlag", ExtractionFieldType.BOOLEAN)
    ws_false = _render_matrix(
        _single_field_layout(field, to_export_value({"value": False}, field, {}), sec_id=sec_id)
    )
    assert _value_cell(ws_false, field) == "No"
    ws_true = _render_matrix(
        _single_field_layout(field, to_export_value({"value": True}, field, {}), sec_id=sec_id)
    )
    assert _value_cell(ws_true, field) == "Yes"


def test_select_value_renders_as_string() -> None:
    sec_id = uuid4()
    field = _spec_field("Choice", ExtractionFieldType.SELECT)
    ws = _render_matrix(
        _single_field_layout(field, to_export_value({"value": "Cohort"}, field, {}), sec_id=sec_id)
    )
    assert _value_cell(ws, field) == "Cohort"


def test_multiselect_list_value_joins_with_semicolons() -> None:
    sec_id = uuid4()
    field = _spec_field("Tags", ExtractionFieldType.MULTISELECT)
    value = to_export_value({"value": ["age", "sex", "BMI"]}, field, {})
    ws = _render_matrix(_single_field_layout(field, value, sec_id=sec_id))
    assert _value_cell(ws, field) == "age; sex; BMI"


def test_select_cell_shows_the_option_label_not_the_code() -> None:
    sec_id = uuid4()
    field = FieldDescriptor(
        field_id=uuid4(),
        label="Risk",
        type=ExtractionFieldType.SELECT,
        allowed_values=(AllowedValue("L", "Low"), AllowedValue("H", "High")),
    )
    labels = build_option_labels(
        [
            SectionDescriptor(
                entity_type_id=sec_id, label="Section", parent_entity_type_id=None, fields=(field,)
            )
        ]
    )
    ws = _render_matrix(
        _single_field_layout(field, to_export_value({"value": "L"}, field, labels), sec_id=sec_id)
    )
    assert _value_cell(ws, field) == "Low"


def test_single_user_cell_reads_the_reviewer_slot() -> None:
    sec_id, r = uuid4(), uuid4()
    field = _spec_field("N", ExtractionFieldType.TEXT)
    layout = replace(
        _single_field_layout(
            field, to_export_value({"value": "mine"}, field, {}), sec_id=sec_id, rater=r
        ),
        mode=ExportMode.SINGLE_USER,
        reviewer_id=r,
    )
    assert _value_cell(_render_matrix(layout), field) == "mine"


def test_matrix_module_has_no_legacy_builder_dependency() -> None:
    import ast
    import pathlib

    src = pathlib.Path("app/services/exports/extraction/matrix.py").read_text(encoding="utf-8")
    tree = ast.parse(src)
    imported = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom) and node.module:
            imported.add(node.module)
    assert "app.services.exports.extraction_xlsx_builder" not in imported


def test_matrix_bands_a_fieldless_group_that_owns_fields() -> None:
    """Rule 2: a fieldless MANY is skipped only when no descendant has fields."""
    groups = SectionDescriptor(
        entity_type_id=uuid4(),
        label="Groups",
        parent_entity_type_id=None,
        fields=(),
        cardinality=ExtractionCardinality.MANY,
    )
    items = SectionDescriptor(
        entity_type_id=uuid4(),
        label="Items",
        parent_entity_type_id=groups.entity_type_id,
        fields=(_spec_field("Name", ExtractionFieldType.TEXT),),
        cardinality=ExtractionCardinality.MANY,
    )
    e1, i1 = uuid4(), uuid4()
    article = ArticleDescriptor(
        article_id=uuid4(),
        article_label="Smith, 2020",
        run_id=uuid4(),
        version_id=None,
        entries={(groups.entity_type_id, None): (e1,), (items.entity_type_id, e1): (i1,)},
    )
    ws = _render_matrix(_spec_layout(sections=(groups, items), articles=(article,)))
    bands = [
        v for r in range(2, ws.max_row + 1) if isinstance(v := ws.cell(row=r, column=1).value, str)
    ]
    assert bands == ["1. Groups", "2. Items"]
