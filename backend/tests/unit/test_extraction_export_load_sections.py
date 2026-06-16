"""Unit tests for snapshot-driven _load_sections (spec §5.1)."""

from __future__ import annotations

from uuid import uuid4

import pytest

from app.models.extraction import ExtractionCardinality, ExtractionEntityRole
from app.services.extraction_export_service import ExtractionExportService


class _StubVersion:
    def __init__(self, schema: dict) -> None:
        self.schema_ = schema
        self.project_template_id = uuid4()


class _StubDB:
    def __init__(self, version: _StubVersion) -> None:
        self._version = version

    async def get(self, _model, _pk):  # noqa: ANN001 — mimics AsyncSession.get
        return self._version


@pytest.mark.asyncio
async def test_load_sections_maps_snapshot_metadata() -> None:
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
                "role": "study_section",
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
                    }
                ],
            }
        ]
    }
    svc = ExtractionExportService(
        db=_StubDB(_StubVersion(schema)),  # type: ignore[arg-type]
        user_id=str(uuid4()),
        storage=None,  # type: ignore[arg-type]
    )
    sections = await svc._load_sections(uuid4())

    assert len(sections) == 1
    s = sections[0]
    assert s.role is ExtractionEntityRole.STUDY_SECTION
    assert s.cardinality is ExtractionCardinality.MANY
    assert s.sort_order == 2
    f = s.fields[0]
    assert f.unit == "mg"
    assert f.description == "Dose given"
    assert f.is_required is True
    assert f.allow_other is True
