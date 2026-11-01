"""Level sheets (rules 1, 2, 6): Articles plus one sheet per repeating level."""

from __future__ import annotations

import re
from uuid import UUID, uuid4

from app.models.extraction import ExtractionCardinality, ExtractionFieldType
from app.services.exports.descriptors import count_level_records, record_keys, value_key
from app.services.exports.extraction.level_tables import build_level_tables, publication_header
from app.services.exports.extraction.sheet_spec import SheetSpec
from app.services.exports.extraction.workbook import ExportShape, allocate_titles
from app.services.exports.extraction_snapshot_reader import AllowedValue
from app.services.exports.values import SCOPE_MARKER, publication_footnotes
from app.services.extraction_export_service import (
    ArticleDescriptor,
    ExportLayout,
    ExportMode,
    FieldDescriptor,
    ReviewerDescriptor,
    SectionDescriptor,
)
from tests.unit.helpers.export_layouts import export_value, make_article, make_layout

_UUID_RE = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", re.I)
MANY = ExtractionCardinality.MANY


def _f(name: str, *, label: str | None = None, **over) -> FieldDescriptor:
    return FieldDescriptor(
        field_id=over.pop("field_id", uuid4()),
        label=label or name.title(),
        type=over.pop("type", ExtractionFieldType.TEXT),
        allowed_values=(),
        name=name,
        **over,
    )


def _s(
    name: str,
    *fields: FieldDescriptor,
    parent: SectionDescriptor | None = None,
    many: bool = False,
    order: int = 0,
    label: str | None = None,
    entry_label: str | None = None,
) -> SectionDescriptor:
    return SectionDescriptor(
        entity_type_id=uuid4(),
        label=label or name.title(),
        parent_entity_type_id=parent.entity_type_id if parent else None,
        fields=fields,
        cardinality=MANY if many else ExtractionCardinality.ONE,
        sort_order=order,
        name=name,
        entry_label=entry_label,
    )


def _art(entries, *, label: str = "Smith 2020", **over) -> ArticleDescriptor:
    return ArticleDescriptor(
        article_id=over.pop("article_id", uuid4()),
        article_label=label,
        run_id=over.pop("run_id", uuid4()),
        version_id=None,
        entries=entries,
        **over,
    )


def _sheets(layout: ExportLayout, shape: ExportShape = ExportShape.COMPLETE) -> list[SheetSpec]:
    return build_level_tables(layout, allocate_titles(layout, shape, include_matrix=True), shape)


def _values(spec: SheetSpec, row: int) -> list:
    return [c.value for c in spec.rows[row]]


def _field_of(layout: ExportLayout, name: str) -> FieldDescriptor:
    return next(f for s in layout.sections for f in s.fields if f.name == name)


def test_articles_sheet_key_columns_in_review_workbook() -> None:
    participants = _s("participants", _f("age", unit="years"), _f("sex"))
    layout = make_layout(
        sections=(participants,),
        articles=(_art({(participants.entity_type_id, None): (uuid4(),)}),),
    )
    sheets = _sheets(layout)
    assert sheets[0].title == "Articles"
    assert _values(sheets[0], 0) == [
        "article_id",
        "article_label",
        "doi",
        "pmid",
        "template_version",
        "participants.age (years)",
        "participants.sex",
    ]


def test_articles_rows_carry_identity_and_values() -> None:
    s = _s("s", _f("x"))
    i = uuid4()
    art = _art({(s.entity_type_id, None): (i,)}, doi="10.1/x", pmid="42", template_version=3)
    layout = make_layout(sections=(s,), articles=(art,))
    fx = _field_of(layout, "x")
    layout = make_layout(
        sections=(s,),
        articles=(art,),
        value_map={value_key(art.run_id, i, fx.field_id): export_value(value_text="v")},
    )
    assert _values(_sheets(layout)[0], 1) == [
        str(art.article_id),
        "Smith 2020",
        "10.1/x",
        "42",
        3,
        "v",
    ]


