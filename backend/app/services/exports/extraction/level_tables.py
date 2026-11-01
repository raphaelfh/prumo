"""Level-sheet sub-builder (rules 1, 2, 6).

Articles is the root level; every repeating (``cardinality='many'``) section
is a level of its own, and a ``one`` section's fields join its nearest
repeating ancestor. One row per record and rater slot. The review workbook
carries machine keys and rule-3 field codes; the publication workbook carries
labels only, with no UUID column, display cells (§4.6) and a footnote block
under each table for the NI/NA/NE/NA* markers it uses (D7).
"""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from typing import TYPE_CHECKING
from uuid import UUID

from openpyxl.utils import get_column_letter

from app.models.extraction import ExtractionCardinality
from app.services.exports.descriptors import (
    ancestry,
    instance_in_record,
    iter_records,
    primary_rater,
    record_keys,
    value_key,
    walk_sections,
)
from app.services.exports.extraction.sheet_spec import Cell, CellStyle, CellValue, SheetSpec
from app.services.exports.values import (
    MACHINE_STATUSES,
    ExportValue,
    display_value,
    footnote_key,
    machine_value,
    publication_footnotes,
)
from app.services.extraction_export_service import (
    ArticleDescriptor,
    ExportLayout,
    ExportMode,
    FieldDescriptor,
    SectionDescriptor,
)

if TYPE_CHECKING:
    from app.services.exports.extraction.workbook import ExportShape, SheetTitles

_HEADER = CellStyle(bold=True, fill="EEEEEE")
_CONSENSUS = "consensus"  # reserved rater literal on consensus rows

Column = tuple[SectionDescriptor, FieldDescriptor]


def publication_header(field: FieldDescriptor) -> str:
    """The field label, with a fixed unit in parentheses; an ``allowed_units``
    field carries its unit in each cell instead."""
    if field.allowed_units or not field.unit:
        return field.label
    return f"{field.label} ({field.unit})"


def _field_headers(f: FieldDescriptor, publication: bool) -> list[str]:
    if publication:
        return [publication_header(f)]
    if f.allowed_units:
        heads = [f.code, f"{f.code}.unit"]
    else:
        heads = [f"{f.code} ({f.unit})" if f.unit else f.code]
    if f.allow_other:
        heads.append(f"{f.code}.other")
    return heads


def _field_cells(v: ExportValue | None, f: FieldDescriptor, publication: bool) -> list[CellValue]:
    if publication:
        return [None if v is None else display_value(v, f, target="publication")]
    keep = v is not None and v.status in MACHINE_STATUSES and not v.out_of_scope
    cells: list[CellValue] = [None if v is None else machine_value(v)]
    if f.allowed_units:
        cells.append(v.unit if keep and v is not None else None)
    if f.allow_other:
        cells.append(v.other_text if keep and v is not None else None)
    return cells


def _raters(layout: ExportLayout, article: ArticleDescriptor) -> tuple[UUID | None, ...]:
    """R1/R16: one primary slot, or consensus plus the run's deciding reviewers."""
    if layout.mode is ExportMode.ALL_USERS:
        assert article.run_id is not None
        return (None, *layout.raters_by_run.get(article.run_id, ()))
    return (primary_rater(layout.mode, layout.reviewer_id),)


def _value_cells(
    layout: ExportLayout,
    article: ArticleDescriptor,
    record_id: UUID | None,
    rater: UUID | None,
    columns: Sequence[Column],
    publication: bool,
    used: set[str],
) -> list[CellValue]:
    """The row's field cells; in Publication, adds each cell's marker to ``used``."""
    assert article.run_id is not None
    cells: list[CellValue] = []
    for section, f in columns:
        instance_id = instance_in_record(section, article, record_id, layout.sections)
        v = (
            None
            if instance_id is None
            else layout.value_map.get(value_key(article.run_id, instance_id, f.field_id, rater))
        )
        if publication and v is not None and (key := footnote_key(v)) is not None:
            used.add(key)
        cells.extend(_field_cells(v, f, publication))
    return cells


def _dedupe(headers: Iterable[str]) -> list[str]:
    """Suffix repeated headers " (2)", " (3)", … in order (Publication labels)."""
    seen: dict[str, int] = {}
    out: list[str] = []
    for h in headers:
        seen[h] = seen.get(h, 0) + 1
        out.append(h if seen[h] == 1 else f"{h} ({seen[h]})")
    return out


def _headers(keys: list[str], columns: Sequence[Column], publication: bool) -> list[str]:
    fields = [h for _, f in columns for h in _field_headers(f, publication)]
    return [*keys, *(_dedupe(fields) if publication else fields)]


