"""Extraction matrix sub-builder (§5.4) — fields-as-rows × record-columns.

Lifted from the legacy ``_write_main_sheet``: identical row/column geometry,
reviewer-axis fan-out, merged record headers and study-section
repeat-not-merge (009 FR-010). Emits a pure ``SheetSpec`` carrying the
publication-grade *structural* styling (spec §9): freeze panes (lock the
label block + header row), bold-centered header rows, bold/filled
section-band rows, a tab colour, left-wrap field labels and generic
hierarchical ``section.field`` numbering. Structural only — no conditional
formatting (no per-value tinting / traffic lights). Cells render through
``exports.values.display_value``; the fan-out helpers are package-local so
this module carries no runtime dependency on any legacy writer.
"""

from __future__ import annotations

from typing import TYPE_CHECKING
from uuid import UUID

from app.models.extraction import (
    ExtractionCardinality,
)
from app.services.exports.descriptors import (
    EntryColumn,
    build_columns,
    instance_for,
    primary_rater,
    value_key,
)
from app.services.exports.extraction.sheet_spec import (
    Cell,
    CellStyle,
    MergeSpan,
    SheetSpec,
)
from app.services.exports.values import ExportValue, display_value
from app.services.extraction_export_service import (
    ArticleDescriptor,
    ExportLayout,
    ExportMode,
    FieldDescriptor,
    SectionDescriptor,
)

if TYPE_CHECKING:
    from app.services.exports.extraction.workbook import SheetTitles

#: Column index (1-based) of the first article data column.
_FIRST_DATA_COL = 3

# Publication-grade STRUCTURAL styling only (spec §9): no conditional
# formatting (no per-value tinting / traffic lights). ``_render_sheet_spec``
# maps these to openpyxl Font/Alignment/PatternFill.
_HEADER_STYLE = CellStyle(bold=True, align="center", wrap=False)
_BAND_STYLE = CellStyle(bold=True, fill="EEEEEE", align="left")
_LABEL_STYLE = CellStyle(align="left", wrap=True)
_MATRIX_TAB_COLOR = "1F4E78"


def _article_columns(
    *, article: ArticleDescriptor, layout: ExportLayout
) -> tuple[EntryColumn, ...]:
    """The sub-columns of one article, one per entry the sheet shows.

    Replaces a count derived from ``len(article.model_instances)``. That
    tuple held every child-section instance flat, so an article with M
    entries and K singleton child sections reported M*K columns and the
    values landed on a diagonal — see
    ``tests/unit/test_extraction_export_golden_charms.py``.
    """
    return build_columns(layout.sections, article)


def _article_fanout_count(*, article: ArticleDescriptor, layout: ExportLayout) -> int:
    """Number of instance sub-columns for one article.

    Kept as a function because ``workbook._matrix_column_count`` feeds
    ``matrix_fits`` with it; it is now just the column count.
    """
    return len(_article_columns(article=article, layout=layout))


def _resolve_instance_id(
    *,
    section: SectionDescriptor,
    article: ArticleDescriptor,
    column: EntryColumn,
    layout: ExportLayout,
) -> UUID | None:
    """Return the instance_id whose values feed the given cell.

    A repeating section reads the entry this column selected; a singleton
    reads the one instance under its resolved parent, so a child is always
    read UNDER the entry on screen rather than at an index into a flat list.
    """
    return instance_for(section, article, column, layout.sections)


def _lookup_value(
    *,
    layout: ExportLayout,
    article: ArticleDescriptor,
    instance_id: UUID | None,
    field: FieldDescriptor,
    reviewer_id: UUID | None,
) -> ExportValue | None:
    """The typed value of one cell, read at ``reviewer_id``'s slot."""
    if instance_id is None or article.run_id is None:
        return None
    return layout.value_map.get(value_key(article.run_id, instance_id, field.field_id, reviewer_id))


