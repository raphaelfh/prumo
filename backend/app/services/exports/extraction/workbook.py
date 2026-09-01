"""Workbook orchestrator for extraction exports.

Owns the PUBLIC ``build_workbook(layout, shape) -> bytes`` signature
consumed by the endpoint and the Celery worker. It assembles the workbook by calling
each pure sub-builder in §4 spec order via ``_ordered_specs`` — README /
Methods (#1), Summary (#2), the extraction matrix (#3), the per-section
tidy tables (#4..k), the Data dictionary (#k+2) and its co-located
Dropdown lists catalogue — rendering every non-``None`` ``SheetSpec``
through the single ``_render_sheet_spec`` writer, after a pre-build
column guard (§5.5). The README sub-builder absorbs the old Notes sheet;
the optional AI-metadata sheet is the trailing sub-builder, emitted only
when ``include_ai_metadata`` is set. ``shape`` (§3) narrows that order to
a subset of the same sheets, skipping the filtered-out builders entirely.
"""

from __future__ import annotations

import io
from enum import StrEnum

from fastapi import status
from openpyxl import Workbook

from app.core.error_handler import AppError
from app.services.exports.extraction.ai_metadata import build_ai_metadata
from app.services.exports.extraction.appraisal_summary import build_appraisal_summary
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


class ExportShape(StrEnum):
    """Which sheets the workbook carries (§3).

    Each shape is a SUBSET of the sheets the builders already produce — no
    shape adds a sheet, and README is in all three (it carries the template
    identity, the export provenance and the glyph legend, without which no
    other sheet reads correctly).

    It lives HERE, not on ``ExportLayout``: ``resolve_layout`` resolves the
    same layout whatever shape will be printed from it, so threading the value
    through the resolver would only ferry it to the one function that reads it.
    """

    COMPLETE = "complete"
    DICTIONARY = "dictionary"
    PUBLICATION = "publication"


#: Excel's hard ceiling on worksheet columns — XFD is column 16,384 (XLSX spec).
#: Public so the export service, endpoint, and guard tests share one source of
#: truth. ``_EXCEL_MAX_COLUMNS`` is kept as a private alias for in-module use.
EXCEL_MAX_COLUMNS = 16_384
_EXCEL_MAX_COLUMNS = EXCEL_MAX_COLUMNS


