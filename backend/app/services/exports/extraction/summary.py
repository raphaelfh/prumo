"""Summary sub-builder.

One row per record (article, or article × model when a ``MODEL_CONTAINER``
exists), with identity columns + per-record completeness + an omitted-by-stage
tally (§4 #2). Completeness is computed from the already-resolved ``value_map``:
a coordinate counts as "filled" when its resolved value is not ``None``. Pure —
no DB, no openpyxl.
"""

from __future__ import annotations

from uuid import UUID

from app.models.extraction import ExtractionEntityRole
from app.services.exports.extraction.sheet_spec import Cell, CellStyle, SheetSpec
from app.services.extraction_export_service import (
    ArticleDescriptor,
    ExportLayout,
    ExportMode,
    SectionDescriptor,
)

_HEADER = CellStyle(bold=True, fill="EEEEEE")

_HEADERS = ("Record", "Model #", "Fields filled", "Fields total", "Completeness")


def _has_model_container(sections: tuple[SectionDescriptor, ...]) -> bool:
    return any(s.role is ExtractionEntityRole.MODEL_CONTAINER for s in sections)


def _consensus_value(layout: ExportLayout, run_id: UUID, instance_id: UUID, field_id: UUID):
    # All-users keys are 4-tuple ``(run, instance, field, reviewer_id|None)``;
    # consensus / single-user stay 3-tuple. Completeness reads the consensus
    # (reviewer-agnostic) slot in either mode.
    if layout.mode is ExportMode.ALL_USERS:
        return layout.value_map.get((run_id, instance_id, field_id, None))
    return layout.value_map.get((run_id, instance_id, field_id))


def _instance_for(article: ArticleDescriptor, section: SectionDescriptor, model_index: int | None):
    if section.role is ExtractionEntityRole.MODEL_SECTION:
        if model_index is None or model_index >= len(article.model_instances):
            return None
        return article.model_instances[model_index]
    # study / other sections — first instance for the entity type
    instances = article.section_instances.get(section.entity_type_id, ())
    return instances[0] if instances else None


def _completeness_for_record(
    layout: ExportLayout,
    article: ArticleDescriptor,
    model_index: int | None,
) -> tuple[int, int]:
    filled = 0
    total = 0
    if article.run_id is None:
        return 0, 0
    for section in layout.sections:
        if section.role is ExtractionEntityRole.MODEL_CONTAINER:
            continue
        # When fanning out by model, a model-section row belongs to one model;
        # study sections apply to every model row (their values repeat).
        instance_id = _instance_for(article, section, model_index)
        if instance_id is None:
            continue
        for field in section.fields:
            total += 1
            if _consensus_value(layout, article.run_id, instance_id, field.field_id) is not None:
                filled += 1
    return filled, total


def _record_rows(layout: ExportLayout, fan_out_models: bool) -> list[tuple[Cell, ...]]:
    rows: list[tuple[Cell, ...]] = []
    for article in layout.articles:
        model_iter: list[int | None]
        if fan_out_models and article.model_instances:
            model_iter = list(range(len(article.model_instances)))
        else:
            model_iter = [None]
        for model_index in model_iter:
            filled, total = _completeness_for_record(layout, article, model_index)
            pct = f"{(filled / total * 100):.0f}%" if total else ""
            rows.append(
                (
                    Cell(article.header_label),
                    Cell("" if model_index is None else model_index + 1),
                    Cell(filled),
                    Cell(total),
                    Cell(pct),
                )
            )
    return rows


def build_summary(layout: ExportLayout) -> SheetSpec:
    fan_out = _has_model_container(layout.sections)
    rows: list[tuple[Cell, ...]] = [tuple(Cell(h, _HEADER) for h in _HEADERS)]
    rows.extend(_record_rows(layout, fan_out))

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
