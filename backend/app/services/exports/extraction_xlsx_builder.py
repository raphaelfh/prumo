"""Pure XLSX builder for extraction exports.

Input: an ExportLayout (from `app.services.extraction_export_service`).
Output: the bytes of a valid `.xlsx` workbook.

This module performs NO I/O — no DB session, no storage adapter, no
network. That separation keeps the writer unit-testable without
fixtures.

Sheet order (FR-007):
    1. Main sheet — named after the active project template.
    2. AI metadata sheet (optional, when layout.include_ai_metadata).
    3. Notes sheet (always present).

Layout rules summary (FR-008 – FR-012):
    * Column A: section header on section rows, blank on field rows.
    * Column B: field label.
    * Columns C+: one column per (article, model_instance_or_single).
    * Article header is merged across all sub-columns of one article.
    * Study-section fields are *repeated* identically across all model
      sub-columns of an article (NEVER merged — FR-010).
    * Section-name rows are styled bold + light fill (FR-009).
"""

from __future__ import annotations

import io
from dataclasses import astuple
from typing import Any
from uuid import UUID

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

from app.models.extraction import ExtractionEntityRole, ExtractionFieldType
from app.services.extraction_export_service import (
    AIProposalRow,
    ArticleDescriptor,
    ExportLayout,
    ExportMode,
    FieldDescriptor,
    SectionDescriptor,
)

# ----------------------------------------------------------------------
# Styling — kept small. The reference workbook uses heavier styling;
# spec SC-003 only requires the structural skeleton.
# ----------------------------------------------------------------------

_SECTION_FONT = Font(bold=True)
_SECTION_FILL = PatternFill("solid", fgColor="EEEEEE")
_HEADER_FONT = Font(bold=True)
_HEADER_ALIGN = Alignment(horizontal="center", vertical="center")
_FIRST_COL_ALIGN = Alignment(horizontal="left", vertical="center", wrap_text=True)

#: Column index (1-based) of the first article data column. Columns A
#: and B are reserved for section + field labels.
_FIRST_DATA_COL = 3


def build_workbook(layout: ExportLayout) -> bytes:
    """Build the export workbook bytes for the given layout."""
    # We deliberately use the default (non-write-only) workbook so we can
    # apply mergedCells and post-row styling. The expected payload range
    # (≤ 500 articles × ≤ 100 fields × ~3 models) fits comfortably in
    # RAM with the default backend; the write-only path is reserved for
    # a future >5M-cell scenario.
    wb = Workbook()
    # Remove the default sheet created by openpyxl.
    default = wb.active
    if default is not None:
        wb.remove(default)

    _write_main_sheet(wb, layout)
    if layout.include_ai_metadata:
        _write_ai_metadata_sheet(wb, layout)
    _write_notes_sheet(wb, layout)

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


# ======================================================================
# Main sheet
# ======================================================================


