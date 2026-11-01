"""Unit tests for the pure AI proposals sub-builder (``build_ai_proposals``, D6)."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

from app.models.extraction import ExtractionFieldType
from app.services.exports.ai_proposal_projection import EngineFacts
from app.services.exports.extraction.ai_proposals import build_ai_proposals
from app.services.exports.extraction.sheet_spec import SheetSpec
from app.services.exports.extraction.workbook import ExportShape, allocate_titles
from app.services.extraction_export_service import (
    AIProposalRow,
    ArticleDescriptor,
    ExportLayout,
    FieldDescriptor,
    SectionDescriptor,
)
from tests.unit.helpers.export_layouts import export_value, make_layout

_HEADERS = [
    "article_id",
    "instance_id",
    "field_id",
    "field_code",
    "ai_proposal_id",
    "provider",
    "model",
    "prompt_version",
    "value",
    "unit",
    "confidence",
    "rationale",
    "evidence_quote",
    "page",
]

_FIELD = FieldDescriptor(uuid4(), "Dose", ExtractionFieldType.NUMBER, (), name="dose")
_SECTION = SectionDescriptor(uuid4(), "Study", None, (_FIELD,))
_ARTICLE = ArticleDescriptor(uuid4(), "Gaca, 2011", uuid4(), None)


def _ai_row(**over: Any) -> AIProposalRow:
    base: dict[str, Any] = {
        "article_id": _ARTICLE.article_id,
        "instance_id": uuid4(),
        "field_id": _FIELD.field_id,
        "ai_proposal_id": uuid4(),
        "created_at": datetime(2026, 5, 23, 10, 0, tzinfo=UTC),
        "engine": EngineFacts("openai", "gpt-4o", "v2"),
        "value": export_value(value_num=5),
        "confidence": 0.93,
        "rationale": "reason",
        "evidence_quote": "evidence",
        "page": "4",
    }
    return AIProposalRow(**{**base, **over})


def _layout(*rows: AIProposalRow, articles: tuple[ArticleDescriptor, ...] = (_ARTICLE,)):
    return make_layout(
        sections=(_SECTION,),
        articles=articles,
        include_ai_metadata=True,
        ai_proposal_rows=rows,
    )


def _spec(layout: ExportLayout) -> SheetSpec:
    spec = build_ai_proposals(
        layout, allocate_titles(layout, ExportShape.COMPLETE, include_matrix=True)
    )
    assert spec is not None
    return spec


def _cells(spec: SheetSpec, row: int = 1) -> dict[str, Any]:
    return {h: c.value for h, c in zip(_HEADERS, spec.rows[row], strict=True)}


def test_returns_none_when_toggled_off() -> None:
    layout = make_layout(include_ai_metadata=False)
    titles = allocate_titles(layout, ExportShape.COMPLETE, include_matrix=True)
    assert build_ai_proposals(layout, titles) is None


def test_headers_have_no_outcome_column() -> None:
    spec = _spec(_layout())
    assert spec.title == "AI proposals"
    assert [c.value for c in spec.rows[0]] == _HEADERS
    assert len(spec.rows) == 1


def test_row_carries_keys_and_generation_facts() -> None:
    row = _ai_row()
    layout = _layout(row)
    (code,) = [e.field_code for e in layout.codebook if e.field_id == _FIELD.field_id]
    assert code, "precondition: the codebook codes the field"
    cells = _cells(_spec(layout))
    assert cells == {
        "article_id": str(_ARTICLE.article_id),
        "instance_id": str(row.instance_id),
        "field_id": str(_FIELD.field_id),
        "field_code": code,
        "ai_proposal_id": str(row.ai_proposal_id),
        "provider": "openai",
        "model": "gpt-4o",
        "prompt_version": "v2",
        "value": 5,
        "unit": None,
        "confidence": 0.93,
        "rationale": "reason",
        "evidence_quote": "evidence",
        "page": "4",
    }


def test_value_is_the_machine_scalar_with_its_unit() -> None:  # D6
    cells = _cells(_spec(_layout(_ai_row(value=export_value(value_num=5, unit="mg")))))
    assert (cells["value"], cells["unit"]) == (5, "mg")


def test_value_of_an_absent_proposal_is_its_code() -> None:
    absent = export_value("absent", absent_code="not_reported")
    assert _cells(_spec(_layout(_ai_row(value=absent))))["value"] == "not_reported"


def test_value_of_a_select_is_its_code_not_its_label() -> None:
    picked = export_value(value_text="cohort", value_label="Cohort study")
    assert _cells(_spec(_layout(_ai_row(value=picked))))["value"] == "cohort"


def test_field_outside_the_codebook_has_a_blank_code() -> None:
    cells = _cells(_spec(_layout(_ai_row(field_id=uuid4()))))
    assert cells["field_code"] is None


def test_rows_follow_article_order_then_creation_time() -> None:
    second = ArticleDescriptor(uuid4(), "Zed, 2020", uuid4(), None)
    early = datetime(2026, 1, 1, tzinfo=UTC)
    late = datetime(2026, 2, 1, tzinfo=UTC)
    rows = (
        _ai_row(article_id=_ARTICLE.article_id, created_at=late),
        _ai_row(article_id=second.article_id, created_at=early),
        _ai_row(article_id=_ARTICLE.article_id, created_at=early),
    )
    spec = _spec(_layout(*rows, articles=(_ARTICLE, second)))

    def key(i: int) -> tuple[str, str]:
        r = rows[i]
        return (str(r.article_id), str(r.ai_proposal_id))

    got = [(c[0].value, c[4].value) for c in spec.rows[1:]]
    assert got == [key(2), key(0), key(1)]
