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

from dataclasses import astuple
from typing import Any
from uuid import UUID

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

from app.core.error_handler import AppError
from app.models.extraction import ExtractionCardinality, ExtractionEntityRole
from app.services.exports.value_envelope import format_export_scalar
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

#: Excel's hard cap on the number of columns in a worksheet.
_EXCEL_MAX_COLUMNS = 16_384


def _assert_column_budget(layout: ExportLayout) -> None:
    """Reject layouts that would exceed Excel's hard 16,384-column cap.

    Fail loud and early with a clear message instead of letting openpyxl
    crash mid-build (design §5.5). Worst case is all-users mode with many
    articles × instances × reviewers.
    """
    reviewer_axis_width = (len(layout.reviewers) + 1) if layout.mode is ExportMode.ALL_USERS else 1
    total = _FIRST_DATA_COL - 1  # label columns A + B
    for article in layout.articles:
        total += _article_fanout_count(article=article, layout=layout) * reviewer_axis_width
        if total > _EXCEL_MAX_COLUMNS:
            raise AppError(
                code="EXPORT_COLUMN_LIMIT_EXCEEDED",
                message=(
                    "This export would produce "
                    f"{total} columns, exceeding Excel's limit of "
                    f"{_EXCEL_MAX_COLUMNS}. Narrow the export mode, reviewers, "
                    "or article selection and try again."
                ),
            )


# Re-export the canonical ``build_workbook`` from the orchestrator package
# ``app.services.exports.extraction.workbook`` so the historical import path
# ``app.services.exports.extraction_xlsx_builder.build_workbook`` keeps
# resolving to the *exact same* function object — endpoint/worker imports
# stay untouched with zero behaviour drift. The sheet writers below remain
# here (and are called lazily by the orchestrator) until each migrates to
# its own pure sub-builder later in the split. The orchestrator imports
# those helpers lazily, so this top-level re-export introduces no cycle.
from app.services.exports.extraction.workbook import build_workbook  # noqa: E402

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
        models_per_article = _article_fanout_count(article=article, layout=layout)
        span = models_per_article * len(reviewer_axis)
        cell = ws.cell(row=1, column=col_cursor, value=article.header_label)
        cell.font = _HEADER_FONT
        cell.alignment = _HEADER_ALIGN
        first = col_cursor
        last = col_cursor + span - 1
        if span > 1:
            ws.merge_cells(
                start_row=1,
                start_column=first,
                end_row=1,
                end_column=last,
            )
        article_spans.append((article, first, last))
        col_cursor += span

    header_offset = 1  # row 2 starts data
    if is_all_users:
        header_offset = 2
        # Row 2 — reviewer / Consensus labels under each article.
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
            ws.cell(row=row_cursor, column=2, value=field.label).alignment = _FIRST_COL_ALIGN
            for article, first_col, _last_col in article_spans:
                # Iterate (model_index × reviewer_axis) — model-major
                # so model sub-columns stay adjacent (FR-011 ordering).
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
    """
    if value is None:
        return None
    if isinstance(value, list):
        return "; ".join(str(item) for item in value if item is not None)
    return format_export_scalar(value, field=field)


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
    # Column indices that carry resolved extraction values (1-based to
    # match the header row); both must render like matrix cells.
    value_col_indices = {5, 12}  # "AI proposed value", "Final value used"
    for row in rows:
        for col_idx, val in enumerate(astuple(row), start=1):
            cell_val = (
                format_export_scalar(val) if col_idx in value_col_indices else _xlsx_safe(val)
            )
            ws.cell(row=body_row, column=col_idx, value=cell_val)
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

    Lists → joined string; timezone-aware datetimes → naive UTC. A
    ``dict`` here is a bug: ``resolve_value`` is the single unwrapper and
    must have collapsed every envelope upstream. We raise rather than
    silently ``str()`` a Python-repr dict into the workbook (that masked
    the §6 dict-leak in tests).
    """
    if value is None:
        return None
    if isinstance(value, list):
        return "; ".join(str(item) for item in value if item is not None)
    if isinstance(value, dict):
        raise TypeError(
            "_xlsx_safe received a dict; resolve_value must run upstream "
            f"to collapse the envelope (got {value!r})."
        )
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
