"""Workbook orchestrator for extraction exports.

Owns the PUBLIC ``build_workbook(layout, shape, *, include_matrix) -> bytes`` signature
consumed by the endpoint and the Celery worker. It calls each pure sub-builder
in §3 order via ``_ordered_specs``: README, Summary, [Matrix], Articles and one
sheet per repeating level, Data, [Verification], [AI proposals], [Appraisal],
Codebook, [Options].
Every non-``None`` ``SheetSpec`` goes through the single ``_render_sheet_spec``
writer; the matrix is included or omitted by ``matrix_fits`` (§5.5). Every title
is allocated first by ``allocate_titles`` and each sub-builder reads its own
from the resulting ``SheetTitles``. ``shape`` (§3) narrows that order to a
subset of the same sheets, skipping the filtered-out builders entirely.
"""

from __future__ import annotations

import io
from collections.abc import Mapping
from dataclasses import dataclass, field
from enum import StrEnum
from uuid import UUID

from openpyxl import Workbook

from app.models.extraction import ExtractionCardinality
from app.services.exports.descriptors import ancestry, iter_records, level_of, walk_sections
from app.services.exports.extraction.ai_proposals import AI_PROPOSAL_COLUMNS, build_ai_proposals
from app.services.exports.extraction.appraisal_summary import build_appraisal_summary
from app.services.exports.extraction.codebook import build_codebook, build_options
from app.services.exports.extraction.data_sheet import DATA_COLUMNS, build_data_sheet
from app.services.exports.extraction.front_matter import build_front_matter
from app.services.exports.extraction.level_tables import build_level_tables
from app.services.exports.extraction.matrix import (
    _FIRST_DATA_COL,
    _article_fanout_count,
    build_matrix,
)
from app.services.exports.extraction.sheet_spec import (
    RESERVED_TITLES,
    SheetSpec,
    _render_sheet_spec,
    safe_sheet_title,
)
from app.services.exports.extraction.summary import build_summary
from app.services.exports.extraction.verification import build_verification
from app.services.extraction_export_service import ExportLayout, ExportMode


class ExportShape(StrEnum):
    """Which sheets the workbook carries (§3).

    Each shape is a SUBSET of the sheets the builders already produce — no
    shape adds a sheet, and README is in all three (it carries the template
    identity, the export provenance and the glyph legend, without which no
    other sheet reads correctly).

    It lives HERE, not on ``ExportLayout``: ``resolve_layout`` resolves the
    same layout whatever shape will be printed from it, so threading the value
    through the resolver would only ferry it to the one function that reads it.
    """

    COMPLETE = "complete"
    DICTIONARY = "dictionary"
    PUBLICATION = "publication"


#: Excel's hard ceiling on worksheet columns — XFD is column 16,384 (XLSX spec).
EXCEL_MAX_COLUMNS = 16_384


def _matrix_column_count(layout: ExportLayout) -> int:
    """Worst-case matrix width = 2 label cols + per-record sub-columns.

    Per-article fan-out reuses the matrix builder's own
    ``_article_fanout_count`` (which honours both the model-instance axis
    and ``cardinality='many'`` sections), so ``matrix_fits`` counts exactly
    the columns the matrix will emit. All-users mode multiplies each record by
    the reviewer axis (consensus + one column per reviewer).
    """
    if not layout.articles:
        return 1
    reviewer_slots = 1
    if layout.mode is ExportMode.ALL_USERS:
        reviewer_slots = 1 + len(layout.reviewers)
    data_cols = 0
    for article in layout.articles:
        data_cols += _article_fanout_count(article=article, layout=layout) * reviewer_slots
    return (_FIRST_DATA_COL - 1) + data_cols


def matrix_fits(layout: ExportLayout) -> bool:
    """True when the Matrix sheet fits Excel's column ceiling."""
    return _matrix_column_count(layout) <= EXCEL_MAX_COLUMNS


