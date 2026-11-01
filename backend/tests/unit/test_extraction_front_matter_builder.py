"""Unit tests for the README (front-matter) sub-builder (spec §4.5). Pure — no DB."""

from __future__ import annotations

import re
from dataclasses import replace
from datetime import UTC, datetime
from uuid import UUID, uuid4

from app.models.extraction import ExtractionCardinality, ExtractionFieldType
from app.services.exports.descriptors import value_key
from app.services.exports.extraction.front_matter import _LEGEND, build_front_matter
from app.services.exports.extraction.sheet_spec import SheetSpec
from app.services.exports.extraction.workbook import ExportShape, SheetTitles, allocate_titles
from app.services.extraction_export_service import (
    ArticleDescriptor,
    ExportLayout,
    ExportMode,
    FieldDescriptor,
    SectionDescriptor,
)
from tests.unit.helpers.export_layouts import export_value, make_layout

_UUID_RE = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", re.I)


def _field(name: str = "x") -> FieldDescriptor:
    return FieldDescriptor(
        field_id=uuid4(), label=name.title(), type=ExtractionFieldType.TEXT, allowed_values=(),
        name=name,
    )  # fmt: skip


def _one(name: str, field: str, order: int) -> SectionDescriptor:
    return SectionDescriptor(
        entity_type_id=uuid4(),
        label=name.title(),
        parent_entity_type_id=None,
        fields=(_field(field),),
        cardinality=ExtractionCardinality.ONE,
        sort_order=order,
        name=name,
    )


def _many(name: str, field: str) -> SectionDescriptor:
    return replace(_one(name, field, 0), cardinality=ExtractionCardinality.MANY)


def _rows(spec: SheetSpec) -> list[tuple[object, ...]]:
    return [tuple(c.value for c in row if c.value not in (None, "")) for row in spec.rows]


def _titles(layout: ExportLayout) -> SheetTitles:
    return allocate_titles(layout, ExportShape.COMPLETE, include_matrix=True)


def _readme(layout: ExportLayout) -> list[tuple[object, ...]]:
    return _rows(build_front_matter(layout, _titles(layout)))


def _coord() -> tuple[SectionDescriptor, ArticleDescriptor, UUID, UUID, UUID]:
    section = _one("study", "x", 0)
    run, inst = uuid4(), uuid4()
    article = ArticleDescriptor(
        article_id=uuid4(),
        article_label="Smith 2020",
        run_id=run,
        version_id=None,
        entries={(section.entity_type_id, None): (inst,)},
    )
    return section, article, run, inst, section.fields[0].field_id


def test_readme_renders_the_identity_block():
    section = _many("models", "x")
    run, inst = uuid4(), uuid4()
    article = ArticleDescriptor(
        article_id=uuid4(),
        article_label="Smith 2020",
        run_id=run,
        version_id=None,
        entries={(section.entity_type_id, None): (inst, uuid4())},
    )
    layout = make_layout(
        sections=(section,),
        articles=(article,),
        project_name="My SR Project",
        template_name="CHARMS",
        template_version=3,
        generated_at=datetime(2026, 6, 14, 9, 30, tzinfo=UTC),
    )
    spec = build_front_matter(layout, _titles(layout))
    rows = _rows(spec)
    assert spec.title == "README"
    assert ("Project", "My SR Project") in rows
    assert ("Template", "CHARMS (v3)") in rows
    assert ("Export mode", "Consensus") in rows
    assert ("Generated at", "2026-06-14T09:30:00+00:00") in rows
    assert ("Articles", 1) in rows
    assert ("Records", 2) in rows


def test_readme_lists_contents_in_title_order():
    layout = make_layout()
    titles = SheetTitles(
        fixed={"front_matter": "README"},
        levels={},
        order=("README", "Study characteristics", "Codebook (2)"),
        matrix_omitted=False,
    )
    rows = _rows(build_front_matter(layout, titles))
    start = rows.index(("Contents",)) + 1
    assert [r[0] for r in rows[start : start + 3]] == list(titles.order)
    assert rows[start + 3] == ()


def test_readme_counts_values_by_status():
    section, article, run, inst, fid = _coord()
    vm = {
        value_key(run, inst, fid): export_value("answered"),
        value_key(run, uuid4(), fid): export_value("answered"),
        value_key(run, uuid4(), fid): export_value("absent", absent_code="no_information"),
    }
    rows = _readme(make_layout(sections=(section,), articles=(article,), value_map=vm))
    start = rows.index(("Values by status",)) + 1
    assert rows[start : start + 5] == [
        ("answered", 2),
        ("absent", 1),
        ("rejected", 0),
        ("cleared", 0),
        ("nonconforming", 0),
    ]


