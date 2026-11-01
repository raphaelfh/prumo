"""Unit tests for ``exports/codebook_model.py``: rule-3 field codes and the
version-spanning Codebook entries."""

from __future__ import annotations

from uuid import UUID, uuid4

from app.models.extraction import ExtractionFieldType
from app.services.exports.codebook_model import (
    CodebookOption,
    VersionSections,
    apply_field_codes,
    assign_field_codes,
    build_codebook_entries,
    field_code_clashes,
)
from app.services.exports.extraction_snapshot_reader import AllowedValue
from app.services.exports.values import build_option_labels
from app.services.extraction_export_service import FieldDescriptor, SectionDescriptor


def _short(fid: UUID) -> str:
    return str(fid).split("-")[0]


def _s(sid: UUID, name: str, *fields: FieldDescriptor, order: int = 0) -> SectionDescriptor:
    return SectionDescriptor(
        entity_type_id=sid,
        label=name.title(),
        parent_entity_type_id=None,
        fields=fields,
        sort_order=order,
        name=name,
    )


def _f(fid: UUID, name: str, *, label: str = "F") -> FieldDescriptor:
    return FieldDescriptor(
        field_id=fid, label=label, type=ExtractionFieldType.TEXT, allowed_values=(), name=name
    )


def _sel(fid: UUID, name: str, *options: tuple[str, str]) -> FieldDescriptor:
    return FieldDescriptor(
        field_id=fid,
        label=name.title(),
        type=ExtractionFieldType.SELECT,
        allowed_values=tuple(AllowedValue(c, lbl) for c, lbl in options),
        name=name,
    )


def test_active_field_keeps_bare_code_and_clashing_removed_field_is_suffixed():
    sec_id = uuid4()
    a, b = uuid4(), uuid4()
    active = VersionSections(uuid4(), 2, (_s(sec_id, "participants", _f(a, "age")),), {})
    v1 = VersionSections(uuid4(), 1, (_s(sec_id, "participants", _f(b, "age")),), {})
    codes = {e.field_id: e.field_code for e in build_codebook_entries(active, (v1,), {})}
    assert codes == {a: "participants.age", b: f"participants.age__{_short(b)}"}


def test_two_active_fields_sharing_a_code_suffix_only_the_later_one():  # D1
    a, b = uuid4(), uuid4()
    assert assign_field_codes([(a, "dup.x", True), (b, "dup.x", True)]) == {
        a: "dup.x",
        b: f"dup.x__{_short(b)}",
    }


def test_removed_field_keeps_bare_code_when_nothing_else_holds_it():
    a, b = uuid4(), uuid4()
    assert assign_field_codes([(a, "s.x", True), (b, "s.y", False)]) == {a: "s.x", b: "s.y"}


def test_field_code_clashes_list_each_shared_bare_code():  # D1 README input
    a, b = uuid4(), uuid4()
    active = VersionSections(
        uuid4(),
        1,
        (_s(uuid4(), "dup", _f(a, "x"), order=0), _s(uuid4(), "dup", _f(b, "x"), order=1)),
        {},
    )
    entries = build_codebook_entries(active, (), {})
    assert field_code_clashes(entries) == (("dup.x", ("dup.x", f"dup.x__{_short(b)}")),)


def test_removed_section_field_has_no_section_id_and_lists_its_versions():
    gone = uuid4()
    active = VersionSections(uuid4(), 3, (), {})
    v1 = VersionSections(uuid4(), 1, (_s(uuid4(), "old", _f(gone, "x", label="Old")),), {})
    v2 = VersionSections(uuid4(), 2, (_s(uuid4(), "old", _f(gone, "x", label="Newer")),), {})
    (e,) = build_codebook_entries(active, (v2, v1), {})
    assert (e.section_id, e.in_current_version, e.versions, e.field_label) == (
        None,
        False,
        (1, 2),
        "Newer",
    )


def test_active_entry_reads_section_and_metadata_from_the_active_tree():
    fid, sid = uuid4(), uuid4()
    active = VersionSections(uuid4(), 2, (_s(sid, "s", _f(fid, "x", label="Now")),), {})
    v1 = VersionSections(uuid4(), 1, (_s(sid, "s", _f(fid, "x", label="Then")),), {})
    (e,) = build_codebook_entries(active, (v1,), {})
    assert (e.section_id, e.section_code, e.field_label, e.in_current_version, e.versions) == (
        sid,
        "s",
        "Now",
        True,
        (1, 2),
    )


def test_renamed_option_gives_one_row_labelled_from_active():
    fid, sid = uuid4(), uuid4()
    active = VersionSections(
        uuid4(), 2, (_s(sid, "s", _sel(fid, "smoking", ("None", "None reported"))),), {}
    )
    v1 = VersionSections(uuid4(), 1, (_s(sid, "s", _sel(fid, "smoking", ("None", "No"))),), {})
    (e,) = build_codebook_entries(
        active, (v1,), build_option_labels(active.sections, [v1.sections])
    )
    assert e.options == (CodebookOption("None", "None reported", 1, True),)


def test_option_dropped_from_active_keeps_a_non_current_row():
    fid, sid = uuid4(), uuid4()
    active = VersionSections(uuid4(), 2, (_s(sid, "s", _sel(fid, "c", ("A", "A"))),), {})
    v1 = VersionSections(uuid4(), 1, (_s(sid, "s", _sel(fid, "c", ("A", "A"), ("B", "Bee"))),), {})
    (e,) = build_codebook_entries(
        active, (v1,), build_option_labels(active.sections, [v1.sections])
    )
    assert e.options[1] == CodebookOption("B", "Bee", 2, False)


def test_apply_field_codes_stamps_each_field_code():
    fid, other = uuid4(), uuid4()
    (sec,) = apply_field_codes([_s(uuid4(), "s", _f(fid, "x"), _f(other, "y"))], {fid: "s.x"})
    assert [f.code for f in sec.fields] == ["s.x", ""]


def test_make_layout_stamps_field_codes_and_fills_the_codebook():
    from tests.unit.helpers.export_layouts import export_value, make_layout

    fid = uuid4()
    layout = make_layout(sections=(_s(uuid4(), "s", _sel(fid, "c", ("A", "Alpha"))),))
    assert [f.code for f in layout.sections[0].fields] == ["s.c"]
    ((code, opts),) = [(e.field_code, e.options) for e in layout.codebook]
    assert (code, opts) == ("s.c", (CodebookOption("A", "Alpha", 1, True),))
    assert export_value().status == "answered" and export_value().value_num is None