def _write_main_sheet(workbook: Workbook, layout: ExportLayout) -> None:
    """Emit the column-per-article sheet (FR-006 – FR-012, FR-019, FR-020).

    All-users mode (FR-011) adds an extra reviewer-axis split: each
    article × model sub-column further splits into ``Consensus``
    + one sub-column per reviewer with at least one non-reject decision.
    """
    sheet_name = _safe_sheet_name(layout.template_name) or "Export"
    ws = workbook.create_sheet(title=sheet_name)

    if not layout.articles:
        ws.cell(row=1, column=1, value="(No eligible articles for the selected mode.)")
        ws.column_dimensions["A"].width = 60
        return

    is_all_users = layout.mode is ExportMode.ALL_USERS
    # reviewer_axis is the per-(article, model) sub-column list. For US1/US2
    # it's a single sentinel (None) meaning "one column". For US3 it's
    # [None, reviewer_id, reviewer_id, ...] where None = consensus column.
    reviewer_axis: tuple[UUID | None, ...]
    if is_all_users:
        reviewer_axis = (None,) + tuple(r.reviewer_id for r in layout.reviewers)
    else:
        reviewer_axis = (None,)

    # ------------------------------------------------------------------
    # 1. Header rows. Row 1 = article header (merged). Row 2 (US3 only)
    #    = reviewer sub-column labels (Consensus / Reviewer name).
    # ------------------------------------------------------------------
    ws.cell(row=1, column=1, value="Section").font = _HEADER_FONT
    ws.cell(row=1, column=2, value="Field").font = _HEADER_FONT

    article_spans: list[tuple[ArticleDescriptor, int, int]] = []
    col_cursor = _FIRST_DATA_COL
    for article in layout.articles:
        models_per_article = max(1, len(article.model_instances))
        span = models_per_article * len(reviewer_axis)
        cell = ws.cell(row=1, column=col_cursor, value=article.header_label)
        cell.font = _HEADER_FONT
        cell.alignment = _HEADER_ALIGN
        first = col_cursor
        last = col_cursor + span - 1
        if span > 1:
            ws.merge_cells(
                start_row=1, start_column=first, end_row=1, end_column=last,
            )
        article_spans.append((article, first, last))
        col_cursor += span

    header_offset = 1  # row 2 starts data
    if is_all_users:
        header_offset = 2
        # Row 2 — reviewer / Consensus labels under each article.
        cur = _FIRST_DATA_COL
        for article in layout.articles:
            models_per_article = max(1, len(article.model_instances))
            for _model_idx in range(models_per_article):
                for rev in reviewer_axis:
                    label = (
                        "Consensus"
                        if rev is None
                        else next(
                            (
                                r.display_label
                                for r in layout.reviewers
                                if r.reviewer_id == rev
                            ),
                            str(rev).split("-")[0],
                        )
                    )
                    c = ws.cell(row=2, column=cur, value=label)
                    c.font = _HEADER_FONT
                    c.alignment = _HEADER_ALIGN
                    cur += 1

    # ------------------------------------------------------------------
    # 2. Section + field rows.
    # ------------------------------------------------------------------
    row_cursor = header_offset + 1
    for section in layout.sections:
        if section.role is ExtractionEntityRole.MODEL_CONTAINER and not section.fields:
            continue

        section_cell = ws.cell(row=row_cursor, column=1, value=section.label)
        section_cell.font = _SECTION_FONT
        section_cell.fill = _SECTION_FILL
        last_col = col_cursor - 1
        if last_col > 1:
            ws.merge_cells(
                start_row=row_cursor,
                start_column=1,
                end_row=row_cursor,
                end_column=last_col,
            )
            for c in range(2, last_col + 1):
                ws.cell(row=row_cursor, column=c).fill = _SECTION_FILL
        row_cursor += 1

        for field in section.fields:
            ws.cell(row=row_cursor, column=2, value=field.label).alignment = (
                _FIRST_COL_ALIGN
            )
            for article, first_col, _last_col in article_spans:
                # Iterate (model_index × reviewer_axis) — model-major
                # so model sub-columns stay adjacent (FR-011 ordering).
                models_per_article = max(1, len(article.model_instances))
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
                            field=field,
                            reviewer_id=rev,
                        )
                        formatted = _format_cell(value, field)
                        if formatted is not None:
                            ws.cell(
                                row=row_cursor,
                                column=sub_col,
                                value=_xlsx_safe(formatted),
                            )
            row_cursor += 1

    # ------------------------------------------------------------------
    # 3. Column widths.
    # ------------------------------------------------------------------
    ws.column_dimensions["A"].width = 16
    ws.column_dimensions["B"].width = 36
    for col_idx in range(_FIRST_DATA_COL, col_cursor):
        ws.column_dimensions[get_column_letter(col_idx)].width = 24


def _resolve_instance_id(
    *,
    section: SectionDescriptor,
    article: ArticleDescriptor,
    model_index: int,
) -> UUID | None:
    """Return the instance_id whose values feed the given cell.

    * STUDY_SECTION: one instance per (article × entity_type). The same
      instance_id is reused across every model sub-column (FR-010
      repeat-not-merge).
    * MODEL_SECTION: the model_index-th model instance.
    * MODEL_CONTAINER: no own fields — caller already skipped.
    """
    if section.role is ExtractionEntityRole.STUDY_SECTION:
        return article.study_instances.get(section.entity_type_id)
    if section.role is ExtractionEntityRole.MODEL_SECTION:
        if not article.model_instances:
            return None
        # model_index is guaranteed in-range because the column was
        # emitted from article.model_instances.
        return article.model_instances[model_index]
    return None  # MODEL_CONTAINER / unknown — no values


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
        return layout.value_map.get(
            (article.run_id, instance_id, field.field_id, reviewer_id)
        )
    return layout.value_map.get((article.run_id, instance_id, field.field_id))


def _format_cell(value: Any, field: FieldDescriptor) -> Any:
    """Type-aware cell formatting (FR-019).

    * text/number/date/boolean → typed Python value (openpyxl writes
      typed cells, not stringified).
    * select → display label of the selected option.
    * multiselect → labels joined with ``"; "`` (semicolon-space to
      survive comma-bearing labels).
    """
    if value is None:
        return None

    ftype = field.type
    if ftype is ExtractionFieldType.BOOLEAN:
        # Localisation deferred — the dialog's UI locale is captured at
        # request time in a future iteration; default English keeps the
        # reference workbook semantics.
        return "Yes" if bool(value) else "No"
    if ftype is ExtractionFieldType.MULTISELECT:
        if isinstance(value, list):
            return "; ".join(str(item) for item in value if item is not None)
        return str(value)
    if ftype is ExtractionFieldType.SELECT:
        return str(value) if not isinstance(value, str) else value
    # text / number / date / unknown — pass through; openpyxl will pick
    # the right cell type from the Python value.
    return value