#: Which sub-builders each shape keeps (§3). Keyed on BUILDER IDENTITY, never
#: on sheet title: ``SheetSpec`` carries only a title, so a title-matching
#: filter would misfire on an instrument with a section named
#: "Codebook". A builder absent from the set is never called — the shape
#: saves the work rather than discarding its output.
_SHAPE_BUILDERS: dict[ExportShape, frozenset[str]] = {
    ExportShape.COMPLETE: frozenset(
        {
            "front_matter",
            "summary",
            "matrix",
            "level_tables",
            "data",
            "verification",
            "ai_proposals",
            "appraisal_summary",
            "codebook",
            "options",
        }
    ),
    ExportShape.DICTIONARY: frozenset({"front_matter", "codebook", "options"}),
    ExportShape.PUBLICATION: frozenset({"front_matter", "level_tables", "appraisal_summary"}),
}


#: The builders that read resolved ARTICLE VALUES, as opposed to the template
#: snapshot. Derived from ``_SHAPE_BUILDERS`` rather than written beside it, so
#: a future shape's answer follows from the sheets it was given instead of
#: needing a second list somebody can forget to update.
_ARTICLE_BUILDERS: frozenset[str] = frozenset(
    {
        "summary",
        "matrix",
        "level_tables",
        "data",
        "verification",
        "appraisal_summary",
        "ai_proposals",
    }
)


def shape_needs_articles(shape: ExportShape) -> bool:
    """Whether any sheet in ``shape`` reads resolved article values.

    False for the dictionary shape: README, Codebook and Options
    are all projections of the TEMPLATE, so that workbook is meaningful before
    anyone has finalized a single run — which is exactly when you want it, while
    wiring another tool to the template. Callers use this to decide whether an
    empty eligible-article set is a reason to refuse the export.
    """
    return bool(_SHAPE_BUILDERS[shape] & _ARTICLE_BUILDERS)


#: Title of every fixed (non-section) sheet, keyed on builder id (R7, R8a).
_FIXED_TITLES: dict[str, str] = {
    "front_matter": "README",
    "summary": "Summary",
    "matrix": "Matrix",
    "data": "Data",
    "verification": "Verification",
    "ai_proposals": "AI proposals",
    "appraisal_summary": "Appraisal",
    "codebook": "Codebook",
    "options": "Options",
}

#: §3 sheet order; ``level_tables`` expands to Articles plus one sheet per level.
_ROLE_ORDER: tuple[str, ...] = (
    "front_matter",
    "summary",
    "matrix",
    "level_tables",
    "data",
    "verification",
    "ai_proposals",
    "appraisal_summary",
    "codebook",
    "options",
)


@dataclass(frozen=True, slots=True)
class SheetTitles:
    """Every sheet title of one workbook, allocated before any sheet is built.

    ``fixed`` maps each PRESENT fixed role (builder id) to its title; a
    conditional builder whose role is absent returns ``None``. ``levels`` maps
    each repeating section to its de-duplicated title, allocated in every
    shape; ``level_by_section`` maps every walked section to its level
    (``None`` = Articles). ``order`` is the rendered sheet list, which the
    README Contents block prints verbatim.
    """

    fixed: Mapping[str, str]
    levels: Mapping[UUID, str]
    order: tuple[str, ...]
    matrix_omitted: bool
    level_by_section: Mapping[UUID, UUID | None] = field(default_factory=dict)

    def sheet_for(self, section_id: UUID | None) -> str | None:
        """The level sheet a section's fields land on (R8); ``None`` = not walked."""
        if section_id is None:
            return "Articles"
        if section_id not in self.level_by_section:
            return None
        level = self.level_by_section[section_id]
        return "Articles" if level is None else self.levels[level]


def _role_present(role: str, layout: ExportLayout, *, include_matrix: bool) -> bool:
    if role == "matrix":
        return include_matrix
    if role == "appraisal_summary":
        return layout.appraisal is not None
    if role == "options":
        return any(e.options for e in layout.codebook)
    if role == "ai_proposals":
        return layout.include_ai_metadata
    if role == "verification":
        return layout.mode is ExportMode.ALL_USERS
    return True


