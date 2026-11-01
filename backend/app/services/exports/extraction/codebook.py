"""Codebook and Options sub-builders (spec §4.4).

Codebook: one row per field of any version a run pins, plus the active one.
Options: one row per ``(field_code, code)``. Both are pure projections of
``ExportLayout.codebook``; the ``sheet`` cell is the level title the field's
section lands on, read from ``SheetTitles`` (R8).
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from app.services.exports.extraction.sheet_spec import Cell, CellStyle, SheetSpec
from app.services.extraction_export_service import ExportLayout

if TYPE_CHECKING:
    from app.services.exports.extraction.workbook import SheetTitles

_HEADER = CellStyle(bold=True, fill="EEEEEE")

_CODEBOOK_HEADERS = (
    "field_code",
    "field_id",
    "sheet",
    "section_code",
    "section_label",
    "parent_section_code",
    "field_label",
    "type",
    "unit",
    "allowed_units",
    "required",
    "is_entity_key",
    "allowed_absent_codes",
    "allow_other",
    "description",
    "in_current_version",
    "versions",
)

_OPTIONS_HEADERS = ("field_code", "code", "label", "order", "in_current_version")


def _joined(items: tuple[object, ...]) -> str:
    return "; ".join(str(i) for i in items)


def build_codebook(layout: ExportLayout, titles: SheetTitles) -> SheetSpec:
    rows: list[tuple[Cell, ...]] = [tuple(Cell(h, _HEADER) for h in _CODEBOOK_HEADERS)]
    for e in layout.codebook:
        # ``sheet_for(None)`` is Articles; a section gone from the active tree is blank.
        sheet = None if e.section_id is None else titles.sheet_for(e.section_id)
        rows.append(
            (
                Cell(e.field_code),
                Cell(str(e.field_id)),
                Cell(sheet),
                Cell(e.section_code),
                Cell(e.section_label),
                Cell(e.parent_section_code),
                Cell(e.field_label),
                Cell(e.type.value),
                Cell(e.unit),
                Cell(_joined(e.allowed_units)),
                Cell(e.required),
                Cell(e.is_entity_key),
                Cell(_joined(e.allowed_absent_codes)),
                Cell(e.allow_other),
                Cell(e.description, CellStyle(wrap=True)),
                Cell(e.in_current_version),
                Cell(_joined(e.versions)),
            )
        )
    return SheetSpec(
        title=titles.fixed["codebook"],
        rows=tuple(rows),
        column_widths=(28.0, 38.0, 18.0, 18.0, 24.0, 18.0, 30.0, 12.0, 10.0)
        + (14.0,) * 5
        + (48.0, 12.0, 12.0),
        freeze="B2",
        tab_color="7F7F7F",
    )


def build_options(layout: ExportLayout, titles: SheetTitles) -> SheetSpec | None:
    title = titles.fixed.get("options")
    if title is None:
        return None
    rows: list[tuple[Cell, ...]] = [tuple(Cell(h, _HEADER) for h in _OPTIONS_HEADERS)]
    for e in layout.codebook:
        for o in e.options:
            rows.append(
                (
                    Cell(e.field_code),
                    Cell(o.code),
                    Cell(o.label),
                    Cell(o.order),
                    Cell(o.in_current_version),
                )
            )
    return SheetSpec(
        title=title,
        rows=tuple(rows),
        column_widths=(28.0, 24.0, 36.0, 8.0, 12.0),
        freeze="A2",
        tab_color="7F7F7F",
    )
