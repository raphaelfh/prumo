"""The appraisal sheet's overall columns come from the shared rule module.

Templates WITHOUT a ``derived_judgments`` spec keep the legacy single
worst-case ``Overall`` column, byte for byte.
"""

from __future__ import annotations

from typing import Any
from uuid import uuid4

from app.models.extraction import ExtractionEntityRole, ExtractionFieldType
from app.services.exports.extraction.appraisal_summary import build_appraisal_summary
from app.services.extraction_export_service import (
    AppraisalModel,
    AppraisalRow,
    ArticleDescriptor,
    ExportMode,
    ExtractionExportService,
    FieldDescriptor,
    SectionDescriptor,
)


class _Layout:
    def __init__(self, appraisal: Any, mode: ExportMode = ExportMode.CONSENSUS) -> None:
        self.appraisal = appraisal
        self.mode = mode
        self.reviewers: tuple[Any, ...] = ()


def test_legacy_template_keeps_single_overall_column() -> None:
    model = AppraisalModel(
        domain_section_ids=(),
        domain_labels=("D1", "D2"),
        rows=(
            AppraisalRow(
                article_id=None,
                record_label="Art 1",
                domain_verdicts=("Low", "High"),
                overall="High",
                per_reviewer_overall={},
            ),
        ),
    )
    sheet = build_appraisal_summary(_Layout(model))
    assert sheet is not None
    assert tuple(c.value for c in sheet.rows[0]) == ("Record", "D1", "D2", "Overall")
    assert tuple(c.value for c in sheet.rows[1]) == ("Art 1", "Low", "High", "High")


def test_spec_template_emits_named_overall_columns() -> None:
    model = AppraisalModel(
        domain_section_ids=(),
        domain_labels=("Dev D1",),
        rows=(
            AppraisalRow(
                article_id=None,
                record_label="Art 1",
                domain_verdicts=("Low",),
                overall=None,
                per_reviewer_overall={},
                derived_values=("Low", None),
            ),
        ),
        derived_labels=("Overall quality (development)", "Overall RoB (evaluation)"),
    )
    sheet = build_appraisal_summary(_Layout(model))
    assert sheet is not None
    header = tuple(c.value for c in sheet.rows[0])
    assert header == (
        "Record",
        "Dev D1",
        "Overall quality (development)",
        "Overall RoB (evaluation)",
    )
    assert "Overall" not in header[2:], "legacy worst-case column must not double up"
    assert tuple(c.value for c in sheet.rows[1]) == ("Art 1", "Low", "Low", None)


class _Reviewer:
    def __init__(self, label: str) -> None:
        self.reviewer_id = uuid4()
        self.display_label = label


def test_all_users_keeps_per_reviewer_overall_for_a_legacy_template() -> None:
    reviewer = _Reviewer("Ana")
    model = AppraisalModel(
        domain_section_ids=(),
        domain_labels=("D1",),
        rows=(
            AppraisalRow(
                article_id=None,
                record_label="Art 1",
                domain_verdicts=("Low",),
                overall="Low",
                per_reviewer_overall={reviewer.reviewer_id: "High"},
            ),
        ),
    )
    layout = _Layout(model, mode=ExportMode.ALL_USERS)
    layout.reviewers = (reviewer,)
    sheet = build_appraisal_summary(layout)
    assert sheet is not None
    assert tuple(c.value for c in sheet.rows[0]) == ("Record", "D1", "Overall", "Overall — Ana")


