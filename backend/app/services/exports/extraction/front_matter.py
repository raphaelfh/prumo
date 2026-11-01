"""README sub-builder (spec §4.5).

Pure: consumes an ``ExportLayout`` and returns a ``SheetSpec``. Template
identity, a contents list (the allocated sheet titles), the legend, value
counts by status (primary slot only), the Codebook's clashes and skipped
versions, the rule notes and the caveats. No UUIDs anywhere.
"""

from __future__ import annotations

from collections import Counter
from typing import TYPE_CHECKING, get_args

from app.services.exports.codebook_model import field_code_clashes
from app.services.exports.descriptors import count_level_records, primary_rater
from app.services.exports.extraction.sheet_spec import Cell, CellStyle, CellValue, SheetSpec
from app.services.exports.values import ExportStatus
from app.services.extraction_export_service import ExportLayout, ExportMode
from app.services.value_semantics import ABSENT_REASON_LABELS, AbsentReason

if TYPE_CHECKING:
    from app.services.exports.extraction.workbook import SheetTitles

_TITLE = CellStyle(bold=True)
_WRAP = CellStyle(wrap=True)
_MATRIX_OMITTED_NOTE = (
    "Matrix omitted: it would exceed Excel's 16,384-column limit. "
    "The values are in the other sheets."
)

# ADR-0016 Phase 4: one legend row per coded disposition, its LABEL sourced from
# ABSENT_REASON_LABELS (the same map display_value emits into a cell) so cell and
# legend can never drift; only the frozen descriptions live here.
_ABSENT_REASON_DESCRIPTIONS: dict[str, str] = {
    AbsentReason.NO_INFORMATION.value: "The source does not state this item.",
    AbsentReason.NOT_APPLICABLE.value: "The item does not apply to this study.",
    AbsentReason.NOT_EVALUATED.value: "The item was not assessed.",
}
_LEGEND: tuple[tuple[str, str], ...] = (
    ("(blank)", "No value recorded, or the reviewer rejected the AI proposal."),
    *((ABSENT_REASON_LABELS[c.value], _ABSENT_REASON_DESCRIPTIONS[c.value]) for c in AbsentReason),
    ("Yes / No", "Boolean field rendered from its true/false value."),
    ("; ", "Separator between multiple selected options."),
)

_NOTES: tuple[str, ...] = (
    "record_label is the name given at creation; the key field's column is authoritative.",
    "A field missing from a run's pinned version is blank; "
    "compare Articles.template_version with Codebook.versions.",
    "article_label suffixes (b, c, …) follow import order; "
    "deleting an article can shift later suffixes.",
)

_CAVEATS: tuple[str, ...] = (
    "article_id is a report, not a study: companion reports must be collated by hand.",
    "Stored numbers drop trailing zeros.",
    "Appraisal domains are detected by a risk-of-bias label vocabulary.",
    "Reviewer outcomes labelled 'best-effort' rely on heuristics; the data "
    "model does not preserve the exact AI-proposal to edited-value lineage.",
)

_MODE_LABELS: dict[ExportMode, str] = {
    ExportMode.CONSENSUS: "Consensus",
    ExportMode.SINGLE_USER: "Single user",
    ExportMode.ALL_USERS: "All users",
}


def _kv(label: str, value: CellValue) -> tuple[Cell, ...]:
    return (Cell(label, _TITLE), Cell("" if value is None else value))


def _block(title: str) -> list[tuple[Cell, ...]]:
    return [(), (Cell(title, _TITLE),)]


def _value_rows(layout: ExportLayout) -> list[tuple[Cell, ...]]:
    """Counts by status and the out-of-sheet count, primary slot only (R1, R17)."""
    rater = primary_rater(layout.mode, layout.reviewer_id)
    primary = [(k[2], v) for k, v in layout.value_map.items() if k[3] == rater]
    by_status = Counter(v.status for _, v in primary)
    unplaced = {e.field_id for e in layout.codebook if e.section_id is None}
    outside = sum(1 for fid, _ in primary if fid in unplaced)
    rows = _block("Values by status")
    rows.extend((Cell(s), Cell(by_status[s])) for s in get_args(ExportStatus))
    rows.append(())
    rows.append(_kv("Values outside any level sheet", outside))
    return rows


def _codebook_rows(layout: ExportLayout) -> list[tuple[Cell, ...]]:
    """Skipped legacy versions (D5) and field-code clashes (D1)."""
    narrow = layout.narrow_pinned_versions
    rows: list[tuple[Cell, ...]] = [
        (),
        (
            Cell("Pinned versions not in Codebook (legacy snapshot)", _TITLE),
            Cell(len(narrow)),
            Cell(", ".join(f"v{n}" for n in narrow)),
        ),
    ]
    clashes = field_code_clashes(layout.codebook)
    if clashes:
        rows.extend(_block("Field code clashes"))
        rows.extend((Cell(bare), Cell("; ".join(codes))) for bare, codes in clashes)
    return rows


def build_front_matter(layout: ExportLayout, titles: SheetTitles) -> SheetSpec:
    rows: list[tuple[Cell, ...]] = [(Cell("README", _TITLE),), ()]
    rows.append(_kv("Project", layout.project_name))
    rows.append(_kv("Template", f"{layout.template_name} (v{layout.template_version})"))
    rows.append(_kv("Export mode", _MODE_LABELS[layout.mode]))
    rows.append(_kv("Generated at", layout.generated_at.isoformat()))
    rows.append(_kv("Articles", len(layout.articles)))
    rows.append(_kv("Records", count_level_records(layout.sections, layout.articles)))

    # Rendered from the allocated titles, so the list is the real sheet list.
    rows.extend(_block("Contents"))
    rows.extend((Cell(""), Cell(name)) for name in titles.order)

    if titles.matrix_omitted:
        rows.append(())
        rows.append((Cell(_MATRIX_OMITTED_NOTE, _WRAP),))

    rows.extend(_block("Legend"))
    rows.extend((Cell(glyph, _TITLE), Cell(meaning)) for glyph, meaning in _LEGEND)

    rows.extend(_value_rows(layout))
    rows.extend(_codebook_rows(layout))

    rows.extend(_block("Notes"))
    rows.extend((Cell(""), Cell(note, _WRAP)) for note in _NOTES)
    rows.extend(_block("Caveats"))
    rows.extend((Cell(""), Cell(caveat, _WRAP)) for caveat in _CAVEATS)

    return SheetSpec(
        title=titles.fixed["front_matter"],
        rows=tuple(rows),
        column_widths=(36.0, 90.0),
        tab_color="1F4E78",
    )