class ExportColumnLimitError(AppError, ValueError):
    """Raised pre-build when the matrix would exceed Excel's column cap.

    Subclasses both ``AppError`` (so the API surfaces the standard
    ``error.message`` envelope at HTTP 422 with the
    ``EXPORT_COLUMN_LIMIT_EXCEEDED`` code — this is a user-input problem,
    not a server fault) and ``ValueError`` (the clear, framework-agnostic
    "bad input" contract the pure builder package raises and its tests
    assert on).
    """

    def __init__(self, columns: int) -> None:
        super().__init__(
            code="EXPORT_COLUMN_LIMIT_EXCEEDED",
            message=(
                f"This export would produce {columns:,} columns, exceeding "
                f"Excel's limit of {EXCEL_MAX_COLUMNS:,} columns. Narrow the "
                "export mode, reviewers, or article selection and try again."
            ),
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
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


#: Which sub-builders each shape keeps (§3). Keyed on BUILDER IDENTITY, never
#: on sheet title: ``SheetSpec`` carries only a title, so a title-matching
#: filter would misfire on an instrument with a section named "Data
#: dictionary". A builder absent from the set is never called — the shape
#: saves the work rather than discarding its output.
_SHAPE_BUILDERS: dict[ExportShape, frozenset[str]] = {
    ExportShape.COMPLETE: frozenset(
        {
            "front_matter",
            "summary",
            "matrix",
            "tidy_tables",
            "appraisal_summary",
            "data_dictionary",
            "dropdown_lists",
            "ai_metadata",
        }
    ),
    ExportShape.DICTIONARY: frozenset({"front_matter", "data_dictionary", "dropdown_lists"}),
    ExportShape.PUBLICATION: frozenset({"front_matter", "tidy_tables", "appraisal_summary"}),
}


#: The builders that read resolved ARTICLE VALUES, as opposed to the template
#: snapshot. Derived from ``_SHAPE_BUILDERS`` rather than written beside it, so
#: a future shape's answer follows from the sheets it was given instead of
#: needing a second list somebody can forget to update.
_ARTICLE_BUILDERS: frozenset[str] = frozenset(
    {"summary", "matrix", "tidy_tables", "appraisal_summary", "ai_metadata"}
)


def shape_needs_articles(shape: ExportShape) -> bool:
    """Whether any sheet in ``shape`` reads resolved article values.

    False for the dictionary shape: README, Data dictionary and Dropdown lists
    are all projections of the TEMPLATE, so that workbook is meaningful before
    anyone has finalized a single run — which is exactly when you want it, while
    wiring another tool to the template. Callers use this to decide whether an
    empty eligible-article set is a reason to refuse the export.
    """
    return bool(_SHAPE_BUILDERS[shape] & _ARTICLE_BUILDERS)


def _ordered_specs(
    layout: ExportLayout,
    shape: ExportShape = ExportShape.COMPLETE,
) -> list[SheetSpec]:
    """Sheets in §4 order; ``None``-returning conditional builders are skipped.

    README/Methods (#1) absorbs the old Notes sheet; the Summary (#2) carries
    the omitted-by-stage tally. The matrix (#3) is followed by one tidy table
    per section (#4..k), the conditional Appraisal summary (#k+1, emitted only
    for quality-assessment templates where ``layout.appraisal`` is set), then
    the Data dictionary (#k+2) and its co-located Dropdown lists catalogue
    (emitted only when some field carries allowed values), and finally the
    optional AI-metadata sheet (emitted only when ``include_ai_metadata``).

    ``shape`` narrows that order to a subset (§3). Order is preserved: a shape
    only removes sheets, it never reorders or adds one.
    """
    keep = _SHAPE_BUILDERS[shape]
    specs: list[SheetSpec] = []
    if "front_matter" in keep:
        specs.append(build_front_matter(layout))  # #1 README / Methods
    if "summary" in keep:
        specs.append(build_summary(layout))  # #2 Summary
    if "matrix" in keep:
        specs.append(build_matrix(layout))  # #3 Extraction matrix
    if "tidy_tables" in keep:
        specs.extend(build_tidy_tables(layout))  # #4..k tidy tables
    if "appraisal_summary" in keep:
        appraisal = build_appraisal_summary(layout)  # #k+1 Appraisal summary
        if appraisal is not None:
            specs.append(appraisal)
    if "data_dictionary" in keep:
        specs.append(build_data_dictionary(layout))  # #k+2 Data dictionary
    if "dropdown_lists" in keep:
        dropdowns = build_dropdown_lists(layout)  # co-located catalogue
        if dropdowns is not None:
            specs.append(dropdowns)
    if "ai_metadata" in keep:
        ai_metadata = build_ai_metadata(layout)  # optional trailing sheet
        if ai_metadata is not None:
            specs.append(ai_metadata)
    return specs


def build_workbook(
    layout: ExportLayout,
    shape: ExportShape = ExportShape.COMPLETE,
) -> bytes:
    """Build the export workbook bytes for the given layout and shape.

    ``shape`` defaults to COMPLETE so every pre-shape caller keeps today's
    whole-workbook output.
    """
    _assert_within_column_limit(layout)

    wb = Workbook()
    default = wb.active
    if default is not None:
        wb.remove(default)

    # Render every pure sub-builder spec in §4 order. Titles arrive
    # sheet-name-safe (<=31 chars, no forbidden chars); de-duplicate so two
    # sections sharing a label cannot collide into one worksheet.
    seen_titles: set[str] = set()
    for spec in _ordered_specs(layout, shape):
        title = _unique_title(spec.title, seen_titles)
        seen_titles.add(title)
        ws = wb.create_sheet(title=title)
        _render_sheet_spec(ws, spec)
        ws.title = title

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


__all__ = [
    "EXCEL_MAX_COLUMNS",
    "ExportColumnLimitError",
    "ExportShape",
    "build_workbook",
    "shape_needs_articles",
]
