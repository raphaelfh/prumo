"""Workbook orchestrator for extraction exports.

Owns the PUBLIC ``build_workbook(layout) -> bytes`` signature consumed by
the endpoint and the Celery worker. It assembles the workbook by calling
each pure sub-builder in spec order (§4), rendering every non-``None``
``SheetSpec`` via the single ``_render_sheet_spec`` writer, after a
pre-build column guard (§5.5). Sheets not yet migrated to a pure
sub-builder (AI metadata, Notes) are appended via the legacy writers so
the sheet order stays stable (matrix → AI → Notes).
"""

from __future__ import annotations

import io

from openpyxl import Workbook

from app.core.error_handler import AppError
from app.services.exports.extraction.matrix import (
    _FIRST_DATA_COL,
    _article_fanout_count,
    build_matrix,
)
from app.services.exports.extraction.sheet_spec import SheetSpec, _render_sheet_spec
from app.services.extraction_export_service import ExportLayout, ExportMode

#: Excel's hard ceiling — XFD is column 16,384.
_EXCEL_MAX_COLUMNS = 16_384


class ExportColumnLimitError(AppError, ValueError):
    """Raised pre-build when the matrix would exceed Excel's column cap.

    Subclasses both ``AppError`` (so the API surfaces the standard
    ``error.message`` envelope with the ``EXPORT_COLUMN_LIMIT_EXCEEDED``
    code) and ``ValueError`` (the clear, framework-agnostic "bad input"
    contract the pure builder package raises and its tests assert on).
    """

    def __init__(self, columns: int) -> None:
        super().__init__(
            code="EXPORT_COLUMN_LIMIT_EXCEEDED",
            message=(
                f"This export would produce {columns} columns, exceeding "
                f"Excel's limit of {_EXCEL_MAX_COLUMNS}. Narrow the export "
                "mode, reviewers, or article selection and try again."
            ),
        )


def _matrix_column_count(layout: ExportLayout) -> int:
    """Worst-case matrix width = 2 label cols + per-record sub-columns.

    Per-article fan-out reuses the matrix builder's own
    ``_article_fanout_count`` (which honours both the model-instance axis
    and ``cardinality='many'`` sections), so the guard counts exactly the
    columns the matrix will emit. All-users mode multiplies each record by
    the reviewer axis (consensus + one column per reviewer).
    """
    if not layout.articles:
        return 1
    reviewer_slots = 1
    if layout.mode is ExportMode.ALL_USERS:
        reviewer_slots = 1 + len(layout.reviewers)
    data_cols = 0
    for article in layout.articles:
        data_cols += _article_fanout_count(article=article, layout=layout) * reviewer_slots
    return (_FIRST_DATA_COL - 1) + data_cols


def _assert_within_column_limit(layout: ExportLayout) -> None:
    cols = _matrix_column_count(layout)
    if cols > _EXCEL_MAX_COLUMNS:
        raise ExportColumnLimitError(cols)


def build_workbook(layout: ExportLayout) -> bytes:
    """Build the export workbook bytes for the given layout."""
    # The legacy module re-exports this function, so its sheet writers are
    # imported lazily to avoid an import cycle.
    from app.services.exports.extraction_xlsx_builder import (
        _write_ai_metadata_sheet,
        _write_notes_sheet,
    )

    _assert_within_column_limit(layout)

    wb = Workbook()
    default = wb.active
    if default is not None:
        wb.remove(default)

    # Ordered pure sub-builders (each -> SheetSpec | None). Only the matrix
    # is migrated in this slice; tidy tables / summary / front-matter / etc.
    # land in later slices and slot into this list in spec order.
    specs: list[SheetSpec | None] = [build_matrix(layout)]
    for spec in specs:
        if spec is None:
            continue
        ws = wb.create_sheet(title=spec.title)
        _render_sheet_spec(ws, spec)

    # Legacy sheets (not yet migrated) appended after the rendered specs.
    if layout.include_ai_metadata:
        _write_ai_metadata_sheet(wb, layout)
    _write_notes_sheet(wb, layout)

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


__all__ = ["ExportColumnLimitError", "build_workbook"]