def test_level_sheet_keys_name_every_repeating_ancestor() -> None:
    groups = _s("groups", many=True, entry_label="group")
    items = _s("items", _f("name"), parent=groups, many=True)
    e1, p1, p2 = uuid4(), uuid4(), uuid4()
    art = _art({(groups.entity_type_id, None): (e1,), (items.entity_type_id, e1): (p1, p2)})
    sheets = _sheets(make_layout(sections=(groups, items), articles=(art,)))
    assert [s.title for s in sheets] == ["Articles", "groups", "items"]
    items_sheet = sheets[2]
    assert _values(items_sheet, 0) == [
        "article_id",
        "article_label",
        "record_id",
        "parent_record_id",
        "record_label",
        "groups.label",
        "items.name",
    ]
    assert [r[2].value for r in items_sheet.rows[1:]] == [str(p1), str(p2)]
    assert [r[3].value for r in items_sheet.rows[1:]] == [str(e1), str(e1)]
    assert [r[4].value for r in items_sheet.rows[1:]] == ["Items 1", "Items 2"]
    assert [r[5].value for r in items_sheet.rows[1:]] == ["Group 1", "Group 1"]
    # A root-level record's parent is the article.
    assert _values(sheets[1], 1)[2:5] == [str(e1), str(art.article_id), "Group 1"]


def test_unit_and_other_companions_hold_machine_values() -> None:
    arm = _s(
        "arm",
        _f("dose", type=ExtractionFieldType.NUMBER, unit="mg", allowed_units=("mg", "g")),
        _f("route", type=ExtractionFieldType.SELECT, allow_other=True),
        many=True,
    )
    i = uuid4()
    art = _art({(arm.entity_type_id, None): (i,)})
    layout = make_layout(sections=(arm,), articles=(art,))
    dose, route = _field_of(layout, "dose"), _field_of(layout, "route")
    layout = make_layout(
        sections=(arm,),
        articles=(art,),
        value_map={
            value_key(art.run_id, i, dose.field_id): export_value(value_num=5, unit="mg"),
            value_key(art.run_id, i, route.field_id): export_value(other_text="intrathecal"),
        },
    )
    sheet = _sheets(layout)[1]
    assert _values(sheet, 0)[-4:] == ["arm.dose", "arm.dose.unit", "arm.route", "arm.route.other"]
    assert _values(sheet, 1)[-4:] == [5, "mg", None, "intrathecal"]


def test_absent_and_out_of_scope_cells_are_blank() -> None:
    s = _s("s", _f("a"), _f("b", type=ExtractionFieldType.NUMBER))
    i = uuid4()
    art = _art({(s.entity_type_id, None): (i,)})
    layout = make_layout(sections=(s,), articles=(art,))
    fa, fb = _field_of(layout, "a"), _field_of(layout, "b")
    layout = make_layout(
        sections=(s,),
        articles=(art,),
        value_map={
            value_key(art.run_id, i, fa.field_id): export_value(
                status="absent", absent_code="no_information"
            ),
            value_key(art.run_id, i, fb.field_id): export_value(value_num=3, out_of_scope=True),
        },
    )
    assert _values(_sheets(layout)[0], 1)[-2:] == [None, None]


def test_false_boolean_is_written_not_blanked() -> None:
    s = _s("s", _f("flag", type=ExtractionFieldType.BOOLEAN))
    i = uuid4()
    art = _art({(s.entity_type_id, None): (i,)})
    layout = make_layout(sections=(s,), articles=(art,))
    ff = _field_of(layout, "flag")
    layout = make_layout(
        sections=(s,),
        articles=(art,),
        value_map={value_key(art.run_id, i, ff.field_id): export_value(value_bool=False)},
    )
    assert _values(_sheets(layout)[0], 1)[-1] is False


def test_two_singletons_under_one_parent_show_the_first() -> None:
    m = _s("m", many=True, order=0)
    s = _s("s", _f("x"), parent=m)
    e1, i1, i2 = uuid4(), uuid4(), uuid4()
    art = _art({(m.entity_type_id, None): (e1,), (s.entity_type_id, e1): (i1, i2)})
    layout = make_layout(sections=(m, s), articles=(art,))
    fx = _field_of(layout, "x")
    layout = make_layout(
        sections=(m, s),
        articles=(art,),
        value_map={
            value_key(art.run_id, i1, fx.field_id): export_value(value_text="first"),
            value_key(art.run_id, i2, fx.field_id): export_value(value_text="second"),
        },
    )
    m_sheet = _sheets(layout)[1]
    assert len(m_sheet.rows) == 2
    hdr = _values(m_sheet, 0)
    assert m_sheet.rows[1][hdr.index("s.x")].value == "first"


