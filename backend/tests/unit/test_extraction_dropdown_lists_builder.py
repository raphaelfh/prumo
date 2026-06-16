"""Unit tests for the Dropdown lists sub-builder. Pure — no DB."""

from __future__ import annotations

from uuid import uuid4

from app.models.extraction import ExtractionFieldType
from app.services.exports.extraction.dropdown_lists import build_dropdown_lists
from app.services.extraction_export_service import (
    AllowedValue,
    ExportLayout,
    ExportMode,
    ExportNotes,
    FieldDictEntry,
)


def _layout(entries: tuple[FieldDictEntry, ...]) -> ExportLayout:
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
        data_dictionary=entries,
    )


def _entry(label, type_, values) -> FieldDictEntry:
    return FieldDictEntry(
        field_id=uuid4(),
        section_label="S",
        label=label,
        type=type_,
        unit=None,
        description=None,
        allowed_values=tuple(AllowedValue(value=v, label=v) for v in values),
        is_required=False,
        allow_other=False,
    )


def test_dropdown_lists_one_column_per_select_field():
    entries = (
        _entry("Study design", ExtractionFieldType.SELECT, ["Cohort", "RCT", "Case-control"]),
        _entry("Outcomes", ExtractionFieldType.MULTISELECT, ["Mortality", "MI"]),
        # a non-select field with no allowed_values must NOT appear:
        _entry("Free text", ExtractionFieldType.TEXT, []),
    )
    spec = build_dropdown_lists(_layout(entries))
    assert spec is not None
    header = [c.value for c in spec.rows[0]]
    assert header == ["Study design", "Outcomes"]
    # column 0 values down the rows
    col0 = [spec.rows[r][0].value for r in range(1, len(spec.rows))]
    assert col0[:3] == ["Cohort", "RCT", "Case-control"]
    # column 1 shorter — padded with blank below its options
    assert spec.rows[1][1].value == "Mortality"
    assert spec.rows[2][1].value == "MI"
    assert spec.rows[3][1].value is None


def test_dropdown_lists_returns_none_when_no_allowed_values():
    entries = (_entry("Free text", ExtractionFieldType.TEXT, []),)
    assert build_dropdown_lists(_layout(entries)) is None
