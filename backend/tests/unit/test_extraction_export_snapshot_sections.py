"""Unit tests for the snapshot section reader (spec §5.1)."""

from __future__ import annotations

import dataclasses
from uuid import uuid4

from app.models.extraction import (
    ExtractionCardinality,
    ExtractionFieldType,
)
from app.schemas.extraction_run import RunViewEntityType
from app.services.exports.extraction_snapshot_reader import (
    AllowedValue,
    SnapshotField,
    SnapshotSection,
    _section_from_view,
    load_export_sections,
)


def _container_view(payload: dict) -> RunViewEntityType:
    """A pinned MODEL_CONTAINER view as the shared provider parses it —
    ``payload`` merges over the base dict so tests can drop keys the way an
    old snapshot would (absent ``entry_label`` -> None, B-8)."""
    base = {
        "id": str(uuid4()),
        "name": "prediction_models",
        "label": "Prediction models",
        "parent_entity_type_id": None,
        "cardinality": "many",
        "sort_order": 0,
        "is_required": False,
        "fields": [],
    }
    return RunViewEntityType.model_validate({**base, **payload})


def test_section_from_view_maps_entry_label() -> None:
    section = _section_from_view(_container_view({"entry_label": "algorithm"}))
    assert section.entry_label == "algorithm"


def test_section_from_view_defaults_entry_label_for_old_snapshots() -> None:
    # Pre-0051 snapshot dicts have no entry_label key at all.
    section = _section_from_view(_container_view({}))
    assert section.entry_label is None


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


def test_snapshot_section_carries_parent_and_cardinality() -> None:
    s = SnapshotSection(
        entity_type_id=uuid4(),
        name="study",
        label="Study",
        cardinality=ExtractionCardinality.ONE,
        parent_entity_type_id=None,
        sort_order=0,
        fields=(),
    )
    assert s.cardinality is ExtractionCardinality.ONE


def test_load_export_sections_is_async_callable() -> None:
    import inspect

    assert inspect.iscoroutinefunction(load_export_sections)


def test_field_view_carries_units_key_and_absent_codes() -> None:
    view = _container_view(
        {
            "fields": [
                {
                    "id": str(uuid4()),
                    "name": "dose",
                    "label": "Dose",
                    "field_type": "number",
                    "is_required": False,
                    "sort_order": 0,
                    "allowed_units": ["mg", "g", 3],
                    "is_entity_key": True,
                    "allows_not_applicable": True,
                    "allows_not_evaluated": False,
                    "allows_no_information": True,
                }
            ]
        }
    )
    f = _section_from_view(view).fields[0]
    assert f.allowed_units == ("mg", "g")
    assert f.is_entity_key is True
    assert f.allowed_absent_codes == ("no_information", "not_applicable")


def test_field_view_defaults_units_key_and_absent_codes() -> None:
    # A non-list allowed_units reads as no units; a snapshot without the
    # disposition keys keeps the universal no_information (pre-0062 default).
    view = _container_view(
        {
            "fields": [
                {
                    "id": str(uuid4()),
                    "name": "age",
                    "label": "Age",
                    "field_type": "number",
                    "is_required": False,
                    "sort_order": 0,
                    "allowed_units": {"mg": 1},
                }
            ]
        }
    )
    f = _section_from_view(view).fields[0]
    assert f.allowed_units == ()
    assert f.is_entity_key is False
    assert f.allowed_absent_codes == ("no_information",)
