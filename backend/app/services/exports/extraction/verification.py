"""The Verification sheet (spec §4.3, ``all_users`` only).

One row per coordinate with at least one reviewer cell, in Data order: each
reviewer's value side by side, then [AI], the consensus value and ``match``.
The rater set of an article is ``layout.raters_by_run[article.run_id]`` (R16);
a reviewer outside it shows ``—``. AI and Consensus never take part in ``match``.

Pure: returns a ``SheetSpec`` (or ``None``); no openpyxl, no I/O.
"""

from __future__ import annotations

from collections.abc import Iterator, Mapping
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, Literal
from uuid import UUID

from app.models.extraction import ExtractionFieldType
from app.services.exports.descriptors import value_key
from app.services.exports.extraction.data_sheet import (
    CoordinateOrder,
    RecordLabels,
    consensus_origin_of,
    pinned_field_of,
    reviewer_cells,
)
from app.services.exports.extraction.sheet_spec import Cell, CellStyle, CellValue, SheetSpec
from app.services.exports.values import canonical_keys, display_value
from app.services.extraction_export_service import FieldDescriptor
from app.services.value_semantics import is_value_filled

if TYPE_CHECKING:
    from app.schemas.extraction_run import RunViewField
    from app.services.exports.extraction.workbook import SheetTitles
    from app.services.extraction_export_service import (
        AIProposalRow,
        ArticleDescriptor,
        ExportLayout,
    )

Match = Literal["all_equal", "conflict", "incomplete"]

NOT_A_RATER = "—"
_HEADER = CellStyle(bold=True, fill="EEEEEE")
_KEY_COLUMNS = ("article_label", "record_label", "field_code", "field_label")
_TAIL_COLUMNS = (
    "Consensus",
    "match",
    "n_raters",
    "n_raters_with_value",
    "consensus_method",
    "consensus_by",
    "consensus_rationale",
)


def match_of(
    raws_by_rater: Mapping[UUID, Any | None], n_raters: int, pinned_field: RunViewField | None
) -> Match:
    """``None`` is no value. Distinct values are counted over ``canonical_keys``
    of the filled raws (an absent marker compares by its code)."""
    filled = [raw for raw in raws_by_rater.values() if raw is not None]
    distinct = len(set(canonical_keys(filled, pinned_field)))
    if distinct >= 2:
        return "conflict"
    if distinct == 1 and n_raters >= 2 and len(filled) == n_raters:
        return "all_equal"
    return "incomplete"


@dataclass(frozen=True, slots=True)
class _Coordinate:
    article: ArticleDescriptor
    instance_id: UUID
    field_id: UUID
    raters: tuple[UUID, ...]
    raws: Mapping[UUID, Any | None]  # rater -> filled non-reject envelope, else None
    match: Match


def _coordinates(layout: ExportLayout) -> Iterator[_Coordinate]:
    """The coordinates with at least one reviewer cell, in Data order."""
    articles = {a.run_id: a for a in layout.articles if a.run_id is not None}
    order = CoordinateOrder(layout)
    coords = [
        (articles[run_id], instance_id, field_id)
        for run_id, instance_id, field_id in reviewer_cells(layout)
        if run_id in articles
    ]
    coords.sort(key=lambda c: order.key(*c))
    for article, instance_id, field_id in coords:
        assert article.run_id is not None
        raters = tuple(layout.raters_by_run.get(article.run_id, ()))
        raws: dict[UUID, Any | None] = {}
        for rater in raters:
            cell = layout.cells.get(value_key(article.run_id, instance_id, field_id, rater))
            filled = (
                cell is not None
                and cell.decision.kind != "reject"
                and is_value_filled(cell.envelope)
            )
            raws[rater] = cell.envelope if filled and cell is not None else None
        pinned = pinned_field_of(layout, article.version_id, field_id)
        yield _Coordinate(
            article, instance_id, field_id, raters, raws, match_of(raws, len(raters), pinned)
        )


def agreement(layout: ExportLayout) -> tuple[int, int]:
    """``(all_equal rows, rows with n_raters ≥ 2)``: percent agreement's terms."""
    rows = [c for c in _coordinates(layout) if len(c.raters) >= 2]
    return sum(1 for c in rows if c.match == "all_equal"), len(rows)


