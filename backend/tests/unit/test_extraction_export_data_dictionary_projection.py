"""Pure unit test for the data-dictionary projection helper."""

from __future__ import annotations

from uuid import uuid4

from app.models.extraction import (
    ExtractionCardinality,
    ExtractionEntityRole,
    ExtractionFieldType,
)
from app.services.extraction_export_service import (
    FieldDescriptor,
    SectionDescriptor,
    _build_data_dictionary,
)


def _section(label, *fields, sort_order=0):
    eid = uuid4()
    return SectionDescriptor(
        entity_type_id=eid,
        label=label,
        role=ExtractionEntityRole.STUDY_SECTION,
        parent_entity_type_id=None,
        fields=tuple(fields),
        cardinality=ExtractionCardinality.ONE,
        sort_order=sort_order,
    )


def _field(label, *, unit=None, required=False, allow_other=False, desc=None):
    return FieldDescriptor(
        field_id=uuid4(),
        label=label,
        type=ExtractionFieldType.SELECT,
        allowed_values=("Cohort", "RCT"),
        parent_section_id=uuid4(),
        description=desc,
        unit=unit,
        is_required=required,
        allow_other=allow_other,
    )


def test_build_data_dictionary_flattens_fields_with_metadata():
    s = _section(
        "1. Source",
        _field("Design", required=True, allow_other=True, desc="Study design"),
        _field("N", unit="patients"),
    )
    entries = _build_data_dictionary((s,))
    assert [e.label for e in entries] == ["Design", "N"]
    assert entries[0].section_label == "1. Source"
    assert entries[0].is_required is True
    assert entries[0].allow_other is True
    assert entries[0].description == "Study design"
    # allowed_values surfaced as value+label pairs
    assert tuple(av.value for av in entries[0].allowed_values) == ("Cohort", "RCT")
    assert tuple(av.label for av in entries[0].allowed_values) == ("Cohort", "RCT")
    assert entries[1].unit == "patients"


def test_build_data_dictionary_preserves_section_and_field_order():
    s1 = _section("1. Source", _field("A"), _field("B"), sort_order=0)
    s2 = _section("2. Outcomes", _field("C"), sort_order=1)
    entries = _build_data_dictionary((s1, s2))
    # Order follows the resolved section/field ordering on the descriptors.
    assert [e.label for e in entries] == ["A", "B", "C"]
    assert [e.section_label for e in entries] == ["1. Source", "1. Source", "2. Outcomes"]


def test_build_data_dictionary_empty_sections_yields_no_entries():
    assert _build_data_dictionary(()) == ()
    assert _build_data_dictionary((_section("Empty"),)) == ()
