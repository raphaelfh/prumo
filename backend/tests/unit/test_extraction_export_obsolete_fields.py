"""Unit tests for obsolete-field diff against the anchor snapshot (spec §5.1)."""

from __future__ import annotations

from uuid import uuid4

import pytest

from app.services.extraction_export_service import ArticleDescriptor, ExtractionExportService


def _et(eid: str, fields: list[dict]) -> dict:
    return {
        "id": eid,
        "name": "s",
        "label": "S",
        "description": None,
        "parent_entity_type_id": None,
        "cardinality": "one",
        "role": "study_section",
        "sort_order": 0,
        "is_required": False,
        "fields": fields,
    }


def _f(fid: str, label: str) -> dict:
    return {
        "id": fid,
        "name": label.lower(),
        "label": label,
        "description": None,
        "field_type": "text",
        "is_required": False,
        "allowed_values": None,
        "unit": None,
        "sort_order": 0,
        "llm_description": None,
        "allow_other": False,
    }


class _StubVersion:
    def __init__(self, schema: dict) -> None:
        self.schema_ = schema
        self.project_template_id = uuid4()


class _StubDB:
    """Returns a different snapshot per version_id (keyed)."""

    def __init__(self, by_version: dict) -> None:
        self._by_version = by_version

    async def get(self, _model, pk):  # noqa: ANN001
        return self._by_version.get(pk)


@pytest.mark.asyncio
async def test_obsolete_fields_are_run_only_fields_absent_from_anchor() -> None:
    surviving_fid = str(uuid4())
    removed_fid = str(uuid4())
    run_version = uuid4()

    # Anchor knows only the surviving field (passed inline below).
    # The Run's own snapshot still has BOTH fields → removed_fid is obsolete.
    run_schema = {
        "entity_types": [_et(str(uuid4()), [_f(surviving_fid, "Kept"), _f(removed_fid, "Dropped")])]
    }
    db = _StubDB({run_version: _StubVersion(run_schema)})

    svc = ExtractionExportService(db=db, user_id=str(uuid4()), storage=None)  # type: ignore[arg-type]

    article = ArticleDescriptor(
        article_id=uuid4(),
        header_label="Gaca, 2011",
        run_id=uuid4(),
        run_stage=None,
        version_id=run_version,
        model_instances=(),
        section_instances={},
    )
    out = await svc._compute_obsolete_fields_per_article(
        articles=(article,),
        anchor_field_ids={__import__("uuid").UUID(surviving_fid)},
    )
    assert out == {article.article_id: ["Dropped"]}


@pytest.mark.asyncio
async def test_no_obsolete_fields_when_run_matches_anchor() -> None:
    fid = str(uuid4())
    run_version = uuid4()
    run_schema = {"entity_types": [_et(str(uuid4()), [_f(fid, "Kept")])]}
    db = _StubDB({run_version: _StubVersion(run_schema)})
    svc = ExtractionExportService(db=db, user_id=str(uuid4()), storage=None)  # type: ignore[arg-type]
    article = ArticleDescriptor(
        article_id=uuid4(),
        header_label="X",
        run_id=uuid4(),
        run_stage=None,
        version_id=run_version,
        model_instances=(),
        section_instances={},
    )
    out = await svc._compute_obsolete_fields_per_article(
        articles=(article,),
        anchor_field_ids={__import__("uuid").UUID(fid)},
    )
    assert out == {}