def test_one_to_one_chain_below_a_record_reaches_the_leaf() -> None:  # Review Focus 2
    m = _s("m", many=True)
    mid = _s("mid", parent=m)
    leaf = _s("leaf", _f("x"), parent=mid)
    e1, j1, k1 = uuid4(), uuid4(), uuid4()
    art = _art(
        {
            (m.entity_type_id, None): (e1,),
            (mid.entity_type_id, e1): (j1,),
            (leaf.entity_type_id, j1): (k1,),
        }
    )
    layout = make_layout(sections=(m, mid, leaf), articles=(art,))
    fx = _field_of(layout, "x")
    layout = make_layout(
        sections=(m, mid, leaf),
        articles=(art,),
        value_map={value_key(art.run_id, k1, fx.field_id): export_value(value_text="v")},
    )
    sheet = _sheets(layout)[1]
    header = _values(sheet, 0)
    assert _values(sheet, 1)[header.index("leaf.x")] == "v"


def test_all_users_rows_unique_and_idle_reviewers_skipped() -> None:  # Review Focus 5
    s = _s("s", _f("x"))
    r1, r2 = uuid4(), uuid4()
    ia, ib = uuid4(), uuid4()
    a = _art({(s.entity_type_id, None): (ia,)}, label="A 2020")
    b = _art({(s.entity_type_id, None): (ib,)}, label="B 2021")
    layout = make_layout(sections=(s,), articles=(a, b))
    fx = _field_of(layout, "x")
    layout = make_layout(
        sections=(s,),
        articles=(a, b),
        mode=ExportMode.ALL_USERS,
        reviewers=(ReviewerDescriptor(r1, "Reviewer A"), ReviewerDescriptor(r2, "Reviewer B")),
        raters_by_run={a.run_id: (r1,), b.run_id: ()},
        value_map={
            value_key(a.run_id, ia, fx.field_id, r1): export_value(value_text="mine"),
            value_key(b.run_id, ib, fx.field_id, r2): export_value(value_text="rejected"),
        },
    )
    arts = _sheets(layout)[0]
    hdr = _values(arts, 0)
    assert hdr[-1] == "rater" and hdr.index("rater") > hdr.index("template_version")
    keys = [(r[0].value, r[hdr.index("rater")].value) for r in arts.rows[1:]]
    assert keys == [
        (str(a.article_id), "consensus"),
        (str(a.article_id), "Reviewer A"),
        (str(b.article_id), "consensus"),
    ]
    assert len(set(keys)) == len(keys)
    assert arts.rows[2][hdr.index("s.x")].value == "mine"


def test_all_users_level_sheet_puts_rater_before_the_fields() -> None:
    m = _s("m", _f("x"), many=True)
    r1 = uuid4()
    e1 = uuid4()
    art = _art({(m.entity_type_id, None): (e1,)})
    layout = make_layout(
        sections=(m,),
        articles=(art,),
        mode=ExportMode.ALL_USERS,
        reviewers=(ReviewerDescriptor(r1, "Bea"),),
        raters_by_run={art.run_id: (r1,)},
    )
    sheet = _sheets(layout)[1]
    assert _values(sheet, 0)[-2:] == ["rater", "m.x"]
    assert [r[-2].value for r in sheet.rows[1:]] == ["consensus", "Bea"]


def test_publication_has_label_headers_and_no_uuid() -> None:  # Review Focus 4
    study = _s("study", _f("design", label="Design"), label="Study", order=0)
    models = _s(
        "models",
        _f("auc", label="AUC", type=ExtractionFieldType.NUMBER, unit="%"),
        many=True,
        label="Models",
        order=1,
    )
    i, e1 = uuid4(), uuid4()
    art = _art(
        {(study.entity_type_id, None): (i,), (models.entity_type_id, None): (e1,)},
        label="Chen 2020",
        doi="10.1/a",
    )
    layout = make_layout(sections=(study, models), articles=(art,))
    auc = _field_of(layout, "auc")
    layout = make_layout(
        sections=(study, models),
        articles=(art,),
        value_map={value_key(art.run_id, e1, auc.field_id): export_value(value_num=81)},
    )
    pub = _sheets(layout, ExportShape.PUBLICATION)
    for sheet in pub:
        for row in sheet.rows:
            assert not any(_UUID_RE.search(str(c.value)) for c in row if c.value is not None)
    assert _values(pub[0], 0) == ["Article", "DOI", "PMID", "Design"]
    assert pub[1].title == "Models"
    assert _values(pub[1], 0) == ["Article", "Models", "AUC (%)"]
    assert _values(pub[1], 1) == ["Chen 2020", "Models 1", 81]


