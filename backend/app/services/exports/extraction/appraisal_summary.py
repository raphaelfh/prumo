"""Appraisal-summary sub-builder (§7).

Pure, no-IO. Computes a per-domain-verdict + worst-case Overall sheet for
quality-assessment templates. Consumes already-resolved scalars from the
layout's value_map (resolve_value ran upstream); never re-handles envelopes.
"""

from __future__ import annotations

from typing import Any

from app.services.exports.extraction.sheet_spec import Cell, CellStyle, SheetSpec
from app.services.extraction_export_service import ExportLayout, ExportMode
from app.services.value_semantics import ABSENT_REASON_LABELS

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

# ADR-0016 Phase 4: the resolved labels of a coded-disposition verdict, casefolded.
# `no_information` is now available on EVERY field (incl. a risk-verdict field), and
# a marker reaches this layer already resolved by `resolve_value` to its stable
# label. Such a verdict is EXCLUDED from the worst-case rank — a "the source is
# silent" answer must never silently force a Critical Overall. Derived from the
# single ABSENT_REASON_LABELS source so the exclusion can't drift from the cell.
_DISPOSITION_LABELS_CF: frozenset[str] = frozenset(
    label.casefold() for label in ABSENT_REASON_LABELS.values()
)


def _verdict_rank(verdict: Any) -> int:
    """Severity rank for one verdict; higher == worse. Blank == -1 (ignored).

    A non-empty verdict not in the known table outranks every known label
    (rank == len(table)) so a novel risk label never silently downgrades the
    Overall — the rollup fails toward caution, not toward a green light.

    A resolved coded-disposition verdict ("No information" / "Not applicable" /
    "Not evaluated") is also -1 (excluded, ADR-0016 Phase 4): it is not a risk
    judgement, so it neither downgrades nor inflates the worst-case Overall.
    """
    if verdict is None:
        return -1
    text = str(verdict).strip()
    if not text:
        return -1
    lowered = text.casefold()
    if lowered in _DISPOSITION_LABELS_CF:
        return -1
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

    # A template that declares a `derived_judgments` spec (PROBAST+AI) replaces
    # the legacy single worst-case column with its own named overalls, computed
    # by `derived_judgment_service` — the same module the run view uses.
    # Templates without a spec keep the legacy column unchanged.
    derived_labels = appraisal.derived_labels
    if derived_labels:
        header_cells.extend(Cell(label, _HEADER_STYLE) for label in derived_labels)
    else:
        header_cells.append(Cell(_OVERALL_COL, _HEADER_STYLE))

    reviewer_overall_cols: tuple[Any, ...] = ()
    # Only for templates WITHOUT a spec. The per-reviewer column is the legacy
    # lenient rollup, which drops "No information" and blanks — so beside the
    # derived columns it prints Low on the very row they call Unclear, and rolls
    # development *Quality* together with evaluation *Risk of Bias* into one
    # meaningless number. A template that declares its own overalls has exactly
    # those overalls; a second, laxer answer next to them is worse than none.
    if layout.mode is ExportMode.ALL_USERS and not derived_labels:
        reviewer_overall_cols = tuple(layout.reviewers)
        for reviewer in reviewer_overall_cols:
            header_cells.append(Cell(f"{_OVERALL_COL} — {reviewer.display_label}", _HEADER_STYLE))

    rows: list[tuple[Cell, ...]] = [tuple(header_cells)]
    for row in appraisal.rows:
        cells = [Cell(row.record_label)]
        cells.extend(Cell(v) for v in row.domain_verdicts)
        if derived_labels:
            cells.extend(Cell(v) for v in row.derived_values)
        else:
            cells.append(Cell(row.overall))
        for reviewer in reviewer_overall_cols:
            cells.append(Cell(row.per_reviewer_overall.get(reviewer.reviewer_id)))
        rows.append(tuple(cells))

    # Record column + the overall column(s) — one legacy, or one per declared
    # derived judgment — plus one width per domain and per per-reviewer Overall.
    overall_cols = len(derived_labels) if derived_labels else 1
    domain_and_overall = len(domain_labels) + overall_cols + len(reviewer_overall_cols)
    return SheetSpec(
        title="Appraisal summary",
        rows=tuple(rows),
        freeze="B2",
        column_widths=(28.0,) + (16.0,) * domain_and_overall,
    )