def allocate_titles(
    layout: ExportLayout, shape: ExportShape, *, include_matrix: bool
) -> SheetTitles:
    """Allocate every sheet title of ``shape`` in one pass (§4 order).

    Reserved titles are claimed first, so a section coded "options" or
    "History" gets a suffixed title instead of colliding with a fixed sheet.
    """
    keep = _SHAPE_BUILDERS[shape]
    taken: list[str] = list(RESERVED_TITLES)
    walked = walk_sections(layout.sections)
    level_by_section = {s.entity_type_id: level_of(s, layout.sections) for s in walked}
    levels: dict[UUID, str] = {}
    repeating = [s for s in walked if s.cardinality is ExtractionCardinality.MANY]
    for i, section in enumerate(repeating):
        raw = section.label if shape is ExportShape.PUBLICATION else section.name
        title = safe_sheet_title(raw, taken, fallback=f"Level {i + 1}")
        taken.append(title)
        levels[section.entity_type_id] = title

    fixed: dict[str, str] = {}
    order: list[str] = []
    for role in _ROLE_ORDER:
        if role not in keep:
            continue
        if role == "level_tables":
            fixed["articles"] = "Articles"
            order.extend((fixed["articles"], *levels.values()))
        elif _role_present(role, layout, include_matrix=include_matrix):
            fixed[role] = _FIXED_TITLES[role]
            order.append(fixed[role])
    return SheetTitles(
        fixed=fixed,
        levels=levels,
        order=tuple(order),
        matrix_omitted="matrix" in keep and not include_matrix,
        level_by_section=level_by_section,
    )


def _ordered_specs(
    layout: ExportLayout, shape: ExportShape, titles: SheetTitles
) -> list[SheetSpec]:
    """Sheets in §3 order; ``None``-returning conditional builders are skipped.

    README, Summary, [Matrix], Articles and one sheet per repeating level,
    Data, [Verification] (all_users), [AI proposals] (when
    ``include_ai_metadata``), [Appraisal] (when
    ``layout.appraisal`` is set), Codebook, then [Options] (when some field
    carries coded options).

    ``shape`` narrows that order to a subset (§3). Order is preserved: a shape
    only removes sheets, it never reorders or adds one. Which conditional
    sheets are present was decided once, in ``allocate_titles``.
    """
    keep = _SHAPE_BUILDERS[shape]
    specs: list[SheetSpec | None] = []
    if "front_matter" in keep:
        specs.append(build_front_matter(layout, titles))
    if "summary" in keep:
        specs.append(build_summary(layout, titles))
    if "matrix" in keep:
        specs.append(build_matrix(layout, titles))
    if "level_tables" in keep:
        specs.extend(build_level_tables(layout, titles, shape))
    if "data" in keep:
        specs.append(build_data_sheet(layout, titles))
    if "verification" in keep:
        specs.append(build_verification(layout, titles))
    if "ai_proposals" in keep:
        specs.append(build_ai_proposals(layout, titles))
    if "appraisal_summary" in keep:
        specs.append(build_appraisal_summary(layout, titles, shape))
    if "codebook" in keep:
        specs.append(build_codebook(layout, titles))
    if "options" in keep:
        specs.append(build_options(layout, titles))
    return [spec for spec in specs if spec is not None]


def build_workbook(layout: ExportLayout, shape: ExportShape, *, include_matrix: bool) -> bytes:
    """Build the export workbook bytes for the given layout and shape."""
    titles = allocate_titles(layout, shape, include_matrix=include_matrix)

    wb = Workbook()
    default = wb.active
    if default is not None:
        wb.remove(default)

    # Titles were allocated unique and Excel-safe by ``allocate_titles``.
    for spec in _ordered_specs(layout, shape, titles):
        _render_sheet_spec(wb.create_sheet(title=spec.title), spec)

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def _level_bounds(layout: ExportLayout) -> tuple[dict[UUID | None, int], dict[UUID, int]]:
    """``(fields per level, records per repeating level)``; ``None`` = Articles."""
    walked = walk_sections(layout.sections)
    fields: dict[UUID | None, int] = {}
    for s in walked:
        level = level_of(s, layout.sections)
        fields[level] = fields.get(level, 0) + len(s.fields)
    records = {
        s.entity_type_id: sum(len(iter_records(s, a, layout.sections)) for a in layout.articles)
        for s in walked
        if s.cardinality is ExtractionCardinality.MANY
    }
    return fields, records