def test_single_user_rows_read_the_reviewer_slot() -> None:  # Review Focus 6, R1
    s = _s("s", _f("x"))
    r1, i = uuid4(), uuid4()
    art = _art({(s.entity_type_id, None): (i,)})
    layout = make_layout(sections=(s,), articles=(art,))
    fx = _field_of(layout, "x")
    layout = make_layout(
        sections=(s,),
        articles=(art,),
        mode=ExportMode.SINGLE_USER,
        reviewer_id=r1,
        value_map={
            value_key(art.run_id, i, fx.field_id, r1): export_value(value_text="mine"),
            value_key(art.run_id, i, fx.field_id): export_value(value_text="stale"),
        },
    )
    arts = _sheets(layout)[0]
    hdr = _values(arts, 0)
    assert "rater" not in hdr
    assert arts.rows[1][hdr.index("s.x")].value == "mine"


def test_articles_without_a_run_get_no_row() -> None:
    s = _s("s", _f("x"))
    layout = make_layout(sections=(s,), articles=(_art({}, run_id=None),))
    assert len(_sheets(layout)[0].rows) == 1


def test_count_level_records_counts_many_rows_only() -> None:
    root = _s("root", _f("x"), order=0)
    groups = _s("groups", many=True, order=1)
    items = _s("items", _f("y"), parent=groups, many=True)
    g1, g2 = uuid4(), uuid4()
    art = _art(
        {
            (root.entity_type_id, None): (uuid4(),),
            (groups.entity_type_id, None): (g1, g2),
            (items.entity_type_id, g1): (uuid4(), uuid4()),
            (items.entity_type_id, g2): (uuid4(), uuid4()),
        }
    )
    no_run = _art(dict(art.entries), run_id=None)
    layout = make_layout(sections=(root, groups, items), articles=(art, no_run))
    assert count_level_records(layout.sections, layout.articles) == 6


def test_record_keys_resolve_record_and_parent_through_a_singleton() -> None:  # R18
    m = _s("m", many=True, order=0)
    mid = _s("mid", parent=m)
    leaf = _s("leaf", _f("x"), parent=mid, many=True)
    r = _s("r", _f("y"), order=1)
    e1, j1, l1, r1 = uuid4(), uuid4(), uuid4(), uuid4()
    art = _art(
        {
            (m.entity_type_id, None): (e1,),
            (mid.entity_type_id, e1): (j1,),
            (leaf.entity_type_id, j1): (l1,),
            (r.entity_type_id, None): (r1,),
        }
    )
    secs = (m, mid, leaf, r)
    assert record_keys(art, l1, secs) == (l1, e1, leaf)
    assert record_keys(art, j1, secs) == (e1, art.article_id, mid)
    assert record_keys(art, r1, secs) == (art.article_id, None, r)
    assert record_keys(art, uuid4(), secs)[2] is None


def test_sheet_for_maps_sections_to_their_level_title() -> None:  # R8
    study = _s("study", _f("design"), order=0)
    models = _s("models", many=True, order=1)
    perf = _s("perf", _f("auc"), parent=models)
    gone_id: UUID = uuid4()
    layout = make_layout(sections=(study, models, perf))
    t = allocate_titles(layout, ExportShape.DICTIONARY, include_matrix=False)
    assert (
        t.sheet_for(None),
        t.sheet_for(study.entity_type_id),
        t.sheet_for(perf.entity_type_id),
        t.sheet_for(gone_id),
    ) == ("Articles", "Articles", "models", None)
    assert "articles" not in t.fixed and "Articles" not in t.order


# --- Publication display cells, label headers and footnotes (PR6 Task 2) ---

N = _f("n", label="Sample size", type=ExtractionFieldType.NUMBER, unit="participants")
DOSE = _f("dose", label="Dose", type=ExtractionFieldType.NUMBER, allowed_units=("mg", "g"))
RISK = FieldDescriptor(
    field_id=uuid4(),
    label="Risk",
    type=ExtractionFieldType.SELECT,
    allowed_values=(AllowedValue("L", "Low"),),
    name="risk",
)
AGE, SEX, SITE = _f("age"), _f("sex"), _f("site")
PARTICIPANTS = _s("participants", N, DOSE, RISK, AGE, SEX, SITE)
SMITH, SMITH_RUN, SMITH_I = make_article(section_id=PARTICIPANTS.entity_type_id, label="Smith 2020")
JONES, JONES_RUN, JONES_I = make_article(section_id=PARTICIPANTS.entity_type_id, label="Jones 2021")
ARTICLES = (SMITH, JONES)


def _smith(f: FieldDescriptor):
    return value_key(SMITH_RUN, SMITH_I, f.field_id)


