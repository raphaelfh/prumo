"""Unit tests for the grown export descriptor dataclasses (spec §5.1)."""

from __future__ import annotations

from uuid import uuid4

from app.models.extraction import (
    ExtractionCardinality,
    ExtractionEntityRole,
    ExtractionFieldType,
)
from app.services.extraction_export_service import FieldDescriptor, SectionDescriptor


def test_field_descriptor_carries_snapshot_metadata() -> None:
    f = FieldDescriptor(
        field_id=uuid4(),
        label="Dose",
        type=ExtractionFieldType.NUMBER,
        allowed_values=(),
        parent_section_id=uuid4(),
        description="Administered dose",
        unit="mg",
        is_required=True,
        allow_other=True,
    )
    assert f.description == "Administered dose"
    assert f.unit == "mg"
    assert f.is_required is True
    assert f.allow_other is True


def test_field_descriptor_metadata_defaults_are_back_compat() -> None:
    f = FieldDescriptor(
        field_id=uuid4(),
        label="Name",
        type=ExtractionFieldType.TEXT,
        allowed_values=(),
        parent_section_id=uuid4(),
    )
    assert f.description is None
    assert f.unit is None
    assert f.is_required is False
    assert f.allow_other is False


def test_section_descriptor_carries_cardinality_and_sort_order() -> None:
    s = SectionDescriptor(
        entity_type_id=uuid4(),
        label="Outcomes",
        role=ExtractionEntityRole.STUDY_SECTION,
        parent_entity_type_id=None,
        fields=(),
        cardinality=ExtractionCardinality.MANY,
        sort_order=3,
        description="Per-outcome rows",
    )
    assert s.cardinality is ExtractionCardinality.MANY
    assert s.sort_order == 3
    assert s.description == "Per-outcome rows"


def test_section_descriptor_defaults_are_back_compat() -> None:
    s = SectionDescriptor(
        entity_type_id=uuid4(),
        label="Study",
        role=ExtractionEntityRole.STUDY_SECTION,
        parent_entity_type_id=None,
        fields=(),
    )
    assert s.cardinality is ExtractionCardinality.ONE
    assert s.sort_order == 0
    assert s.description is None