def _sheet(
    title: str,
    header: list[str],
    body: list[list[CellValue]],
    n_keys: int,
    used: set[str],
) -> SheetSpec:
    """Header, body, then (Publication) a blank row and one row per used marker (D7)."""
    notes = publication_footnotes(used)
    footer = ((Cell(None),), *((Cell(n),) for n in notes)) if notes else ()
    return SheetSpec(
        title=title,
        rows=(
            tuple(Cell(h, _HEADER) for h in header),
            *(tuple(Cell(v) for v in r) for r in body),
            *footer,
        ),
        column_widths=tuple(24.0 for _ in header),
        freeze=f"{get_column_letter(n_keys + 1)}2",
        tab_color="548235",
    )


def _articles_sheet(
    layout: ExportLayout, title: str, columns: Sequence[Column], publication: bool
) -> SheetSpec:
    all_users = layout.mode is ExportMode.ALL_USERS
    names = {r.reviewer_id: r.display_label for r in layout.reviewers}
    keys = (
        ["Article", "DOI", "PMID"]
        if publication
        else ["article_id", "article_label", "doi", "pmid", "template_version"]
    )
    header = _headers(keys, columns, publication)
    if all_users:
        header.append("Rater" if publication else "rater")
    body: list[list[CellValue]] = []
    used: set[str] = set()
    for article in layout.articles:
        if article.run_id is None:
            continue
        ids: list[CellValue] = (
            [article.article_label, article.doi, article.pmid]
            if publication
            else [
                str(article.article_id),
                article.article_label,
                article.doi,
                article.pmid,
                article.template_version,
            ]
        )
        for rater in _raters(layout, article):
            row = [*ids, *_value_cells(layout, article, None, rater, columns, publication, used)]
            if all_users:
                row.append(_CONSENSUS if rater is None else names.get(rater))
            body.append(row)
    return _sheet(title, header, body, len(keys), used)


def _level_sheet(
    layout: ExportLayout,
    level: SectionDescriptor,
    title: str,
    columns: Sequence[Column],
    publication: bool,
) -> SheetSpec:
    all_users = layout.mode is ExportMode.ALL_USERS
    names = {r.reviewer_id: r.display_label for r in layout.reviewers}
    above = [
        s
        for s in ancestry(level, layout.sections)[:-1]
        if s.cardinality is ExtractionCardinality.MANY
    ]
    keys = (
        ["Article", *(s.label for s in above), level.label]
        if publication
        else [
            "article_id",
            "article_label",
            "record_id",
            "parent_record_id",
            "record_label",
            *(f"{s.name}.label" for s in above),
        ]
    )
    if all_users:
        keys.append("Rater" if publication else "rater")
    header = _headers(keys, columns, publication)
    body: list[list[CellValue]] = []
    used: set[str] = set()
    for article in layout.articles:
        if article.run_id is None:
            continue
        for instance_id, chain in iter_records(level, article, layout.sections):
            labels = [label for _, label in chain]
            if publication:
                ids: list[CellValue] = [article.article_label, *labels]
            else:
                record_id, parent_id, _ = record_keys(article, instance_id, layout.sections)
                ids = [
                    str(article.article_id),
                    article.article_label,
                    str(record_id),
                    None if parent_id is None else str(parent_id),
                    labels[-1],
                    *labels[:-1],
                ]
            for rater in _raters(layout, article):
                rater_cell: list[CellValue] = []
                if all_users:
                    rater_cell = [_CONSENSUS if rater is None else names.get(rater)]
                values = _value_cells(
                    layout, article, instance_id, rater, columns, publication, used
                )
                body.append([*ids, *rater_cell, *values])
    return _sheet(title, header, body, len(keys), used)


def build_level_tables(
    layout: ExportLayout, titles: SheetTitles, shape: ExportShape
) -> list[SheetSpec]:
    """Articles first, then one sheet per repeating level in walk order.

    Level sheets carry the active version's fields only (``layout.sections``).
    """
    publication = shape == "publication"
    walked = walk_sections(layout.sections)
    columns: dict[UUID | None, list[Column]] = {}
    for s in walked:
        level = titles.level_by_section[s.entity_type_id]
        columns.setdefault(level, []).extend((s, f) for f in s.fields)
    specs = [_articles_sheet(layout, titles.fixed["articles"], columns.get(None, []), publication)]
    specs.extend(
        _level_sheet(
            layout,
            s,
            titles.levels[s.entity_type_id],
            columns.get(s.entity_type_id, []),
            publication,
        )
        for s in walked
        if s.cardinality is ExtractionCardinality.MANY
    )
    return specs