def test_all_users_spec_template_does_not_emit_the_legacy_per_reviewer_overall() -> None:
    """The legacy per-reviewer rollup contradicts the derived rule on the SAME
    row: it drops "No information" and blanks, so it prints Low where the
    computed overall (and the banner) say Unclear. A template that defines its
    own overalls has exactly those overalls — no second, laxer answer beside
    them."""
    reviewer = _Reviewer("Ana")
    model = AppraisalModel(
        domain_section_ids=(),
        domain_labels=("Dev D1",),
        rows=(
            AppraisalRow(
                article_id=None,
                record_label="Art 1",
                domain_verdicts=("No information",),
                overall=None,
                # What the lenient legacy rule would have printed here.
                per_reviewer_overall={reviewer.reviewer_id: "Low"},
                derived_values=("Unclear",),
            ),
        ),
        derived_labels=("Overall quality (development)",),
    )
    layout = _Layout(model, mode=ExportMode.ALL_USERS)
    layout.reviewers = (reviewer,)
    sheet = build_appraisal_summary(layout)
    assert sheet is not None
    header = tuple(c.value for c in sheet.rows[0])
    assert header == ("Record", "Dev D1", "Overall quality (development)")
    assert not any(str(label).startswith("Overall — ") for label in header)
    # The row must not carry the contradicting "Low" anywhere.
    assert tuple(c.value for c in sheet.rows[1]) == ("Art 1", "No information", "Unclear")
    # Column widths stay aligned with the emitted header.
    assert len(sheet.column_widths) == len(header)


# --- the model builder itself (the `if spec:` branch) -----------------------


def _section(name: str, label: str, field_name: str) -> tuple[SectionDescriptor, Any]:
    section_id, field_id = uuid4(), uuid4()
    field = FieldDescriptor(
        field_id=field_id,
        label="Risk of bias",
        type=ExtractionFieldType.SELECT,
        allowed_values=("Low", "High", "Unclear"),
        name=field_name,
    )
    return (
        SectionDescriptor(
            entity_type_id=section_id,
            label=label,
            role=ExtractionEntityRole.STUDY_SECTION,
            parent_entity_type_id=None,
            fields=(field,),
            name=name,
        ),
        field,
    )


def _article(run_id: Any, section_instances: dict[Any, tuple[Any, ...]]) -> ArticleDescriptor:
    return ArticleDescriptor(
        article_id=uuid4(),
        header_label="Art 1",
        run_id=run_id,
        version_id=None,
        model_instances=(),
        section_instances=section_instances,
    )


def test_build_appraisal_model_computes_derived_values_from_the_spec() -> None:
    s1, f1 = _section("d1", "D1", "risk_of_bias")
    s2, f2 = _section("d2", "D2", "risk_of_bias")
    run_id, i1, i2 = uuid4(), uuid4(), uuid4()
    article = _article(run_id, {s1.entity_type_id: (i1,), s2.entity_type_id: (i2,)})
    value_map: dict[tuple[Any, ...], Any] = {
        (run_id, i1, f1.field_id): "Low",
        (run_id, i2, f2.field_id): "High",
    }
    spec = {
        "derived_judgments": [
            {
                "id": "overall_rob",
                "label": "Overall RoB",
                "rule": "worst_domain",
                "inputs": [
                    {"section": "d1", "field": "risk_of_bias"},
                    {"section": "d2", "field": "risk_of_bias"},
                ],
            }
        ]
    }

    model = ExtractionExportService._build_appraisal_model(
        sections=(s1, s2),
        articles=(article,),
        reviewers=(),
        value_map=value_map,
        mode=ExportMode.CONSENSUS,
        template_schema=spec,
    )
    assert model is not None
    assert model.derived_labels == ("Overall RoB",)
    assert model.rows[0].derived_values == ("High",)


def test_build_appraisal_model_without_a_spec_has_no_derived_columns() -> None:
    s1, f1 = _section("d1", "D1", "risk_of_bias")
    run_id, i1 = uuid4(), uuid4()
    article = _article(run_id, {s1.entity_type_id: (i1,)})
    model = ExtractionExportService._build_appraisal_model(
        sections=(s1,),
        articles=(article,),
        reviewers=(),
        value_map={(run_id, i1, f1.field_id): "Low"},
        mode=ExportMode.CONSENSUS,
    )
    assert model is not None
    assert model.derived_labels == ()
    assert model.rows[0].derived_values == ()
    assert model.rows[0].overall == "Low"
