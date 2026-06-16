"""Optional AI-metadata sheet sub-builder (FR-036 – FR-040).

One flat-tabular row per AI proposal — what the model proposed vs. what
was actually used, plus confidence, rationale, evidence, and the
best-effort reviewer outcome — so "what the AI thought" and "what was
used" coexist without contaminating each other. Emitted only when
``include_ai_metadata`` is toggled on.

Pure: returns a ``SheetSpec`` (or ``None``); no openpyxl, no I/O. The two
value columns render through the shared ``format_export_scalar`` helper so
number+unit / select / boolean read identically to the matrix; the
timestamp is ISO-8601 text (the ``SheetSpec`` IR is scalar-only, matching
the front-matter ``generated_at`` convention).
"""

from __future__ import annotations

from dataclasses import astuple

from app.services.exports.extraction.sheet_spec import Cell, CellStyle, CellValue, SheetSpec
from app.services.exports.value_envelope import format_export_scalar
from app.services.extraction_export_service import AIProposalRow, ExportLayout

#: Column headers in FR-037 order — lockstep with ``AIProposalRow`` field
#: order (``astuple`` below relies on that contract).
_HEADERS: tuple[str, ...] = (
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
)
#: 1-based column indices carrying resolved extraction values — rendered
#: like matrix cells via the shared helper (number+unit / Yes survive).
_VALUE_COLS: frozenset[int] = frozenset({5, 12})
#: 1-based column index of the ``proposed_at`` timestamp.
_TIMESTAMP_COL = 10
_HEADER_STYLE = CellStyle(bold=True, align="center")
_COL_WIDTH = 22.0
_NO_ROWS_PLACEHOLDER = "(No AI proposals recorded for the selected articles.)"


def build_ai_metadata(layout: ExportLayout) -> SheetSpec | None:
    """Build the optional AI-metadata sheet, or ``None`` when toggled off."""
    if not layout.include_ai_metadata:
        return None

    rows: list[tuple[Cell, ...]] = [tuple(Cell(label, _HEADER_STYLE) for label in _HEADERS)]

    proposals: tuple[AIProposalRow, ...] = layout.ai_proposal_rows or ()
    for proposal in proposals:
        rows.append(
            tuple(
                Cell(_coerce(col_idx, value))
                for col_idx, value in enumerate(astuple(proposal), start=1)
            )
        )

    if not proposals:
        # FR-039 placeholder line.
        rows.append((Cell(_NO_ROWS_PLACEHOLDER),))

    return SheetSpec(
        title="AI metadata",
        rows=tuple(rows),
        column_widths=tuple(_COL_WIDTH for _ in _HEADERS),
    )


def _coerce(col_idx: int, value: object) -> CellValue:
    """Map one ``AIProposalRow`` field to a sheet-safe scalar.

    Value columns render through the shared format helper (which raises on
    a stray dict — the §6 envelope must have been collapsed by
    ``resolve_value`` upstream); the timestamp is ISO-8601 text; everything
    else is already a scalar (``str`` / ``int`` / ``float`` / ``None``).
    """
    if col_idx in _VALUE_COLS:
        return format_export_scalar(value)
    if col_idx == _TIMESTAMP_COL:
        return value.isoformat() if value is not None else None  # type: ignore[union-attr]
    return value  # type: ignore[return-value]


__all__ = ["build_ai_metadata"]
