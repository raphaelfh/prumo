"""Extraction matrix sub-builder (§5.4) — fields-as-rows × record-columns.

Lifted verbatim from the legacy ``_write_main_sheet``: identical row/column
geometry, reviewer-axis fan-out, merged record headers, study-section
repeat-not-merge (009 FR-010) and the existing FR-009 section/header
styling. Emits a pure ``SheetSpec``; the publication-grade *structural*
styling (freeze panes, hierarchical numbering, tab colour, typed cells)
is layered on in the next step. The value-resolution + fan-out helpers are
imported from the legacy module so behaviour is byte-equivalent during the
split.
"""

from __future__ import annotations

from uuid import UUID

from app.models.extraction import ExtractionEntityRole
from app.services.exports.extraction.sheet_spec import (
    Cell,
    CellStyle,
    MergeSpan,
    SheetSpec,
)
from app.services.extraction_export_service import (
    ArticleDescriptor,
    ExportLayout,
    ExportMode,
)

#: Column index (1-based) of the first article data column.
_FIRST_DATA_COL = 3

_FORBIDDEN_SHEET_CHARS = set(r"[]:*?/\\")
_SHEET_MAX_LEN = 31

# Verbatim mirror of the legacy ``_write_main_sheet`` styling so the lift
# keeps existing builder tests green. ``_render_sheet_spec`` maps these to
# the same openpyxl Font/Alignment/PatternFill the legacy writer produced.
_HEADER_STYLE = CellStyle(bold=True)
_HEADER_CENTER_STYLE = CellStyle(bold=True, align="center")
_SECTION_STYLE = CellStyle(bold=True, fill="EEEEEE")
_SECTION_FILL_STYLE = CellStyle(fill="EEEEEE")
_LABEL_STYLE = CellStyle(align="left", wrap=True)


def _safe_sheet_name(raw: str) -> str:
    cleaned = "".join(c for c in raw if c not in _FORBIDDEN_SHEET_CHARS).strip()
    return cleaned[:_SHEET_MAX_LEN]


def build_matrix(layout: ExportLayout) -> SheetSpec:
    """Build the data-entry matrix sheet as a pure SheetSpec."""
    from app.services.exports.extraction_xlsx_builder import (
        _article_fanout_count,
        _format_cell,
        _lookup_value,
        _resolve_instance_id,
        _xlsx_safe,
    )

    title = _safe_sheet_name(layout.template_name) or "Export"

    if not layout.articles:
        return SheetSpec(
            title=title,
            rows=((Cell("(No eligible articles for the selected mode.)"),),),
            column_widths=(60.0,),
        )

    is_all_users = layout.mode is ExportMode.ALL_USERS
    reviewer_axis: tuple[UUID | None, ...]
    if is_all_users:
        reviewer_axis = (None,) + tuple(r.reviewer_id for r in layout.reviewers)
    else:
        reviewer_axis = (None,)

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
        grid[(1, col_cursor)] = (article.header_label, _HEADER_CENTER_STYLE)
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
            models_per_article = _article_fanout_count(article=article, layout=layout)
            for _model_idx in range(models_per_article):
                for rev in reviewer_axis:
                    label = (
                        "Consensus"
                        if rev is None
                        else next(
                            (r.display_label for r in layout.reviewers if r.reviewer_id == rev),
                            str(rev).split("-")[0],
                        )
                    )
                    grid[(2, cur)] = (label, _HEADER_CENTER_STYLE)
                    cur += 1

    row_cursor = header_offset + 1
    for section in layout.sections:
        if section.role is ExtractionEntityRole.MODEL_CONTAINER and not section.fields:
            continue

        grid[(row_cursor, 1)] = (section.label, _SECTION_STYLE)
        last_col = col_cursor - 1
        if last_col > 1:
            merges.append(MergeSpan(row_cursor, 1, row_cursor, last_col))
            for c in range(2, last_col + 1):
                grid[(row_cursor, c)] = (None, _SECTION_FILL_STYLE)
        row_cursor += 1

        for field_desc in section.fields:
            grid[(row_cursor, 2)] = (field_desc.label, _LABEL_STYLE)
            for article, first_col, _last_col in article_spans:
                models_per_article = _article_fanout_count(article=article, layout=layout)
                slot = 0
                for model_idx in range(models_per_article):
                    instance_id = _resolve_instance_id(
                        section=section,
                        article=article,
                        model_index=model_idx,
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
                        formatted = _format_cell(value, field_desc)
                        if formatted is not None:
                            grid[(row_cursor, sub_col)] = (_xlsx_safe(formatted), None)
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
    )


__all__ = ["build_matrix"]