def estimate_sheet_cells(layout: ExportLayout, shape: ExportShape) -> dict[str | UUID, int]:
    """An upper bound of ``rows × columns`` per present sheet (R9), keyed like
    ``SheetTitles``: fixed roles by builder id (``articles`` included), level
    sheets by ``entity_type_id``. Read before any sheet is built, so the
    budget refuses an oversized export without paying for it."""
    titles = allocate_titles(layout, shape, include_matrix=matrix_fits(layout))
    by_id = {s.entity_type_id: s for s in layout.sections}
    fields, records = _level_bounds(layout)
    raters = 1 + len(layout.reviewers) if layout.mode is ExportMode.ALL_USERS else 1
    footnotes = 5 if shape is ExportShape.PUBLICATION else 0  # blank + NI, NA, NE, NA* (D7)
    n_articles = len(layout.articles)
    n_records = sum(records.values())
    n_reviewers = len(layout.reviewers)

    def readme_rows() -> int:
        # Variable blocks: Contents, code clashes, AI tools, rule notes.
        variable = len(titles.order) + len(layout.codebook) + len(layout.ai_proposal_rows)
        return variable + len(layout.appraisal_notes) + 200

    def appraisal_cells() -> int:
        a = layout.appraisal
        if a is None:
            return 0
        width = 1 + len(a.domain_labels) + max(1, len(a.derived_labels)) + n_reviewers
        return (len(a.rows) + 1 + footnotes) * width

    walked = walk_sections(layout.sections)
    bounds: dict[str, int] = {
        "front_matter": readme_rows() * 4,
        "summary": (n_articles + n_records + len(layout.omitted) + 200) * 5,
        "matrix": _matrix_column_count(layout)
        * (sum(len(s.fields) for s in walked) + len(walked) + 2),
        "articles": (n_articles * raters + 1 + footnotes) * (5 + 1 + 3 * fields.get(None, 0)),
        "data": (len(layout.value_map) + 1) * len(DATA_COLUMNS),
        "verification": (len({k[:3] for k in layout.cells}) + 1) * (13 + n_reviewers),
        "ai_proposals": (len(layout.ai_proposal_rows) + 1) * len(AI_PROPOSAL_COLUMNS),
        "appraisal_summary": appraisal_cells(),
        "codebook": (len(layout.codebook) + 1) * 17,
        "options": (sum(len(e.options) for e in layout.codebook) + 1) * 5,
    }
    out: dict[str | UUID, int] = {role: bounds[role] for role in titles.fixed}
    if "articles" in titles.fixed:
        for level_id in titles.levels:
            above = sum(
                1
                for s in ancestry(by_id[level_id], layout.sections)[:-1]
                if s.cardinality is ExtractionCardinality.MANY
            )
            width = 5 + above + 1 + 3 * fields.get(level_id, 0)
            out[level_id] = (records[level_id] * raters + 1 + footnotes) * width
    return out


def estimate_cells(layout: ExportLayout, shape: ExportShape) -> int:
    """The whole workbook's cell upper bound: the budget's measure."""
    return sum(estimate_sheet_cells(layout, shape).values())


__all__ = [
    "EXCEL_MAX_COLUMNS",
    "ExportShape",
    "SheetTitles",
    "allocate_titles",
    "build_workbook",
    "estimate_cells",
    "estimate_sheet_cells",
    "matrix_fits",
    "shape_needs_articles",
]