ANSWERED_VALUES = {
    _smith(N): export_value(value_num=7394),
    _smith(DOSE): export_value(value_num=5, unit="mg"),
    _smith(RISK): export_value(value_text="L", value_label="Low"),
    value_key(JONES_RUN, JONES_I, N.field_id): export_value(value_num=12),
}
MARKED_VALUES = {
    **ANSWERED_VALUES,
    _smith(AGE): export_value("absent", absent_code="no_information"),
    _smith(SEX): export_value("absent", absent_code="not_applicable"),
    _smith(SITE): export_value("absent", absent_code="not_evaluated"),
    value_key(JONES_RUN, JONES_I, N.field_id): export_value(value_num=12, out_of_scope=True),
}
TWO_VALUE_FIELDS = _s(
    "pair", _f("a", label="Value"), _f("b", label="Value"), _f("c", label="Value")
)
ONE_ARTICLE = (make_article(section_id=TWO_VALUE_FIELDS.entity_type_id, label="Lee 2022")[0],)


def _publication_articles(layout: ExportLayout) -> SheetSpec:
    return next(s for s in _sheets(layout, ExportShape.PUBLICATION) if s.title == "Articles")


def test_publication_header_puts_a_fixed_unit_in_the_label() -> None:
    assert publication_header(N) == "Sample size (participants)"
    assert publication_header(DOSE) == "Dose"
    assert publication_header(_f("x", label="X", unit="")) == "X"


def test_publication_articles_sheet_shows_display_cells_and_footnotes() -> None:
    spec = _publication_articles(
        make_layout(sections=(PARTICIPANTS,), articles=ARTICLES, value_map=MARKED_VALUES)
    )
    header = _values(spec, 0)
    assert header[0] == "Article"
    assert "Sample size (participants)" in header
    assert "Dose" in header and "Dose (mg)" not in header
    assert not any(isinstance(h, str) and h.endswith((".unit", ".other")) for h in header)
    row1 = dict(zip(header, _values(spec, 1), strict=True))
    assert (row1["Sample size (participants)"], row1["Dose"], row1["Risk"]) == (7394, "5 mg", "Low")
    assert (row1["Age"], row1["Sex"], row1["Site"]) == ("NI", "NA", "NE")
    row2 = dict(zip(header, _values(spec, 2), strict=True))
    assert row2["Sample size (participants)"] == SCOPE_MARKER
    assert all(c.value is None for c in spec.rows[3])
    assert [r[0].value for r in spec.rows[4:]] == list(
        publication_footnotes({"NI", "NA", "NE", SCOPE_MARKER})
    )
    assert all(len(r) == 1 for r in spec.rows[4:])


def test_publication_sheet_without_markers_has_no_footnote_rows() -> None:
    spec = _publication_articles(
        make_layout(sections=(PARTICIPANTS,), articles=ARTICLES, value_map=ANSWERED_VALUES)
    )
    assert len(spec.rows) == 3  # header + 2 articles


def test_publication_level_sheet_gets_its_own_footnotes() -> None:
    m = _s("arms", AGE, many=True, label="Arms")
    e1 = uuid4()
    art = _art({(m.entity_type_id, None): (e1,)})
    value_map = {
        value_key(art.run_id, e1, AGE.field_id): export_value("absent", absent_code="not_evaluated")
    }
    layout = make_layout(sections=(m,), articles=(art,), value_map=value_map)
    sheets = _sheets(layout, ExportShape.PUBLICATION)
    assert len(sheets[0].rows) == 2  # Articles: no marker, no footnote
    arms = sheets[1]
    assert _values(arms, 1)[-1] == "NE"
    assert [r[0].value for r in arms.rows[2:]] == [None, "NE = Not evaluated"]


def test_publication_duplicate_labels_get_distinct_headers() -> None:  # Review Focus 4
    spec = _publication_articles(
        make_layout(sections=(TWO_VALUE_FIELDS,), articles=ONE_ARTICLE, value_map={})
    )
    assert _values(spec, 0)[3:] == ["Value", "Value (2)", "Value (3)"]


def test_review_workbook_level_sheet_never_abbreviates() -> None:
    layout = make_layout(sections=(PARTICIPANTS,), articles=ARTICLES, value_map=MARKED_VALUES)
    titles = allocate_titles(layout, ExportShape.COMPLETE, include_matrix=True)
    cells = {
        c.value
        for s in build_level_tables(layout, titles, ExportShape.COMPLETE)
        for r in s.rows
        for c in r
    }
    assert cells & {"NI", "NA", "NE", SCOPE_MARKER} == set()