def _fields(layout: ExportLayout) -> dict[UUID, FieldDescriptor]:
    """Active fields, then the Codebook's for a field outside the active tree."""
    fields = {
        e.field_id: FieldDescriptor(e.field_id, e.field_label, e.type, (), unit=e.unit)
        for e in layout.codebook
    }
    fields.update({f.field_id: f for s in layout.sections for f in s.fields})
    return fields


def _latest_ai(layout: ExportLayout) -> dict[tuple[UUID, UUID, UUID], AIProposalRow]:
    """The latest current-run AI proposal per (article, instance, field), by
    ``(created_at DESC, ai_proposal_id DESC)``. A row is from another run only
    when a cell links it across runs, so those ids are set aside."""
    foreign = {
        c.linked_proposal.id
        for k, c in layout.cells.items()
        if c.linked_proposal is not None and c.linked_proposal.run_id != k[0]
    }
    latest: dict[tuple[UUID, UUID, UUID], AIProposalRow] = {}
    for row in layout.ai_proposal_rows:
        if row.ai_proposal_id in foreign:
            continue
        key = (row.article_id, row.instance_id, row.field_id)
        best = latest.get(key)
        if best is None or (row.created_at, row.ai_proposal_id) > (
            best.created_at,
            best.ai_proposal_id,
        ):
            latest[key] = row
    return latest


def _shown(
    layout: ExportLayout, c: _Coordinate, rater: UUID | None, field: FieldDescriptor
) -> CellValue:
    """``display_value`` of one slot of the coordinate (R2, no ``target``)."""
    assert c.article.run_id is not None
    v = layout.value_map.get(value_key(c.article.run_id, c.instance_id, c.field_id, rater))
    return None if v is None else display_value(v, field)


def build_verification(layout: ExportLayout, titles: SheetTitles) -> SheetSpec | None:
    """The Verification sheet, or ``None`` when its role is absent."""
    title = titles.fixed.get("verification")
    if title is None:
        return None
    with_ai = layout.include_ai_metadata
    header = (
        *_KEY_COLUMNS,
        *(r.display_label for r in layout.reviewers),
        *(("AI",) if with_ai else ()),
        *_TAIL_COLUMNS,
    )
    fields = _fields(layout)
    codes = {e.field_id: e.field_code for e in layout.codebook}
    places = RecordLabels(layout, titles)
    latest_ai = _latest_ai(layout) if with_ai else {}
    reviewers_of = reviewer_cells(layout)
    rows: list[tuple[CellValue, ...]] = []
    for c in _coordinates(layout):
        run_id = c.article.run_id
        assert run_id is not None
        field = fields.get(c.field_id) or FieldDescriptor(
            c.field_id, "", ExtractionFieldType.TEXT, ()
        )
        _, _, _, record_label = places.place(c.article, c.instance_id, c.field_id)
        reviewer_values = tuple(
            _shown(layout, c, r.reviewer_id, field) if r.reviewer_id in c.raters else NOT_A_RATER
            for r in layout.reviewers
        )
        ai = latest_ai.get((c.article.article_id, c.instance_id, c.field_id))
        consensus = layout.cells.get(value_key(run_id, c.instance_id, c.field_id))
        method = None
        if consensus is not None:
            pinned = pinned_field_of(layout, c.article.version_id, c.field_id)
            coord_reviewers = reviewers_of.get((run_id, c.instance_id, c.field_id), [])
            _, method = consensus_origin_of(consensus, coord_reviewers, pinned)
        rows.append(
            (
                c.article.article_label,
                record_label,
                codes.get(c.field_id),
                field.label,
                *reviewer_values,
                *((None if ai is None else display_value(ai.value, field),) if with_ai else ()),
                _shown(layout, c, None, field),
                c.match,
                len(c.raters),
                sum(1 for raw in c.raws.values() if raw is not None),
                method,
                None if consensus is None else layout.rater_labels.get(consensus.decision.actor_id),
                None if consensus is None else consensus.decision.rationale,
            )
        )
    return SheetSpec(
        title=title,
        rows=(
            tuple(Cell(h, _HEADER) for h in header),
            *(tuple(Cell(v) for v in row) for row in rows),
        ),
        column_widths=tuple(18.0 for _ in header),
        freeze="E2",
    )
