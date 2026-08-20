"""Unit tests for the snapshot section reader (spec §5.1)."""

from __future__ import annotations

import dataclasses
from uuid import uuid4

from app.models.extraction import (
    ExtractionCardinality,
    ExtractionEntityRole,
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
        "role": "model_container",
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
