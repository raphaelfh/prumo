"""Unit tests for the Data dictionary sub-builder. Pure — no DB."""

from __future__ import annotations

from uuid import uuid4

from app.models.extraction import ExtractionFieldType
from app.services.exports.extraction.data_dictionary import build_data_dictionary
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


def _entries() -> tuple[FieldDictEntry, ...]:
    return (
        FieldDictEntry(
            field_id=uuid4(),
            section_label="1. Source of data",
            label="Source of data",
            type=ExtractionFieldType.SELECT,
            unit=None,
            description="Where the data came from",
            allowed_values=(
                AllowedValue(value="Cohort", label="Cohort"),
                AllowedValue(value="RCT", label="RCT"),
            ),
            is_required=True,
            allow_other=True,
        ),
        FieldDictEntry(
            field_id=uuid4(),
            section_label="3. Sample size",
            label="Number of participants",
            type=ExtractionFieldType.NUMBER,
            unit="patients",
            description="Total enrolled",
            allowed_values=(),
            is_required=False,
            allow_other=False,
        ),
    )


def _header(spec) -> list[str]:
    return ["" if c.value is None else str(c.value) for c in spec.rows[0]]


def _flat(spec) -> str:
    return " \n ".join(
        " | ".join("" if c.value is None else str(c.value) for c in row) for row in spec.rows
    )


def test_data_dictionary_header_columns():
    spec = build_data_dictionary(_layout(_entries()))
    assert spec.title == "Data dictionary"
    header = _header(spec)
    for col in (
        "Section",
        "Field",
        "Type",
        "Unit",
        "Description",
        "Allowed values",
        "Required",
        "Allow other",
    ):
        assert col in header


def test_data_dictionary_renders_one_row_per_field():
    spec = build_data_dictionary(_layout(_entries()))
    flat = _flat(spec)
    assert "Source of data" in flat
    assert "Number of participants" in flat
    # select options surfaced
    assert "Cohort" in flat
    assert "RCT" in flat
    # unit + required + allow_other rendered
    assert "patients" in flat
    assert "Yes" in flat  # is_required True / allow_other True
    assert "No" in flat  # is_required False / allow_other False


def test_data_dictionary_empty_entries_is_header_only():
    spec = build_data_dictionary(_layout(()))
    assert len(spec.rows) == 1  # header only
