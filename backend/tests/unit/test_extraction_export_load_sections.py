"""Unit tests for snapshot-driven _load_pinned_versions (spec §5.1, R14)."""

from __future__ import annotations

from unittest.mock import AsyncMock
from uuid import UUID, uuid4

import pytest

from app.models.extraction import ExtractionCardinality
from app.schemas.extraction_run import RunViewEntityType
from app.services import extraction_export_service
from app.services.extraction_export_service import ExtractionExportService


class _StubVersion:
    def __init__(self, schema: dict, *, version: int = 1) -> None:
        self.id = uuid4()
        self.version = version
        self.schema_ = schema
        self.project_template_id = uuid4()


def _view(version_id: UUID) -> RunViewEntityType:
    """One section with one field; ids are fresh per version."""
    return RunViewEntityType.model_validate(
        {
            "id": str(uuid4()),
            "name": f"s_{str(version_id)[:4]}",
            "label": "S",
            "parent_entity_type_id": None,
            "cardinality": "one",
            "sort_order": 0,
            "is_required": False,
            "fields": [
                {
                    "id": str(uuid4()),
                    "name": "x",
                    "label": "X",
                    "field_type": "text",
                    "is_required": False,
                    "allowed_values": None,
                    "sort_order": 0,
                }
            ],
        }
    )


async def _load_one(schema: dict):
    version = _StubVersion(schema)
    svc = ExtractionExportService(
        db=_StubDB(version),  # type: ignore[arg-type]
        user_id=str(uuid4()),
    )
    (out,) = await svc._load_pinned_versions(
        template_id=version.project_template_id,
        versions=(version,),  # type: ignore[arg-type]
    )
    return out


class _StubDB:
    def __init__(self, version: _StubVersion) -> None:
        self._version = version

    async def get(self, _model, _pk):  # noqa: ANN001 — mimics AsyncSession.get
        return self._version


@pytest.mark.asyncio
async def test_load_pinned_versions_maps_snapshot_metadata() -> None:
    eid = str(uuid4())
    fid = str(uuid4())
    schema = {
        "entity_types": [
            {
                "id": eid,
                "name": "outcomes",
                "label": "Outcomes",
                "description": "per outcome",
                "parent_entity_type_id": None,
                "cardinality": "many",
                "sort_order": 2,
                "is_required": True,
                "fields": [
                    {
                        "id": fid,
                        "name": "dose",
                        "label": "Dose",
                        "description": "Dose given",
                        "field_type": "number",
                        "is_required": True,
                        "allowed_values": None,
                        "unit": "mg",
                        "sort_order": 0,
                        "llm_description": "extract dose",
                        "allow_other": True,
                        "allowed_units": ["mg", "g"],
                        "is_entity_key": True,
                        "allows_not_evaluated": True,
                        "allows_no_information": False,
                    }
                ],
            }
        ]
    }
    loaded = await _load_one(schema)
    sections = loaded.sections

    assert len(sections) == 1
    s = sections[0]
    # `role` is no longer carried onto the descriptors (trees B4): the
    # export derives structure from parent + cardinality.
    assert not hasattr(s, "role")
    assert s.cardinality is ExtractionCardinality.MANY
    assert s.sort_order == 2
    f = s.fields[0]
    assert f.unit == "mg"
    assert f.description == "Dose given"
    assert f.is_required is True
    assert f.allow_other is True
    assert f.allowed_units == ("mg", "g")
    assert f.is_entity_key is True
    assert f.allowed_absent_codes == ("not_evaluated",)
    assert f.code == ""
    assert set(loaded.run_view_fields) == {f.field_id}


@pytest.mark.asyncio
async def test_load_pinned_versions_carries_entry_label_and_defaults_it() -> None:
    """B-8: the container's entry noun rides the pinned snapshot onto the
    descriptors; entities without the key (pre-0051 snapshots) map to None."""
    schema = {
        "entity_types": [
            {
                "id": str(uuid4()),
                "name": "prediction_models",
                "label": "Prediction models",
                "entry_label": "algorithm",
                "parent_entity_type_id": None,
                "cardinality": "many",
                "sort_order": 0,
                "is_required": False,
                "fields": [],
            },
            {
                # No entry_label key at all — the old-snapshot shape.
                "id": str(uuid4()),
                "name": "study_info",
                "label": "Study info",
                "parent_entity_type_id": None,
                "cardinality": "one",
                "sort_order": 1,
                "is_required": False,
                "fields": [],
            },
        ]
    }
    loaded = await _load_one(schema)
    sections = loaded.sections

    assert sections[0].entry_label == "algorithm"
    assert sections[1].entry_label is None


@pytest.mark.asyncio
async def test_load_pinned_versions_reads_each_version_once(monkeypatch) -> None:
    calls = AsyncMock(side_effect=lambda _db, *, version_id, **_: [_view(version_id)])
    monkeypatch.setattr(extraction_export_service, "entity_types_for_version", calls)
    v1, v2 = _StubVersion({}, version=1), _StubVersion({}, version=2)
    svc = ExtractionExportService(db=_StubDB(v1), user_id=str(uuid4()))  # type: ignore[arg-type]
    out = await svc._load_pinned_versions(template_id=uuid4(), versions=(v2, v1))  # type: ignore[arg-type]
    assert calls.await_count == 2
    assert [v.version_label for v in out] == [2, 1]
    assert [v.version_id for v in out] == [v2.id, v1.id]
    assert set(out[0].run_view_fields) == {f.field_id for s in out[0].sections for f in s.fields}
    assert len(out[0].run_view_fields) == 1
