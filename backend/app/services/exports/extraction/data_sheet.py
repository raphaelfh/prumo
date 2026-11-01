"""The machine-readable Data sheet (spec §4.1) and its AI-provenance rules (§7).

Origin is computed here only, against the run's PINNED field through
``values.canonical_equal`` (both-sides fallback to peeled raw values).
"""

from __future__ import annotations

from collections import Counter
from collections.abc import Mapping, Sequence
from datetime import UTC, date, datetime
from typing import TYPE_CHECKING, Final, Literal
from uuid import UUID

from app.services.exports.descriptors import (
    ValueKey,
    all_instances_of,
    iter_records,
    level_of,
    primary_rater,
    record_keys,
    walk_sections,
)
from app.services.exports.extraction.sheet_spec import Cell, CellStyle, CellValue, SheetSpec
from app.services.exports.values import ExportValue, canonical_equal
from app.services.run_lifecycle_service import APPROVE_ALL_RATIONALE
from app.services.value_semantics import is_value_filled

if TYPE_CHECKING:
    from app.schemas.extraction_run import RunViewField
    from app.services.exports.cell_record import CellRecord
    from app.services.exports.extraction.workbook import SheetTitles
    from app.services.extraction_export_service import (
        ArticleDescriptor,
        ExportLayout,
    )

Origin = Literal["ai_accepted", "ai_edited", "human", "rule", "mixed"]
ConsensusMethod = Literal["select_existing", "no_conflict", "override"]

# PR2 (proposal links on every write) reached prod at 2026-10-31T21:41:32Z,
# recorded on PR #1067 (R21). Before it, a value typed over an AI suggestion
# was saved unlinked and reads ``human`` with ``ai_proposed=true``.
LINEAGE_EXACT_SINCE: Final[date] = date(2026, 10, 31)


def origin_of(cell: CellRecord, pinned_field: RunViewField | None) -> Origin:
    """``ai_accepted`` / ``ai_edited`` for a filled value linked to an AI proposal,
    else ``human`` (unlinked, a non-AI link such as a reopen's ``system`` seed,
    or nothing filled)."""
    link = cell.linked_proposal
    if link is None or link.source != "ai" or not is_value_filled(cell.envelope):
        return "human"
    if canonical_equal(cell.envelope, link.proposed_value, pinned_field):
        return "ai_accepted"
    return "ai_edited"


def consensus_origin_of(
    cell: CellRecord,
    reviewers: Sequence[CellRecord],
    pinned_field: RunViewField | None,
) -> tuple[Origin, ConsensusMethod]:
    """A consensus row's origin and method. ``cell.linked_proposal`` already is the
    selected decision's own link (D10); ``reviewers`` are the coordinate's
    reviewer cells, read only for an approve-all (``no_conflict``) row."""
    if cell.decision.kind == "select_existing":
        return origin_of(cell, pinned_field), "select_existing"
    if cell.decision.rationale == APPROVE_ALL_RATIONALE:
        origins = {origin_of(r, pinned_field) for r in reviewers if is_value_filled(r.envelope)}
        return (origins.pop() if len(origins) == 1 else "mixed"), "no_conflict"
    return "human", "override"


DATA_COLUMNS: Final[tuple[str, ...]] = (
    # Keys
    "article_id",
    "article_label",
    "sheet",
    "record_id",
    "parent_record_id",
    "instance_id",
    "record_label",
    "field_id",
    "field_code",
    "rater",
    # Value
    "status",
    "value_num",
    "value_text",
    "value_bool",
    "value_label",
    "unit",
    "other_text",
    "absent_code",
    "out_of_scope",
    # Lineage
    "origin",
    "ai_proposed",
    "ai_proposal_id",
    "decided_by",
    "decided_at",
    "rationale",
    # Consensus rows only
    "consensus_method",
    "n_raters_with_value",
)

DataRow = tuple[CellValue, ...]

_CONSENSUS = "consensus"  # reserved rater literal on consensus rows
_HEADER = CellStyle(bold=True, fill="EEEEEE")


