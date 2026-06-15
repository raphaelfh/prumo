"""Workbook orchestrator for extraction exports.

Owns the PUBLIC ``build_workbook(layout) -> bytes`` signature consumed by
the endpoint and the Celery worker. It assembles the workbook by calling
each pure sub-builder in §4 spec order via ``_ordered_specs`` — README /
Methods (#1), Summary (#2), the extraction matrix (#3), the per-section
tidy tables (#4..k), the Data dictionary (#k+2) and its co-located
Dropdown lists catalogue — rendering every non-``None`` ``SheetSpec``
through the single ``_render_sheet_spec`` writer, after a pre-build
column guard (§5.5). The README sub-builder absorbs the old Notes sheet;
the optional AI-metadata sheet (not yet migrated to a pure sub-builder)
is appended last via the legacy writer.
"""

from __future__ import annotations

import io

from openpyxl import Workbook

from app.core.error_handler import AppError
from app.services.exports.extraction.data_dictionary import build_data_dictionary
from app.services.exports.extraction.dropdown_lists import build_dropdown_lists
from app.services.exports.extraction.front_matter import build_front_matter
from app.services.exports.extraction.matrix import (
    _FIRST_DATA_COL,
    _article_fanout_count,
    build_matrix,
)
from app.services.exports.extraction.sheet_spec import SheetSpec, _render_sheet_spec
from app.services.exports.extraction.summary import build_summary
from app.services.exports.extraction.tidy_tables import build_tidy_tables
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


#: Excel caps worksheet titles at 31 characters.
_SHEET_MAX_LEN = 31


def _unique_title(title: str, seen: set[str]) -> str:
    """Return ``title`` (or a `` (n)``-suffixed variant) unique within ``seen``.

    Sub-builders already hand us sheet-name-safe titles; this only resolves
    collisions (two sections sharing a label) by appending an ordinal while
    keeping the result within Excel's 31-character ceiling.
    """
    if title not in seen:
        return title
    for n in range(2, 1000):
        suffix = f" ({n})"
        candidate = title[: _SHEET_MAX_LEN - len(suffix)] + suffix
        if candidate not in seen:
            return candidate
    return title  # pragma: no cover — 1000 same-named sections is pathological


def _ordered_specs(layout: ExportLayout) -> list[SheetSpec]:
    """Sheets in §4 order; ``None``-returning conditional builders are skipped.

    README/Methods (#1) absorbs the old Notes sheet; the Summary (#2) carries
    the omitted-by-stage tally. The matrix (#3) is followed by one tidy table
    per section (#4..k), then the Data dictionary (#k+2) and its co-located
    Dropdown lists catalogue (emitted only when some field carries allowed
    values). The optional AI-metadata sheet is appended by ``build_workbook``
    via the legacy writer until it gains a pure sub-builder.
    """
    specs: list[SheetSpec] = [
        build_front_matter(layout),  # #1 README / Methods
        build_summary(layout),  # #2 Summary
        build_matrix(layout),  # #3 Extraction matrix
    ]
    specs.extend(build_tidy_tables(layout))  # #4..k tidy tables
    specs.append(build_data_dictionary(layout))  # #k+2 Data dictionary
    dropdowns = build_dropdown_lists(layout)  # co-located catalogue
    if dropdowns is not None:
        specs.append(dropdowns)
    return specs


def build_workbook(layout: ExportLayout) -> bytes:
    """Build the export workbook bytes for the given layout."""
    # The legacy module re-exports this function, so its sheet writers are
    # imported lazily to avoid an import cycle.
    from app.services.exports.extraction_xlsx_builder import _write_ai_metadata_sheet

    _assert_within_column_limit(layout)

    wb = Workbook()
    default = wb.active
    if default is not None:
        wb.remove(default)

    # Render every pure sub-builder spec in §4 order. Titles arrive
    # sheet-name-safe (<=31 chars, no forbidden chars); de-duplicate so two
    # sections sharing a label cannot collide into one worksheet.
    seen_titles: set[str] = set()
    for spec in _ordered_specs(layout):
        title = _unique_title(spec.title, seen_titles)
        seen_titles.add(title)
        ws = wb.create_sheet(title=title)
        _render_sheet_spec(ws, spec)
        ws.title = title

    # AI metadata is the only legacy sheet left (no pure sub-builder yet);
    # appended last, after the §4 specs, only when toggled on.
    if layout.include_ai_metadata:
        _write_ai_metadata_sheet(wb, layout)

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


__all__ = ["ExportColumnLimitError", "build_workbook"]
