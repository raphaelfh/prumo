"""Summary sub-builder.

One row per record (article, or article × model when a ``MODEL_CONTAINER``
exists), with identity columns + per-record completeness + an omitted-by-stage
tally (§4 #2). Completeness reads the primary slot of the typed ``value_map``:
a coordinate counts as "filled" when it renders (``display_value``) to a value,
so markers and out-of-scope stamps count and cleared values do not. Pure — no
DB, no openpyxl.
"""

from __future__ import annotations

from typing import TYPE_CHECKING
from uuid import UUID

from app.services.exports.descriptors import (
    descendant_instances,
    iter_records,
    primary_rater,
    root_groups,
    value_key,
)
from app.services.exports.extraction.sheet_spec import Cell, CellStyle, SheetSpec
from app.services.exports.values import display_value
from app.services.extraction_export_service import (
    ArticleDescriptor,
    ExportLayout,
)

if TYPE_CHECKING:
    from app.services.exports.extraction.workbook import SheetTitles

_HEADER = CellStyle(bold=True, fill="EEEEEE")

_HEADERS = ("Record", "Entry", "Fields filled", "Fields total", "Completeness")


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
    rater = primary_rater(layout.mode, layout.reviewer_id)
    for section in layout.sections:
        for instance_id, _parts in iter_records(section, article, layout.sections):
            if scope is not None and instance_id not in scope:
                continue
            for field in section.fields:
                total += 1
                v = layout.value_map.get(
                    value_key(article.run_id, instance_id, field.field_id, rater)
                )
                if v is not None and display_value(v, field) is not None:
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


def build_summary(layout: ExportLayout, titles: SheetTitles) -> SheetSpec:
    rows: list[tuple[Cell, ...]] = [tuple(Cell(h, _HEADER) for h in _HEADERS)]
    rows.extend(_record_rows(layout))

    if layout.notes.omitted_articles_by_stage:
        rows.append(())
        rows.append((Cell("Articles omitted", _HEADER),))
        for stage, count in sorted(layout.notes.omitted_articles_by_stage.items()):
            rows.append((Cell(f"stage={stage}"), Cell(count)))

    return SheetSpec(
        title=titles.fixed["summary"],
        rows=tuple(rows),
        column_widths=(36.0, 10.0, 14.0, 14.0, 14.0),
        freeze="A2",
        tab_color="2E75B6",
    )