def reviewer_cells(layout: ExportLayout) -> dict[tuple[UUID, UUID, UUID], list[CellRecord]]:
    """Each coordinate's reviewer cells (rater slot not ``None``)."""
    out: dict[tuple[UUID, UUID, UUID], list[CellRecord]] = {}
    for (run_id, instance_id, field_id, rater), cell in layout.cells.items():
        if rater is not None:
            out.setdefault((run_id, instance_id, field_id), []).append(cell)
    return out


def _cell_origin(
    key: ValueKey,
    cell: CellRecord | None,
    reviewers: Sequence[CellRecord],
    pinned_field: RunViewField | None,
) -> tuple[Origin, ConsensusMethod | None]:
    """A stamp (no loaded cell) reads ``rule``; else the §7 origin rules."""
    if cell is None:
        return "rule", None
    if key[3] is None:
        return consensus_origin_of(cell, reviewers, pinned_field)
    return origin_of(cell, pinned_field), None


def pinned_field_of(
    layout: ExportLayout, version_id: UUID | None, field_id: UUID
) -> RunViewField | None:
    """The run's pinned field; ``None`` for a narrow or unknown version (D5)."""
    if version_id is None:
        return None
    return layout.pinned_fields.get(version_id, {}).get(field_id)


class CoordinateOrder:
    """The Data sheet's order of a coordinate: the article's export position,
    its instance's position in the rule-2 walk of the active sections (unknown
    instances last, by id), then the field code."""

    def __init__(self, layout: ExportLayout) -> None:
        self._layout = layout
        self._index = {a.article_id: i for i, a in enumerate(layout.articles)}
        self._codes = {e.field_id: e.field_code for e in layout.codebook}
        self._walks: dict[UUID, dict[UUID, int]] = {}

    def _walk(self, article: ArticleDescriptor) -> dict[UUID, int]:
        if article.article_id not in self._walks:
            walked = (
                iid
                for s in walk_sections(self._layout.sections)
                for iid in all_instances_of(article, s.entity_type_id)
            )
            self._walks[article.article_id] = {iid: i for i, iid in enumerate(walked)}
        return self._walks[article.article_id]

    def key(
        self, article: ArticleDescriptor, instance_id: UUID, field_id: UUID
    ) -> tuple[int, tuple[int, int, str], str]:
        walk = self._walk(article)
        position = (0, walk[instance_id], "") if instance_id in walk else (1, 0, str(instance_id))
        return (self._index[article.article_id], position, self._codes.get(field_id) or "")


class RecordLabels:
    """Where a coordinate lands: its record keys, its ``sheet`` and the
    ``record_label`` that sheet gives the record (the article label at the root).

    ``sheet`` is blank, never ``sheet_for(None)`` (which answers "Articles"),
    for an instance outside the active tree or a field not in its section (R8).
    """

    def __init__(self, layout: ExportLayout, titles: SheetTitles) -> None:
        self._sections = layout.sections
        self._titles = titles
        self._by_id = {s.entity_type_id: s for s in layout.sections}
        self._by_level: dict[tuple[UUID, UUID], dict[UUID, str]] = {}

    def place(
        self, article: ArticleDescriptor, instance_id: UUID, field_id: UUID
    ) -> tuple[UUID, UUID | None, str | None, str]:
        """``(record_id, parent_record_id, sheet, record_label)``."""
        record_id, parent_id, section = record_keys(article, instance_id, self._sections)
        if section is None or not any(f.field_id == field_id for f in section.fields):
            return record_id, parent_id, None, ""
        sheet = self._titles.sheet_for(section.entity_type_id)
        if not sheet:
            return record_id, parent_id, sheet, ""
        return record_id, parent_id, sheet, self._label(article, section.entity_type_id, record_id)

    def _label(self, article: ArticleDescriptor, section_id: UUID, record_id: UUID) -> str:
        level = level_of(self._by_id[section_id], self._sections)
        if level is None:
            return article.article_label
        key = (article.article_id, level)
        if key not in self._by_level:
            records = iter_records(self._by_id[level], article, self._sections)
            self._by_level[key] = {iid: chain[-1][1] for iid, chain in records}
        return self._by_level[key].get(record_id, "")


