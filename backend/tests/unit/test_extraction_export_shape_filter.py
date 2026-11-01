"""Output-shape filter over ``_ordered_specs`` (§3).

Three shapes are subsets of the sheets the workbook already builds. The
filter keys on BUILDER IDENTITY, not on sheet title: ``SheetSpec`` carries
only a title, and a title-matching filter would misfire on an instrument
with a section literally named "Codebook". These tests pin both
halves — the emitted sheet set, and that a filtered-out builder is never
called (the filter must save the work, not discard it afterwards).
"""

from __future__ import annotations

import io
from dataclasses import replace
from datetime import UTC, datetime
from uuid import UUID, uuid4

from openpyxl import load_workbook

from app.models.extraction import ExtractionFieldType
from app.services.exports.codebook_model import VersionSections, build_codebook_entries
from app.services.exports.descriptors import value_key
from app.services.exports.extraction import workbook as workbook_module
from app.services.exports.extraction.sheet_spec import Cell, SheetSpec
from app.services.exports.extraction.workbook import (
    ExportShape,
    build_workbook,
    shape_needs_articles,
)
from app.services.exports.extraction_snapshot_reader import AllowedValue
from app.services.exports.values import ExportValue, build_option_labels, to_export_value
from app.services.extraction_export_service import (
    AppraisalModel,
    AppraisalRow,
    ArticleDescriptor,
    ExportLayout,
    ExportMode,
    FieldDescriptor,
    SectionDescriptor,
)

_SECTION_ID = UUID("11111111-1111-1111-1111-111111111111")
_FIELD_ID = UUID("22222222-2222-2222-2222-222222222222")
_RISK = FieldDescriptor(
    field_id=_FIELD_ID, label="Risk of bias", type=ExtractionFieldType.SELECT, allowed_values=()
)
_ARTICLE_ID = UUID("33333333-3333-3333-3333-333333333333")


def _tv(raw: object) -> ExportValue:
    """``raw`` typed against a TEXT field, as a value-map entry."""
    return to_export_value(
        {"value": raw},
        FieldDescriptor(
            field_id=uuid4(), label="T", type=ExtractionFieldType.TEXT, allowed_values=()
        ),
        {},
    )


def _every_sheet_layout() -> ExportLayout:
    """A layout that makes EVERY conditional builder emit.

    Appraisal, Options and AI metadata are each conditional; a layout
    that skipped any of them would let a shape look correct for the wrong
    reason (an absent sheet rather than a filtered one).
    """
    field = FieldDescriptor(
        field_id=_FIELD_ID,
        label="Risk of bias",
        type=ExtractionFieldType.SELECT,
        allowed_values=(AllowedValue("Low", "Low"), AllowedValue("High", "High")),
    )
    section = SectionDescriptor(
        entity_type_id=_SECTION_ID,
        label="Participants",
        parent_entity_type_id=None,
        fields=(field,),
    )
    instance_id = uuid4()
    article = ArticleDescriptor(
        article_id=_ARTICLE_ID,
        article_label="Gaca, 2011",
        run_id=uuid4(),
        version_id=None,
        entries={(_SECTION_ID, None): (instance_id,)},
    )
    return ExportLayout(
        project_name="P",
        template_name="PROBAST",
        template_version=1,
        sections=(section,),
        articles=(article,),
        reviewers=(),
        mode=ExportMode.CONSENSUS,
        include_ai_metadata=True,
        anonymize_reviewer_names=False,
        generated_at=datetime(2026, 1, 1, tzinfo=UTC),
        value_map={value_key(article.run_id, instance_id, _FIELD_ID): _tv("Low")},
        codebook=build_codebook_entries(
            VersionSections(uuid4(), 1, (section,), {}), (), build_option_labels((section,))
        ),
        appraisal=AppraisalModel(
            domain_section_ids=(_SECTION_ID,),
            domain_labels=("Participants",),
            domain_fields=(_RISK,),
            rows=(
                AppraisalRow(
                    article_id=_ARTICLE_ID,
                    record_label="Gaca, 2011",
                    domain_verdicts=(_tv("Low"),),
                    overall="Low",
                    per_reviewer_overall={},
                ),
            ),
        ),
    )


