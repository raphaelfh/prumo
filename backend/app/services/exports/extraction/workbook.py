"""Workbook orchestrator for extraction exports.

Owns the PUBLIC ``build_workbook(layout) -> bytes`` signature consumed by
the endpoint and the Celery worker. It assembles the workbook by calling
each pure sub-builder in spec order (§4) and rendering the returned
``SheetSpec``s onto worksheets. During the slice-3 split it delegates the
not-yet-migrated sheets back to the legacy writers so behaviour stays
byte-identical at every step.
"""

from __future__ import annotations

import io

from openpyxl import Workbook

from app.services.extraction_export_service import ExportLayout


def build_workbook(layout: ExportLayout) -> bytes:
    """Build the export workbook bytes for the given layout."""
    # The matrix sheet is now a pure sub-builder; the remaining sheets stay on
    # the legacy writers until later in the split. The legacy module is
    # imported lazily to avoid an import cycle (it re-exports this function).
    from app.services.exports.extraction.matrix import build_matrix
    from app.services.exports.extraction.sheet_spec import _render_sheet_spec
    from app.services.exports.extraction_xlsx_builder import (
        _assert_column_budget,
        _write_ai_metadata_sheet,
        _write_notes_sheet,
    )

    _assert_column_budget(layout)

    wb = Workbook()
    default = wb.active
    if default is not None:
        wb.remove(default)

    matrix_ws = wb.create_sheet(title="matrix")
    _render_sheet_spec(matrix_ws, build_matrix(layout))
    if layout.include_ai_metadata:
        _write_ai_metadata_sheet(wb, layout)
    _write_notes_sheet(wb, layout)

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


__all__ = ["build_workbook"]