def _naive_utc(at: datetime) -> datetime:
    # openpyxl cannot store a tz-aware datetime.
    return at.astimezone(UTC).replace(tzinfo=None)


def data_rows(layout: ExportLayout, titles: SheetTitles) -> tuple[DataRow, ...]:
    """One row per ``value_map`` entry of an exported article, §4.1 order."""
    articles = {a.run_id: a for a in layout.articles if a.run_id is not None}
    codes = {e.field_id: e.field_code for e in layout.codebook}
    reviewers_of = reviewer_cells(layout)
    record_labels = RecordLabels(layout, titles)
    order = CoordinateOrder(layout)
    keyed: list[tuple[tuple[object, ...], DataRow]] = []
    for key, v in layout.value_map.items():
        run_id, instance_id, field_id, rater = key
        if run_id not in articles:
            continue
        article = articles[run_id]
        record_id, parent_id, sheet, label = record_labels.place(article, instance_id, field_id)
        cell = layout.cells.get(key)
        coord_reviewers = reviewers_of.get((run_id, instance_id, field_id), [])
        pinned = pinned_field_of(layout, article.version_id, field_id)
        origin, method = _cell_origin(key, cell, coord_reviewers, pinned)
        link = cell.linked_proposal if cell is not None else None
        ai_link = link if link is not None and link.source == "ai" else None
        rater_label = _CONSENSUS if rater is None else layout.rater_labels.get(rater, str(rater))
        row: DataRow = (
            str(article.article_id),
            article.article_label,
            sheet,
            str(record_id),
            None if parent_id is None else str(parent_id),
            str(instance_id),
            label,
            str(field_id),
            codes.get(field_id),
            rater_label,
            *_value_cells(v),
            origin,
            ai_link is not None
            or (article.article_id, instance_id, field_id) in layout.ai_proposed,
            None if ai_link is None else str(ai_link.id),
            None if cell is None else layout.rater_labels.get(cell.decision.actor_id),
            None if cell is None else _naive_utc(cell.decision.created_at),
            None if cell is None else cell.decision.rationale,
            method,
            sum(1 for c in coord_reviewers if is_value_filled(c.envelope))
            if rater is None
            else None,
        )
        sort_key = (*order.key(article, instance_id, field_id), rater is not None, rater_label)
        keyed.append((sort_key, row))
    keyed.sort(key=lambda kr: kr[0])
    return tuple(row for _, row in keyed)


def _value_cells(v: ExportValue) -> DataRow:
    return (
        v.status,
        v.value_num,
        v.value_text,
        v.value_bool,
        v.value_label,
        v.unit,
        v.other_text,
        v.absent_code,
        v.out_of_scope,
    )


def build_data_sheet(layout: ExportLayout, titles: SheetTitles) -> SheetSpec | None:
    """The Data sheet: one header row, then ``data_rows``; ``None`` outside COMPLETE."""
    title = titles.fixed.get("data")
    if title is None:
        return None
    return SheetSpec(
        title=title,
        rows=(
            tuple(Cell(h, _HEADER) for h in DATA_COLUMNS),
            *(tuple(Cell(v) for v in row) for row in data_rows(layout, titles)),
        ),
        column_widths=tuple(18.0 for _ in DATA_COLUMNS),
        freeze="A2",
    )


def origin_counts(layout: ExportLayout) -> Mapping[Origin, int]:
    """Origins over the ``primary_rater`` slot (R1), stamps included as ``rule``."""
    primary = primary_rater(layout.mode, layout.reviewer_id)
    reviewers_of = reviewer_cells(layout)
    articles = {a.run_id: a for a in layout.articles if a.run_id is not None}
    counts: Counter[Origin] = Counter()
    for key in layout.value_map:
        run_id, instance_id, field_id, rater = key
        if rater != primary or run_id not in articles:
            continue
        origin, _ = _cell_origin(
            key,
            layout.cells.get(key),
            reviewers_of.get((run_id, instance_id, field_id), []),
            pinned_field_of(layout, articles[run_id].version_id, field_id),
        )
        counts[origin] += 1
    return counts
