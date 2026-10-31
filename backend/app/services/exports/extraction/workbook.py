"""Workbook orchestrator for extraction exports.

Owns the PUBLIC ``build_workbook(layout, shape, *, include_matrix) -> bytes`` signature
consumed by the endpoint and the Celery worker. It assembles the workbook by calling
each pure sub-builder in §4 spec order via ``_ordered_specs`` — README /
Methods (#1), Summary (#2), the extraction matrix (#3), the per-section
tidy tables (#4..k), the Data dictionary (#k+2) and its co-located
Dropdown lists catalogue — rendering every non-``None`` ``SheetSpec``
through the single ``_render_sheet_spec`` writer, after a pre-build
column guard (§5.5). Every title is allocated first by ``allocate_titles``
and each sub-builder reads its own from the resulting ``SheetTitles``.
The README sub-builder absorbs the old Notes sheet;
the optional AI proposals sheet is the trailing sub-builder, emitted only
when ``include_ai_metadata`` is set. ``shape`` (§3) narrows that order to
a subset of the same sheets, skipping the filtered-out builders entirely.
"""

from __future__ import annotations

import io
from collections.abc import Mapping
from dataclasses import dataclass
from enum import StrEnum
from uuid import UUID

from openpyxl import Workbook

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
from app.services.exports.extraction.sheet_spec import (
    RESERVED_TITLES,
    SheetSpec,
    _render_sheet_spec,
    safe_sheet_title,
)
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
EXCEL_MAX_COLUMNS = 16_384


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


def matrix_fits(layout: ExportLayout) -> bool:
    """True when the Matrix sheet fits Excel's column ceiling."""
    return _matrix_column_count(layout) <= EXCEL_MAX_COLUMNS


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
            "ai_proposals",
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
    {"summary", "matrix", "tidy_tables", "appraisal_summary", "ai_proposals"}
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


#: Title of every fixed (non-section) sheet, keyed on builder id (R7, R8a).
_FIXED_TITLES: dict[str, str] = {
    "front_matter": "README",
    "summary": "Summary",
    "matrix": "Matrix",
    "appraisal_summary": "Appraisal",
    "data_dictionary": "Data dictionary",
    "dropdown_lists": "Dropdown lists",
    "ai_proposals": "AI proposals",
}

#: Fixed titles outside ``RESERVED_TITLES`` that a section title must still
#: never take, whether or not their sheet is emitted.
_NON_RESERVED_FIXED: tuple[str, ...] = ("Data dictionary", "Dropdown lists")

#: §4 sheet order; ``tidy_tables`` expands to one sheet per section.
_ROLE_ORDER: tuple[str, ...] = (
    "front_matter",
    "summary",
    "matrix",
    "tidy_tables",
    "appraisal_summary",
    "data_dictionary",
    "dropdown_lists",
    "ai_proposals",
)


@dataclass(frozen=True, slots=True)
class SheetTitles:
    """Every sheet title of one workbook, allocated before any sheet is built.

    ``fixed`` maps each PRESENT fixed role (builder id) to its title; a
    conditional builder whose role is absent returns ``None``. ``levels`` maps
    ``TidyTable.section_id`` to its de-duplicated title. ``order`` is the
    rendered sheet list, which the README Contents block prints verbatim.
    """

    fixed: Mapping[str, str]
    levels: Mapping[UUID, str]
    order: tuple[str, ...]
    matrix_omitted: bool


def _role_present(role: str, layout: ExportLayout, *, include_matrix: bool) -> bool:
    if role == "matrix":
        return include_matrix
    if role == "appraisal_summary":
        return layout.appraisal is not None
    if role == "dropdown_lists":
        return any(e.allowed_values for e in layout.data_dictionary)
    if role == "ai_proposals":
        return layout.include_ai_metadata
    return True


