"""Data dictionary sub-builder.

One row per field with its full metadata (§4 #k+2). Doubles as the catalogue
the Dropdown lists sheet narrows. Pure: consumes ``ExportLayout.data_dictionary``.
"""

from __future__ import annotations

from app.services.exports.extraction.sheet_spec import Cell, CellStyle, SheetSpec
from app.services.extraction_export_service import ExportLayout, FieldDictEntry

_HEADER = CellStyle(bold=True, fill="EEEEEE")

_HEADERS = (
    "Section",
    "Field",
    "Type",
    "Unit",
    "Description",
    "Allowed values",
    "Required",
    "Allow other",
)


def _allowed_values_text(entry: FieldDictEntry) -> str:
    return "; ".join(
        av.label if av.label == av.value else f"{av.value} ({av.label})"
        for av in entry.allowed_values
    )


def _yes_no(flag: bool) -> str:
    return "Yes" if flag else "No"


def build_data_dictionary(layout: ExportLayout) -> SheetSpec:
    rows: list[tuple[Cell, ...]] = [tuple(Cell(h, _HEADER) for h in _HEADERS)]
    for entry in layout.data_dictionary:
        rows.append(
            (
                Cell(entry.section_label),
                Cell(entry.label),
                Cell(entry.type.value),
                Cell(entry.unit or ""),
                Cell(entry.description or "", CellStyle(wrap=True)),
                Cell(_allowed_values_text(entry), CellStyle(wrap=True)),
                Cell(_yes_no(entry.is_required)),
                Cell(_yes_no(entry.allow_other)),
            )
        )
    return SheetSpec(
        title="Data dictionary",
        rows=tuple(rows),
        column_widths=(24.0, 30.0, 12.0, 14.0, 48.0, 40.0, 10.0, 12.0),
        freeze="A2",
        tab_color="7F7F7F",
    )
