"""Extraction matrix sub-builder (§5.4) — fields-as-rows × record-columns.

Lifted from the legacy ``_write_main_sheet``: identical row/column geometry,
reviewer-axis fan-out, merged record headers and study-section
repeat-not-merge (009 FR-010). Emits a pure ``SheetSpec`` carrying the
publication-grade *structural* styling (spec §9): freeze panes (lock the
label block + header row), bold-centered header rows, bold/filled
section-band rows, a tab colour, left-wrap field labels and generic
hierarchical ``section.field`` numbering. Structural only — no conditional
formatting (no per-value tinting / traffic lights). The value-resolution +
fan-out helpers are package-local so this module carries no runtime
dependency on the legacy ``extraction_xlsx_builder`` (which a sibling slice
removes).
"""

from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from app.models.extraction import (
    ExtractionCardinality,
    ExtractionEntityRole,
)
from app.services.exports.extraction.sheet_spec import (
    Cell,
    CellStyle,
    MergeSpan,
    SheetSpec,
)
from app.services.exports.value_envelope import format_export_scalar
from app.services.extraction_export_service import (
    ArticleDescriptor,
    ExportLayout,
    ExportMode,
    FieldDescriptor,
    SectionDescriptor,
)

#: Column index (1-based) of the first article data column.
_FIRST_DATA_COL = 3

_FORBIDDEN_SHEET_CHARS = set(r"[]:*?/\\")
_SHEET_MAX_LEN = 31

# Publication-grade STRUCTURAL styling only (spec §9): no conditional
# formatting (no per-value tinting / traffic lights). ``_render_sheet_spec``
# maps these to openpyxl Font/Alignment/PatternFill.
_HEADER_STYLE = CellStyle(bold=True, align="center", wrap=False)
_BAND_STYLE = CellStyle(bold=True, fill="EEEEEE", align="left")
_LABEL_STYLE = CellStyle(align="left", wrap=True)
_MATRIX_TAB_COLOR = "1F4E78"


def _safe_sheet_name(raw: str) -> str:
    cleaned = "".join(c for c in raw if c not in _FORBIDDEN_SHEET_CHARS).strip()
    return cleaned[:_SHEET_MAX_LEN]


def _article_fanout_count(*, article: ArticleDescriptor, layout: ExportLayout) -> int:
    """Number of instance sub-columns for one article.

    The fan-out grain is the MAX instance count across the article's
    instance-bearing sections, with a floor of 1:

      * MODEL_SECTION is *always* a model-instance axis (driven by
        ``article.model_instances``) regardless of its own cardinality —
        in production every model section carries ``cardinality='one'``
        and the N-model fan-out comes from the snapshot reader splitting
        instances by role (extraction_export_service §5.2), never from a
        section being ``cardinality='many'``.
      * Any non-model section contributes only when it is
        ``cardinality='many'`` (its instances live in
        ``section_instances``).

    We do NOT cartesian-product independent axes (design §5.4 — one
    instance axis per article); a section with fewer instances repeats
    its last value.
    """
    counts = [1]
    for section in layout.sections:
        if section.role is ExtractionEntityRole.MODEL_SECTION:
            counts.append(max(1, len(article.model_instances)))
        elif section.cardinality is ExtractionCardinality.MANY:
            counts.append(max(1, len(article.section_instances.get(section.entity_type_id, ()))))
    return max(counts)


