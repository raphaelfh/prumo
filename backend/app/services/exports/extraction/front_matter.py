"""README / Methods (front-matter) sub-builder.

Pure: consumes an ``ExportLayout`` and returns a ``SheetSpec``. Absorbs the
old Notes sheet — template identity, export provenance, a generated contents
list, a glyph/sentinel legend, caveats, and the per-Run obsolete-field block
(§4 #1, §5.1).
"""

from __future__ import annotations

from app.services.exports.extraction.sheet_spec import Cell, CellStyle, SheetSpec
from app.services.extraction_export_service import ExportLayout

_TITLE = CellStyle(bold=True)


def _kv(label: str, value: object) -> tuple[Cell, ...]:
    return (Cell(label, _TITLE), Cell("" if value is None else str(value)))


def build_front_matter(layout: ExportLayout) -> SheetSpec:
    fm = layout.front_matter
    rows: list[tuple[Cell, ...]] = []

    rows.append((Cell("README / Methods", _TITLE),))
    rows.append(())

    project_name = fm.project_name if fm else layout.project_name
    template_name = fm.template_name if fm else layout.template_name
    template_version = fm.template_version if fm else layout.template_version
    mode_label = fm.export_mode_label if fm else layout.mode.value
    generated = fm.generated_at if fm else None

    rows.append(_kv("Project", project_name))
    rows.append(_kv("Template", f"{template_name} (v{template_version})"))
    rows.append(_kv("Export mode", mode_label))
    rows.append(_kv("Generated at", generated.isoformat() if generated is not None else ""))
    if fm is not None:
        rows.append(_kv("Articles", fm.article_count))
        rows.append(_kv("Records", fm.record_count))

    if fm is not None and fm.contents:
        rows.append(())
        rows.append((Cell("Contents", _TITLE),))
        for sheet_name in fm.contents:
            rows.append((Cell(""), Cell(sheet_name)))

    if fm is not None and fm.legend:
        rows.append(())
        rows.append((Cell("Legend", _TITLE),))
        for glyph, meaning in fm.legend:
            rows.append((Cell(glyph, _TITLE), Cell(meaning)))

    if fm is not None and fm.caveats:
        rows.append(())
        rows.append((Cell("Notes", _TITLE),))
        for caveat in fm.caveats:
            rows.append((Cell(""), Cell(caveat, CellStyle(wrap=True))))

    if fm is not None and fm.obsolete_fields_per_article:
        rows.append(())
        rows.append((Cell("Fields removed from active template (per Run)", _TITLE),))
        for article_id, labels in fm.obsolete_fields_per_article.items():
            rows.append((Cell(str(article_id)), Cell("; ".join(labels))))

    return SheetSpec(
        title="README",
        rows=tuple(rows),
        column_widths=(36.0, 90.0),
        tab_color="1F4E78",
    )