# ======================================================================
# AI metadata sheet (T042 — full implementation lands in US1 AI sub-flow)
# ======================================================================


def _write_ai_metadata_sheet(
    workbook: Workbook,
    layout: ExportLayout,
) -> None:
    """Flat-tabular AI metadata sheet (FR-036 – FR-040)."""
    ws = workbook.create_sheet(title="AI metadata")
    headers = [
        "Article",
        "Section",
        "Instance #",
        "Field",
        "AI proposed value",
        "Confidence",
        "Rationale",
        "Evidence text",
        "Evidence page(s)",
        "Proposed at",
        "Reviewer outcome",
        "Final value used",
    ]
    for col_idx, label in enumerate(headers, start=1):
        cell = ws.cell(row=1, column=col_idx, value=label)
        cell.font = _HEADER_FONT
        cell.alignment = _HEADER_ALIGN
        ws.column_dimensions[get_column_letter(col_idx)].width = 22

    rows: tuple[AIProposalRow, ...] = getattr(layout, "ai_proposal_rows", ()) or ()
    body_row = 2
    for row in rows:
        # ``astuple`` preserves the dataclass field order which the
        # ``AIProposalRow`` definition keeps lockstep with the header
        # row above. Numeric / datetime / None values are written typed.
        for col_idx, val in enumerate(astuple(row), start=1):
            ws.cell(row=body_row, column=col_idx, value=_xlsx_safe(val))
        body_row += 1

    if not rows:
        # FR-039 placeholder line.
        ws.cell(
            row=2,
            column=1,
            value="(No AI proposals recorded for the selected articles.)",
        )


def _xlsx_safe(value: Any) -> Any:
    """Convert values openpyxl cannot serialise natively.

    Lists / dicts → string; timezone-aware datetimes → naive UTC
    (openpyxl rejects tz-aware datetimes by default).
    """
    if value is None:
        return None
    if isinstance(value, list):
        return "; ".join(str(item) for item in value if item is not None)
    if isinstance(value, dict):
        # JSONB shapes the value-resolver missed. Stringify rather than
        # explode the sheet.
        return str(value)
    # Datetime handling — openpyxl raises on tz-aware datetimes.
    from datetime import datetime as _dt

    if isinstance(value, _dt) and value.tzinfo is not None:
        return value.replace(tzinfo=None)
    return value


# ======================================================================
# Notes sheet
# ======================================================================


def _write_notes_sheet(workbook: Workbook, layout: ExportLayout) -> None:
    """Always-present sheet documenting the export caveats (FR-007 §3)."""
    ws = workbook.create_sheet(title="Notes")
    notes = layout.notes
    rows: list[list[str]] = [
        [
            "Generated at",
            notes.generated_at.isoformat() if notes.generated_at else "",
        ],
        ["Template", f"{layout.template_name} (v{layout.template_version})"],
        ["Export mode", notes.export_mode_label or layout.mode.value],
        [
            "AI metadata sheet included",
            "yes" if layout.include_ai_metadata else "no",
        ],
        [
            "Reviewer names anonymized",
            "yes" if layout.anonymize_reviewer_names else "no",
        ],
    ]
    for stage, count in sorted(notes.omitted_articles_by_stage.items()):
        rows.append([f"Articles omitted (stage={stage})", str(count)])

    if notes.obsolete_fields_per_article:
        rows.append(["", ""])
        rows.append(["Obsolete fields per Run", ""])
        for article_id, labels in notes.obsolete_fields_per_article.items():
            rows.append([str(article_id), "; ".join(labels)])

    # FR-040 lineage caveat — always present.
    rows.append(["", ""])
    rows.append(
        [
            "Note",
            "Reviewer outcomes labelled '(best-effort)' rely on heuristics; "
            "the underlying data model does not preserve the exact "
            "AI-proposal → edited-value lineage. A future schema change "
            "(`edited_from_proposal_id` on reviewer decisions) would make "
            "these labels exact.",
        ]
    )

    for r in rows:
        ws.append(r)

    ws.column_dimensions["A"].width = 36
    ws.column_dimensions["B"].width = 80


# ======================================================================
# Helpers
# ======================================================================


_FORBIDDEN_SHEET_CHARS = set(r"[]:*?/\\")
_SHEET_MAX_LEN = 31


def _safe_sheet_name(raw: str) -> str:
    cleaned = "".join(c for c in raw if c not in _FORBIDDEN_SHEET_CHARS)
    cleaned = cleaned.strip()
    return cleaned[:_SHEET_MAX_LEN]


__all__ = ["build_workbook"]