def _resolve_instance_id(
    *,
    section: SectionDescriptor,
    article: ArticleDescriptor,
    model_index: int,
) -> UUID | None:
    """Return the instance_id whose values feed the given cell.

    The instance axis is selected by role first, then cardinality:
      * MODEL_SECTION → the ``model_index``-th model instance (from
        ``article.model_instances``), clamped to the last when the
        article has fewer models than the fan-out width. This holds
        regardless of the section's own cardinality, because production
        model sections are ``cardinality='one'`` and the N-model fan-out
        is sourced from ``model_instances`` (extraction_export_service
        §5.2), not from the section being ``cardinality='many'``.
      * non-model, cardinality='many' → the ``model_index``-th instance
        of that entity_type (from ``section_instances``), clamped to the
        last when its own list is shorter than the fan-out width.
      * non-model, cardinality='one' → the single instance for the
        section's entity_type, repeated across every sub-column (§5.4
        repeat-not-merge).
    """
    if section.role is ExtractionEntityRole.MODEL_CONTAINER:
        return None  # no own fields — caller already skipped
    if section.role is ExtractionEntityRole.MODEL_SECTION:
        if not article.model_instances:
            return None
        idx = min(model_index, len(article.model_instances) - 1)
        return article.model_instances[idx]
    if section.cardinality is ExtractionCardinality.MANY:
        ids = article.section_instances.get(section.entity_type_id, ())
        if not ids:
            return None
        idx = min(model_index, len(ids) - 1)
        return ids[idx]
    # cardinality='one' — single instance, repeated across sub-columns.
    ids = article.section_instances.get(section.entity_type_id, ())
    return ids[0] if ids else None


def _lookup_value(
    *,
    layout: ExportLayout,
    article: ArticleDescriptor,
    instance_id: UUID | None,
    field: FieldDescriptor,
    reviewer_id: UUID | None = None,
) -> Any:
    """Look up the typed Python value for a cell from the value_map.

    Key shape is mode-dependent:
      * Consensus / Single-user: ``(run_id, instance_id, field_id)``.
      * All-users: ``(run_id, instance_id, field_id, reviewer_id|None)``;
        ``None`` = consensus sub-column.
    """
    if instance_id is None or article.run_id is None:
        return None
    if layout.mode is ExportMode.ALL_USERS:
        return layout.value_map.get((article.run_id, instance_id, field.field_id, reviewer_id))
    return layout.value_map.get((article.run_id, instance_id, field.field_id))


def _format_cell(value: Any, field: FieldDescriptor) -> Any:
    """Type-aware cell formatting for an ALREADY-RESOLVED matrix value.

    Values arrive pre-resolved from ``resolve_value`` (no dicts). This
    only applies the residual openpyxl-cell shaping shared with the AI
    sheet via ``format_export_scalar``; multiselect lists (if any survive
    as lists) are joined here.

    NOTE: non-list scalars are delegated verbatim to
    ``format_export_scalar`` (value_envelope). That helper only flips a
    *real* ``bool`` instance for a BOOLEAN field — a pre-resolved string
    such as ``"No"`` (the consensus builder already collapsed the boolean
    via ``resolve_value``) passes through untouched. A local
    ``bool(value)`` re-implementation would mis-render the truthy string
    ``"No"`` as ``"Yes"`` and silently invert every False boolean cell.
    """
    if value is None:
        return None
    if isinstance(value, list):
        return "; ".join(str(item) for item in value if item is not None)
    return format_export_scalar(value, field=field)


def _xlsx_safe(value: Any) -> Any:
    """Coerce only the openpyxl-incompatible-but-expected shapes.

    Lists are joined; tz-aware datetimes are made naive. A ``dict`` is NOT
    silently stringified: by §6 every envelope is collapsed to a scalar by
    ``resolve_value`` upstream, so a dict here is a resolver defect that
    must fail loudly (openpyxl raises) rather than ship a Python-repr cell.
    """
    if value is None:
        return None
    if isinstance(value, list):
        return "; ".join(str(item) for item in value if item is not None)
    if isinstance(value, datetime) and value.tzinfo is not None:
        return value.replace(tzinfo=None)
    return value


def build_matrix(layout: ExportLayout) -> SheetSpec:
    """Build the data-entry matrix sheet as a pure SheetSpec."""
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
                    grid[(2, cur)] = (label, _HEADER_STYLE)
                    cur += 1

    row_cursor = header_offset + 1
    section_number = 0
    for section in layout.sections:
        if section.role is ExtractionEntityRole.MODEL_CONTAINER and not section.fields:
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
        freeze=f"C{header_offset + 1}",
        tab_color=_MATRIX_TAB_COLOR,
    )


__all__ = ["build_matrix"]