def build_matrix(layout: ExportLayout, titles: SheetTitles) -> SheetSpec | None:
    """Build the data-entry matrix sheet, or ``None`` when its role is absent."""
    title = titles.fixed.get("matrix")
    if title is None:
        return None

    if not layout.articles:
        return SheetSpec(
            title=title,
            rows=((Cell("(No eligible articles for the selected mode.)"),),),
            column_widths=(60.0,),
        )

    is_all_users = layout.mode is ExportMode.ALL_USERS
    reviewer_axis: tuple[UUID | None, ...]
    if is_all_users:
        reviewer_axis = (None, *(r.reviewer_id for r in layout.reviewers))
    else:
        reviewer_axis = (primary_rater(layout.mode, layout.reviewer_id),)

    # Sparse cell grid: (row, col) -> (value, style). Rows/cols are 1-based;
    # styles mirror the legacy writer verbatim.
    grid: dict[tuple[int, int], tuple[object, CellStyle | None]] = {}
    merges: list[MergeSpan] = []

    grid[(1, 1)] = ("Section", _HEADER_STYLE)
    grid[(1, 2)] = ("Field", _HEADER_STYLE)

    article_spans: list[tuple[ArticleDescriptor, int, int]] = []
    col_cursor = _FIRST_DATA_COL
    for article in layout.articles:
        models_per_article = _article_fanout_count(article=article, layout=layout)
        span = models_per_article * len(reviewer_axis)
        grid[(1, col_cursor)] = (article.header_label, _HEADER_STYLE)
        first = col_cursor
        last = col_cursor + span - 1
        if span > 1:
            merges.append(MergeSpan(1, first, 1, last))
        article_spans.append((article, first, last))
        col_cursor += span

    header_offset = 1
    if is_all_users:
        header_offset = 2
        cur = _FIRST_DATA_COL
        for article in layout.articles:
            for _column in _article_columns(article=article, layout=layout):
                for rev in reviewer_axis:
                    label = (
                        "Consensus"
                        if rev is None
                        else next(
                            (r.display_label for r in layout.reviewers if r.reviewer_id == rev),
                            str(rev).split("-")[0],
                        )
                    )
                    grid[(2, cur)] = (label, _HEADER_STYLE)
                    cur += 1

    row_cursor = header_offset + 1
    section_number = 0
    for section in layout.sections:
        if section.cardinality is ExtractionCardinality.MANY and not section.fields:
            continue
        section_number += 1

        grid[(row_cursor, 1)] = (f"{section_number}. {section.label}", _BAND_STYLE)
        last_col = col_cursor - 1
        if last_col > 1:
            merges.append(MergeSpan(row_cursor, 1, row_cursor, last_col))
            for c in range(2, last_col + 1):
                grid.setdefault((row_cursor, c), (None, _BAND_STYLE))
        row_cursor += 1

        for field_number, field_desc in enumerate(section.fields, start=1):
            grid[(row_cursor, 2)] = (
                f"{section_number}.{field_number} {field_desc.label}",
                _LABEL_STYLE,
            )
            for article, first_col, _last_col in article_spans:
                slot = 0
                for column in _article_columns(article=article, layout=layout):
                    instance_id = _resolve_instance_id(
                        section=section,
                        article=article,
                        column=column,
                        layout=layout,
                    )
                    for rev in reviewer_axis:
                        sub_col = first_col + slot
                        slot += 1
                        value = _lookup_value(
                            layout=layout,
                            article=article,
                            instance_id=instance_id,
                            field=field_desc,
                            reviewer_id=rev,
                        )
                        if value is not None:
                            grid[(row_cursor, sub_col)] = (display_value(value, field_desc), None)
            row_cursor += 1

    max_row = row_cursor - 1
    max_col = col_cursor - 1
    rows = tuple(
        tuple(Cell(*grid.get((r, c), (None, None))) for c in range(1, max_col + 1))
        for r in range(1, max_row + 1)
    )

    widths: list[float | None] = [16.0, 36.0]
    widths += [24.0] * (max_col - 2)

    return SheetSpec(
        title=title,
        rows=rows,
        merges=tuple(merges),
        column_widths=tuple(widths),
        freeze=f"C{header_offset + 1}",
        tab_color=_MATRIX_TAB_COLOR,
    )


__all__ = ["build_matrix"]