def test_readme_status_counts_ignore_reviewer_slots_in_all_users():  # Review Focus 5
    section, article, run, inst, fid = _coord()
    r1, r2 = uuid4(), uuid4()
    vm = {
        value_key(run, inst, fid): export_value("answered"),
        value_key(run, inst, fid, r1): export_value("answered"),
        value_key(run, inst, fid, r2): export_value("absent", absent_code="not_applicable"),
    }
    rows = _readme(
        make_layout(
            sections=(section,), articles=(article,), mode=ExportMode.ALL_USERS, value_map=vm
        )
    )
    assert ("answered", 1) in rows
    assert ("absent", 0) in rows


def test_readme_status_counts_read_the_single_user_slot():  # Review Focus 6, R1
    section, article, run, inst, fid = _coord()
    r1 = uuid4()
    vm = {
        value_key(run, inst, fid, r1): export_value("absent", absent_code="no_information"),
        value_key(run, inst, fid): export_value("answered"),
    }
    rows = _readme(
        make_layout(
            sections=(section,),
            articles=(article,),
            mode=ExportMode.SINGLE_USER,
            reviewer_id=r1,
            value_map=vm,
        )
    )
    assert ("absent", 1) in rows
    assert ("answered", 0) in rows


def test_readme_counts_values_outside_level_sheets():  # R17
    section, article, run, inst, fid = _coord()
    gone = uuid4()
    base = make_layout(sections=(section,))
    removed = replace(base.codebook[0], field_id=gone, field_code="old.y", section_id=None)
    vm = {
        value_key(run, inst, fid): export_value("answered"),
        value_key(run, inst, gone): export_value("answered"),
        value_key(run, inst, gone, uuid4()): export_value("answered"),  # not the primary slot
    }
    layout = make_layout(
        sections=(section,),
        articles=(article,),
        value_map=vm,
        codebook=(*base.codebook, removed),
    )
    assert ("Values outside any level sheet", 1) in _readme(layout)


def test_readme_keeps_the_matrix_omitted_note():  # R6
    layout = make_layout(sections=(_one("study", "x", 0),))
    titles = allocate_titles(layout, ExportShape.COMPLETE, include_matrix=False)
    assert titles.matrix_omitted
    rows = _rows(build_front_matter(layout, titles))
    assert any(str(v).startswith("Matrix omitted") for r in rows for v in r)


def test_readme_lists_field_code_clashes_and_skipped_versions():  # D1, D5
    layout = make_layout(
        sections=(_one("dup", "x", order=0), _one("dup", "x", order=1)),
        narrow_pinned_versions=(3,),
    )
    rows = _readme(layout)
    clash = next(r for r in rows if r and r[0] == "dup.x")
    assert clash[1].startswith("dup.x; dup.x__")
    assert any(
        r[:2] == ("Pinned versions not in Codebook (legacy snapshot)", 1) and r[2] == "v3"
        for r in rows
    )


def test_readme_carries_the_rule_notes_and_caveats():
    rows = _readme(make_layout())
    flat = [str(v) for r in rows for v in r]
    assert any(v.startswith("record_label is the name given at creation") for v in flat)
    assert any(v.startswith("A field missing from a run's pinned version is blank") for v in flat)
    assert any(v.startswith("article_label suffixes (b, c, …) follow import order") for v in flat)
    assert any("companion reports" in v for v in flat)
    assert any("trailing zeros" in v for v in flat)
    assert any("vocabulary" in v for v in flat)
    assert any("best-effort" in v for v in flat)


def test_readme_has_no_uuid():  # Review Focus 4
    section, article, run, inst, fid = _coord()
    layout = make_layout(
        sections=(section, _one("dup", "x", 1), _one("dup", "x", 2)),
        articles=(article,),
        value_map={value_key(run, inst, fid): export_value("answered")},
        narrow_pinned_versions=(2,),
    )
    spec = build_front_matter(layout, _titles(layout))
    assert not any(
        _UUID_RE.search(str(c.value)) for r in spec.rows for c in r if c.value is not None
    )


def test_legend_carries_three_disposition_rows_matching_display_value():
    # ADR-0016 Phase 4: each coded disposition's legend label IS the label
    # display_value emits into a cell, so a marker cell and its legend row
    # can never drift.
    from app.services.exports.values import display_value, to_export_value
    from app.services.value_semantics import AbsentReason

    legend = dict(_LEGEND)
    assert legend["No information"] == "The source does not state this item."
    assert legend["Not applicable"] == "The item does not apply to this study."
    assert legend["Not evaluated"] == "The item was not assessed."
    assert "(blank)" in legend
    field = _field()
    for code in AbsentReason:
        marker = {"value": None, "absent_reason": code.value}
        label = display_value(to_export_value(marker, field, {}), field)
        assert label in legend, f"{code.value} label {label!r} missing from legend"
