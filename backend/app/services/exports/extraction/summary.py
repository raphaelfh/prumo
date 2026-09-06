"""Summary sub-builder.

One row per record (article, or article × model when a ``MODEL_CONTAINER``
exists), with identity columns + per-record completeness + an omitted-by-stage
tally (§4 #2). Completeness is computed from the already-resolved ``value_map``:
a coordinate counts as "filled" when its resolved value is not ``None``. Pure —
no DB, no openpyxl.
"""

from __future__ import annotations

from uuid import UUID

from app.services.exports.descriptors import (
    descendant_instances,
    iter_records,
    root_groups,
)
from app.services.exports.extraction.sheet_spec import Cell, CellStyle, SheetSpec
from app.services.extraction_export_service import (
    ArticleDescriptor,
    ExportLayout,
    ExportMode,
)

_HEADER = CellStyle(bold=True, fill="EEEEEE")

_HEADERS = ("Record", "Entry", "Fields filled", "Fields total", "Completeness")


def _consensus_value(layout: ExportLayout, run_id: UUID, instance_id: UUID, field_id: UUID):
    # All-users keys are 4-tuple ``(run, instance, field, reviewer_id|None)``;
    # consensus / single-user stay 3-tuple. Completeness reads the consensus
    # (reviewer-agnostic) slot in either mode.
    if layout.mode is ExportMode.ALL_USERS:
        return layout.value_map.get((run_id, instance_id, field_id, None))
    return layout.value_map.get((run_id, instance_id, field_id))


def _completeness(
    layout: ExportLayout,
    article: ArticleDescriptor,
    scope: set[UUID] | None,
) -> tuple[int, int]:
    """Filled / total over the instances in ``scope`` (``None`` = the article).

    Was resolved section-by-section through a `model_index` into
    `article.model_instances`. That tuple held every child instance of every
    entry, so an entry's row counted a sibling entry's values — the Summary
    face of the same defect the matrix had.
    """
    filled = 0
    total = 0
    if article.run_id is None:
        return 0, 0
    for section in layout.sections:
        for instance_id, _parts in iter_records(section, article, layout.sections):
            if scope is not None and instance_id not in scope:
                continue
            for field in section.fields:
                total += 1
                if (
                    _consensus_value(layout, article.run_id, instance_id, field.field_id)
                    is not None
                ):
                    filled += 1
    return filled, total


def _row(article: ArticleDescriptor, label: str, filled: int, total: int) -> tuple[Cell, ...]:
    pct = f"{(filled / total * 100):.0f}%" if total else ""
    return (Cell(article.header_label), Cell(label), Cell(filled), Cell(total), Cell(pct))


def _record_rows(layout: ExportLayout) -> list[tuple[Cell, ...]]:
    """One row per article, then one row per entry of each root group (§10)."""
    groups = root_groups(layout.sections)
    rows: list[tuple[Cell, ...]] = []
    for article in layout.articles:
        rows.append(_row(article, "", *_completeness(layout, article, None)))
        for group in groups:
            for instance_id, parts in iter_records(group, article, layout.sections):
                scope = descendant_instances(article, instance_id)
                rows.append(
                    _row(article, " · ".join(parts), *_completeness(layout, article, scope))
                )
    return rows


def build_summary(layout: ExportLayout) -> SheetSpec:
    rows: list[tuple[Cell, ...]] = [tuple(Cell(h, _HEADER) for h in _HEADERS)]
    rows.extend(_record_rows(layout))

    if layout.notes.omitted_articles_by_stage:
        rows.append(())
        rows.append((Cell("Articles omitted", _HEADER),))
        for stage, count in sorted(layout.notes.omitted_articles_by_stage.items()):
            rows.append((Cell(f"stage={stage}"), Cell(count)))

    return SheetSpec(
        title="Summary",
        rows=tuple(rows),
        column_widths=(36.0, 10.0, 14.0, 14.0, 14.0),
        freeze="A2",
        tab_color="2E75B6",
    )
