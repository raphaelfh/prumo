"""Tidy-tables sub-builder.

One records-as-rows sheet per template section, at the section's cardinality
grain (§5.3) — the publication "Table 1" sheets authors paste into a paper.
Pure renderer: the per-record rows + baked values live on
``ExportLayout.tidy_tables`` (a tuple of ``TidyTable``), built service-side.
"""

from __future__ import annotations

from app.services.exports.extraction.sheet_spec import Cell, CellStyle, SheetSpec
from app.services.extraction_export_service import ExportLayout, TidyTable

_HEADER = CellStyle(bold=True, fill="EEEEEE")
_RECORD_COL = "Record"
_SHEET_MAX_LEN = 31
_FORBIDDEN_SHEET_CHARS = set(r"[]:*?/\\")


def _safe_sheet_name(raw: str, *, fallback: str) -> str:
    cleaned = "".join(c for c in raw if c not in _FORBIDDEN_SHEET_CHARS).strip()
    cleaned = cleaned[:_SHEET_MAX_LEN]
    return cleaned or fallback


def _build_one(table: TidyTable, *, index: int) -> SheetSpec:
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
        title=_safe_sheet_name(table.title, fallback=f"Table {index + 1}"),
        rows=(header, *body),
        column_widths=widths,
        freeze="B2",
        tab_color="548235",
    )


def build_tidy_tables(layout: ExportLayout) -> list[SheetSpec]:
    return [_build_one(table, index=i) for i, table in enumerate(layout.tidy_tables)]