def _sheetnames(shape: ExportShape) -> list[str]:
    data = build_workbook(_every_sheet_layout(), shape, include_matrix=True)
    return load_workbook(io.BytesIO(data)).sheetnames


def test_complete_emits_every_sheet() -> None:
    assert _sheetnames(ExportShape.COMPLETE) == [
        "README",
        "Summary",
        "Matrix",
        "Articles",
        "Data",
        "AI proposals",
        "Appraisal",
        "Codebook",
        "Options",
    ]


def test_dictionary_keeps_readme_and_the_catalogue_only() -> None:
    assert _sheetnames(ExportShape.DICTIONARY) == [
        "README",
        "Codebook",
        "Options",
    ]


def test_publication_keeps_readme_the_level_sheets_and_the_appraisal() -> None:
    assert _sheetnames(ExportShape.PUBLICATION) == [
        "README",
        "Articles",
        "Appraisal",
    ]


def test_readme_is_in_every_shape() -> None:
    """It carries the template identity, provenance and glyph legend."""
    for shape in ExportShape:
        assert "README" in _sheetnames(shape)


def _spy_builders(monkeypatch, shape: ExportShape) -> set[str]:
    """Record which sub-builders ``_ordered_specs`` actually invokes."""
    called: set[str] = set()

    def _spy(name: str, result):
        def _fn(_layout, _titles, *_shape):
            called.add(name)
            return result

        return _fn

    one = SheetSpec(title="x", rows=((Cell("x"),),))
    for role, fn_name, result in (
        ("front_matter", "build_front_matter", one),
        ("summary", "build_summary", one),
        ("matrix", "build_matrix", one),
        ("appraisal_summary", "build_appraisal_summary", one),
        ("codebook", "build_codebook", one),
        ("options", "build_options", one),
        ("ai_proposals", "build_ai_proposals", one),
    ):
        monkeypatch.setattr(workbook_module, fn_name, _spy(role, result))
    monkeypatch.setattr(workbook_module, "build_level_tables", _spy("level_tables", []))

    layout = _every_sheet_layout()
    titles = workbook_module.allocate_titles(layout, shape, include_matrix=True)
    workbook_module._ordered_specs(layout, shape, titles)
    return called


def test_dictionary_shape_never_calls_the_filtered_out_builders(monkeypatch) -> None:
    called = _spy_builders(monkeypatch, ExportShape.DICTIONARY)
    assert called == {"front_matter", "codebook", "options"}


def test_publication_shape_never_calls_the_filtered_out_builders(monkeypatch) -> None:
    called = _spy_builders(monkeypatch, ExportShape.PUBLICATION)
    assert called == {"front_matter", "level_tables", "appraisal_summary"}


def test_complete_shape_calls_every_builder(monkeypatch) -> None:
    called = _spy_builders(monkeypatch, ExportShape.COMPLETE)
    assert called == {
        "front_matter",
        "summary",
        "matrix",
        "level_tables",
        "appraisal_summary",
        "codebook",
        "options",
        "ai_proposals",
    }


# ---------------------------------------------------------------------------
# A dictionary-only workbook describes the INSTRUMENT, so it must build before
# anyone has finalized a run — the state a project is in while it is still
# being wired up.
# ---------------------------------------------------------------------------


def _no_article_layout() -> ExportLayout:
    """The template resolved for a project with zero eligible articles."""
    layout = _every_sheet_layout()
    return replace(layout, articles=(), appraisal=None, value_map={})


def test_dictionary_shape_builds_with_no_articles() -> None:
    data = build_workbook(_no_article_layout(), ExportShape.DICTIONARY, include_matrix=True)
    wb = load_workbook(io.BytesIO(data))
    assert wb.sheetnames == ["README", "Codebook", "Options"]
    # The catalogue is the point: it must carry the field, not just a header.
    assert any(
        "Risk of bias" in [str(c) for c in row]
        for row in wb["Codebook"].iter_rows(values_only=True)
    )


def test_only_the_dictionary_shape_is_free_of_article_values() -> None:
    assert shape_needs_articles(ExportShape.COMPLETE) is True
    assert shape_needs_articles(ExportShape.PUBLICATION) is True
    assert shape_needs_articles(ExportShape.DICTIONARY) is False