def allocate_titles(
    layout: ExportLayout, shape: ExportShape, *, include_matrix: bool
) -> SheetTitles:
    """Allocate every sheet title of ``shape`` in one pass (§4 order).

    Reserved and fixed titles are claimed first, so a section labelled
    "History" or "data dictionary" gets a suffixed title instead of
    colliding with a fixed sheet.
    """
    keep = _SHAPE_BUILDERS[shape]
    taken: list[str] = [*RESERVED_TITLES, *_NON_RESERVED_FIXED]
    levels: dict[UUID, str] = {}
    if "tidy_tables" in keep:
        for i, table in enumerate(layout.tidy_tables):
            title = safe_sheet_title(table.title, taken, fallback=f"Table {i + 1}")
            taken.append(title)
            levels[table.section_id] = title

    fixed: dict[str, str] = {}
    order: list[str] = []
    for role in _ROLE_ORDER:
        if role not in keep:
            continue
        if role == "tidy_tables":
            order.extend(levels.values())
        elif _role_present(role, layout, include_matrix=include_matrix):
            fixed[role] = _FIXED_TITLES[role]
            order.append(fixed[role])
    return SheetTitles(
        fixed=fixed,
        levels=levels,
        order=tuple(order),
        matrix_omitted="matrix" in keep and not include_matrix,
    )


def _ordered_specs(
    layout: ExportLayout, shape: ExportShape, titles: SheetTitles
) -> list[SheetSpec]:
    """Sheets in §4 order; ``None``-returning conditional builders are skipped.

    README/Methods (#1) absorbs the old Notes sheet; the Summary (#2) carries
    the omitted-by-stage tally. The matrix (#3) is followed by one tidy table
    per section (#4..k), the conditional Appraisal sheet (#k+1, emitted only
    for quality-assessment templates where ``layout.appraisal`` is set), then
    the Data dictionary (#k+2) and its co-located Dropdown lists catalogue
    (emitted only when some field carries allowed values), and finally the
    optional AI proposals sheet (emitted only when ``include_ai_metadata``).

    ``shape`` narrows that order to a subset (§3). Order is preserved: a shape
    only removes sheets, it never reorders or adds one. Which conditional
    sheets are present was decided once, in ``allocate_titles``.
    """
    keep = _SHAPE_BUILDERS[shape]
    specs: list[SheetSpec | None] = []
    if "front_matter" in keep:
        specs.append(build_front_matter(layout, titles))  # #1 README / Methods
    if "summary" in keep:
        specs.append(build_summary(layout, titles))  # #2 Summary
    if "matrix" in keep:
        specs.append(build_matrix(layout, titles))  # #3 Extraction matrix
    if "tidy_tables" in keep:
        specs.extend(build_tidy_tables(layout, titles))  # #4..k tidy tables
    if "appraisal_summary" in keep:
        specs.append(build_appraisal_summary(layout, titles))  # #k+1 Appraisal
    if "data_dictionary" in keep:
        specs.append(build_data_dictionary(layout, titles))  # #k+2 Data dictionary
    if "dropdown_lists" in keep:
        specs.append(build_dropdown_lists(layout, titles))  # co-located catalogue
    if "ai_proposals" in keep:
        specs.append(build_ai_metadata(layout, titles))  # optional trailing sheet
    return [spec for spec in specs if spec is not None]


def build_workbook(layout: ExportLayout, shape: ExportShape, *, include_matrix: bool) -> bytes:
    """Build the export workbook bytes for the given layout and shape."""
    titles = allocate_titles(layout, shape, include_matrix=include_matrix)

    wb = Workbook()
    default = wb.active
    if default is not None:
        wb.remove(default)

    # Titles were allocated unique and Excel-safe by ``allocate_titles``.
    for spec in _ordered_specs(layout, shape, titles):
        _render_sheet_spec(wb.create_sheet(title=spec.title), spec)

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


__all__ = [
    "EXCEL_MAX_COLUMNS",
    "ExportShape",
    "SheetTitles",
    "allocate_titles",
    "build_workbook",
    "matrix_fits",
    "shape_needs_articles",
]
