"""Tidy-tables sub-builder.

One records-as-rows sheet per template section, at the section's cardinality
grain (§5.3) — the publication "Table 1" sheets authors paste into a paper.
Pure renderer: the per-record rows + baked values live on
``ExportLayout.tidy_tables`` (a tuple of ``TidyTable``), built service-side.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from app.services.exports.extraction.sheet_spec import Cell, CellStyle, SheetSpec
from app.services.extraction_export_service import ExportLayout, TidyTable

if TYPE_CHECKING:
    from app.services.exports.extraction.workbook import SheetTitles

_HEADER = CellStyle(bold=True, fill="EEEEEE")
_RECORD_COL = "Record"


def _build_one(table: TidyTable, *, title: str) -> SheetSpec:
    header = (
        Cell(_RECORD_COL, _HEADER),
        *(Cell(lbl, _HEADER) for lbl in table.column_labels),
    )
    body: list[tuple[Cell, ...]] = []
    for row in table.rows:
        cells = [Cell(row.record_label)]
        cells.extend(Cell(v) for v in row.values)
        body.append(tuple(cells))

    widths = (36.0, *(24.0 for _ in table.column_labels))
    return SheetSpec(
        title=title,
        rows=(header, *body),
        column_widths=widths,
        freeze="B2",
        tab_color="548235",
    )


def build_tidy_tables(layout: ExportLayout, titles: SheetTitles) -> list[SheetSpec]:
    return [
        _build_one(table, title=titles.levels[table.section_id]) for table in layout.tidy_tables
    ]
