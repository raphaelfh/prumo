"""Appraisal-summary sub-builder (§7).

Pure, no-IO. Computes a per-domain-verdict + worst-case Overall sheet for
quality-assessment templates. Consumes already-resolved scalars from the
layout's value_map (resolve_value ran upstream); never re-handles envelopes.
"""

from __future__ import annotations

from typing import Any

from app.services.exports.extraction.sheet_spec import Cell, CellStyle, SheetSpec
from app.services.extraction_export_service import ExportLayout, ExportMode

_HEADER_STYLE = CellStyle(bold=True, fill="EEEEEE")
_RECORD_COL = "Record"
_OVERALL_COL = "Overall"

# Worst-case severity order, most severe first. Case-insensitive match.
# Covers PROBAST (High/Unclear/Low), QUADAS-2 (High/Unclear/Low),
# ROB-2 / ROBINS-I (High/Some concerns/Moderate/Serious/Critical/Low).
_SEVERITY_RANK: tuple[str, ...] = (
    "critical",
    "serious",
    "high",
    "some concerns",
    "moderate",
    "unclear",
    "low",
)

# Recognised risk-label vocabulary (case-folded). Single source of truth for
# "which SELECT field is a domain verdict": a domain's verdict field is the
# first SELECT whose allowed_values are all drawn from this set, which
# separates the judgment fields (Low/High/Unclear) from the SELECT-typed
# signalling questions (Y/PY/PN/N/NI/NA, Y/N/Unclear). Reused by
# extraction_export_service._build_appraisal_model (§7 verdict selection).
_RISK_LABELS: frozenset[str] = frozenset(_SEVERITY_RANK)


def _verdict_rank(verdict: Any) -> int:
    """Severity rank for one verdict; higher == worse. Blank == -1 (ignored).

    A non-empty verdict not in the known table outranks every known label
    (rank == len(table)) so a novel risk label never silently downgrades the
    Overall — the rollup fails toward caution, not toward a green light.
    """
    if verdict is None:
        return -1
    text = str(verdict).strip()
    if not text:
        return -1
    lowered = text.casefold()
    for rank, label in enumerate(reversed(_SEVERITY_RANK)):
        if lowered == label:
            return rank
    # Unknown non-empty label: most severe.
    return len(_SEVERITY_RANK)


def _appraisal_overall(verdicts: tuple[Any, ...]) -> Any:
    """Worst-case rollup over a record's domain verdicts (§7).

    Returns the original (label-preserving) verdict with the highest severity
    rank; blanks are ignored; an all-blank record yields None (blank Overall).
    Ties resolve to the first encountered, keeping output deterministic.
    """
    worst: Any = None
    worst_rank = -1
    for verdict in verdicts:
        rank = _verdict_rank(verdict)
        if rank > worst_rank:
            worst_rank = rank
            worst = verdict
    return worst if worst_rank >= 0 else None


def build_appraisal_summary(layout: ExportLayout) -> SheetSpec | None:
    """Build the conditional appraisal-summary sheet (§7).

    Returns None when the exported template carries no appraisal layer
    (``layout.appraisal is None``) — the workbook orchestrator then omits
    sheet #k+1 and any risk-of-bias section still renders as a tidy table.

    Mode-aware Overall columns (§7):
      * consensus / single_user -> a single ``Overall`` column (the record's
        worst-case rollup, already computed on ``AppraisalRow.overall``).
      * all_users -> consensus ``Overall`` + one ``Overall`` column per
        reviewer, in ``layout.reviewers`` order (mirrors the matrix
        reviewer-axis fan-out), keyed by ``AppraisalRow.per_reviewer_overall``.
    """
    appraisal = layout.appraisal
    if appraisal is None:
        return None

    domain_labels = appraisal.domain_labels
    header_cells = [Cell(_RECORD_COL, _HEADER_STYLE)]
    header_cells.extend(Cell(label, _HEADER_STYLE) for label in domain_labels)
    header_cells.append(Cell(_OVERALL_COL, _HEADER_STYLE))

    reviewer_overall_cols: tuple[Any, ...] = ()
    if layout.mode is ExportMode.ALL_USERS:
        reviewer_overall_cols = tuple(layout.reviewers)
        for reviewer in reviewer_overall_cols:
            header_cells.append(Cell(f"{_OVERALL_COL} — {reviewer.display_label}", _HEADER_STYLE))

    rows: list[tuple[Cell, ...]] = [tuple(header_cells)]
    for row in appraisal.rows:
        cells = [Cell(row.record_label)]
        cells.extend(Cell(v) for v in row.domain_verdicts)
        cells.append(Cell(row.overall))
        for reviewer in reviewer_overall_cols:
            cells.append(Cell(row.per_reviewer_overall.get(reviewer.reviewer_id)))
        rows.append(tuple(cells))

    # Record column + one Overall column, plus one width per domain and per
    # per-reviewer Overall column.
    domain_and_overall = len(domain_labels) + 1 + len(reviewer_overall_cols)
    return SheetSpec(
        title="Appraisal summary",
        rows=tuple(rows),
        freeze="B2",
        column_widths=(28.0,) + (16.0,) * domain_and_overall,
    )
