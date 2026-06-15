"""Dropdown lists sub-builder.

One column per field carrying ``allowed_values`` (select / multiselect);
header = field label, cells = the option labels down the column. Returns
``None`` when no field in the dictionary carries allowed values (§4 #k+2).
Pure: consumes ``ExportLayout.data_dictionary``.
"""

from __future__ import annotations

from app.services.exports.extraction.sheet_spec import Cell, CellStyle, SheetSpec
from app.services.extraction_export_service import ExportLayout

_HEADER = CellStyle(bold=True, fill="EEEEEE")


def build_dropdown_lists(layout: ExportLayout) -> SheetSpec | None:
    columns = [e for e in layout.data_dictionary if e.allowed_values]
    if not columns:
        return None

    header = tuple(Cell(e.label, _HEADER) for e in columns)
    max_options = max(len(e.allowed_values) for e in columns)

    body: list[tuple[Cell, ...]] = []
    for row_idx in range(max_options):
        row: list[Cell] = []
        for entry in columns:
            if row_idx < len(entry.allowed_values):
                row.append(Cell(entry.allowed_values[row_idx].label))
            else:
                row.append(Cell(None))
        body.append(tuple(row))

    return SheetSpec(
        title="Dropdown lists",
        rows=(header, *body),
        column_widths=tuple(24.0 for _ in columns),
        freeze="A2",
        tab_color="7F7F7F",
    )
