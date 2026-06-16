"""Unit tests for the snapshot section reader (spec §5.1)."""

from __future__ import annotations

import dataclasses
from uuid import uuid4

from app.models.extraction import (
    ExtractionCardinality,
    ExtractionEntityRole,
    ExtractionFieldType,
)
from app.services.exports.extraction_snapshot_reader import (
    AllowedValue,
    SnapshotField,
    SnapshotSection,
    load_export_sections,
)


def test_snapshot_field_carries_full_metadata() -> None:
    f = SnapshotField(
        field_id=uuid4(),
        name="age",
        label="Age",
        type=ExtractionFieldType.NUMBER,
        description="Patient age",
        llm_description="Extract the age",
        unit="years",
        allowed_values=(AllowedValue(value="x", label="x"),),
        is_required=True,
        allow_other=False,
        sort_order=0,
    )
    assert f.unit == "years"
    assert f.allowed_values[0].label == "x"
    assert dataclasses.is_dataclass(f)


def test_snapshot_section_carries_role_and_cardinality() -> None:
    s = SnapshotSection(
        entity_type_id=uuid4(),
        name="study",
        label="Study",
        role=ExtractionEntityRole.STUDY_SECTION,
        cardinality=ExtractionCardinality.ONE,
        parent_entity_type_id=None,
        sort_order=0,
        fields=(),
    )
    assert s.role is ExtractionEntityRole.STUDY_SECTION
    assert s.cardinality is ExtractionCardinality.ONE


def test_load_export_sections_is_async_callable() -> None:
    import inspect

    assert inspect.iscoroutinefunction(load_export_sections)
