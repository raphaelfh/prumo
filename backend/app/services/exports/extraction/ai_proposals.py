"""The optional AI proposals sheet (spec §7, D6).

One row per ``source=ai`` proposal in scope, keyed like the Data sheet
(``article_id, instance_id, field_id``) so a script joins the two: what the
model proposed, which engine proposed it, and its evidence. It reports facts
only; the origin of a recorded value lives on the Data sheet. Emitted only when
``include_ai_metadata`` is toggled on.

Pure: returns a ``SheetSpec`` (or ``None``); no openpyxl, no I/O.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Final

from app.services.exports.extraction.sheet_spec import Cell, CellStyle, CellValue, SheetSpec
from app.services.exports.values import machine_value

if TYPE_CHECKING:
    from app.services.exports.extraction.workbook import SheetTitles
    from app.services.extraction_export_service import AIProposalRow, ExportLayout

AI_PROPOSAL_COLUMNS: Final[tuple[str, ...]] = (
    "article_id",
    "instance_id",
    "field_id",
    "field_code",
    "ai_proposal_id",
    "provider",
    "model",
    "prompt_version",
    "value",
    "unit",
    "confidence",
    "rationale",
    "evidence_quote",
    "page",
)
_HEADER = CellStyle(bold=True, fill="EEEEEE")


def _row(row: AIProposalRow, codes: dict[object, str]) -> tuple[CellValue, ...]:
    # D6: the machine scalar Data joins on, falling back to an absent marker's code.
    value = machine_value(row.value)
    return (
        str(row.article_id),
        str(row.instance_id),
        str(row.field_id),
        codes.get(row.field_id),
        str(row.ai_proposal_id),
        row.engine.provider,
        row.engine.model,
        row.engine.prompt_version,
        row.value.absent_code if value is None else value,
        row.value.unit,
        row.confidence,
        row.rationale,
        row.evidence_quote,
        row.page,
    )


def build_ai_proposals(layout: ExportLayout, titles: SheetTitles) -> SheetSpec | None:
    """The AI proposals sheet, or ``None`` when its role is absent. Rows follow the
    export's article order, then creation time and id."""
    title = titles.fixed.get("ai_proposals")
    if title is None:
        return None
    codes: dict[object, str] = {e.field_id: e.field_code for e in layout.codebook}
    order = {a.article_id: i for i, a in enumerate(layout.articles)}
    rows = sorted(
        layout.ai_proposal_rows,
        key=lambda r: (order.get(r.article_id, len(order)), r.created_at, str(r.ai_proposal_id)),
    )
    return SheetSpec(
        title=title,
        rows=(
            tuple(Cell(h, _HEADER) for h in AI_PROPOSAL_COLUMNS),
            *(tuple(Cell(v) for v in _row(r, codes)) for r in rows),
        ),
        column_widths=tuple(18.0 for _ in AI_PROPOSAL_COLUMNS),
        freeze="A2",
    )
