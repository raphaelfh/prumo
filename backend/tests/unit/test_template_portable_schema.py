# backend/tests/unit/test_template_portable_schema.py
"""Pure-Pydantic tests for the prumo-template@1 format (no DB).

The structural rules live in model validators so a file can never express a
role/parent combination the DB would reject; every rule here has a test.
Names are >= 2 chars everywhere: the shared aliases enforce min_length=2 and
Pydantic skips `mode="after"` validators when a field already failed.
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.schemas.template_portable import (
    MAX_TOTAL_FIELDS,
    PORTABLE_FORMAT_VERSION,
    PortableField,
    PortableSection,
    PortableTemplate,
)


def _doc(**overrides):
    base = {
        "prumo_template": 1,
        "kind": "extraction",
        "name": "T",
        "sections": [
            {
                "name": "sec",
                "label": "S",
                "fields": [{"name": "f1", "label": "F1", "type": "text"}],
            },
        ],
    }
    base.update(overrides)
    return base


def test_format_version_constant() -> None:
    assert PORTABLE_FORMAT_VERSION == 1


def test_minimal_document_parses_with_defaults() -> None:
    doc = PortableTemplate.model_validate(_doc())
    assert doc.framework == "CUSTOM"
    assert doc.version == "1.0.0"
    assert doc.sections[0].group is False
    assert doc.sections[0].repeats is False
    assert doc.sections[0].entry_label is None
    assert doc.sections[0].fields[0].field_type == "text"
    assert doc.sections[0].fields[0].is_required is False


def test_dump_uses_file_keys_and_omits_defaults() -> None:
    doc = PortableTemplate.model_validate(_doc())
    assert doc.model_dump(by_alias=True, exclude_defaults=True) == {
        "prumo_template": 1,
        "kind": "extraction",
        "name": "T",
        "sections": [
            {"name": "sec", "label": "S", "fields": [{"name": "f1", "label": "F1", "type": "text"}]}
        ],
    }


def test_field_constructed_by_alias_reads_by_attribute_and_dumps_column_names() -> None:
    fld = PortableField(name="fld", label="F", type="select", required=True, allowed_values=["a"])
    assert fld.field_type == "select" and fld.is_required is True
    dumped = fld.model_dump()
    assert dumped["field_type"] == "select" and dumped["is_required"] is True


def test_from_attributes_by_name_reads_orm_like_objects() -> None:
    class Row:
        name, label, field_type, description = "fld", "F", "number", None
        is_required, llm_description, allowed_values, unit = True, None, None, "kg"
        allowed_units, allow_other, other_label, other_placeholder = None, False, None, None
        allows_not_applicable, allows_not_evaluated = False, True

    fld = PortableField.model_validate(Row(), from_attributes=True, by_name=True)
    assert (fld.field_type, fld.is_required, fld.unit, fld.allows_not_evaluated) == (
        "number",
        True,
        "kg",
        True,
    )


def test_dict_input_rejects_attribute_names() -> None:
    """A file must use the file keys; `field_type` is not a spelling we accept."""
    with pytest.raises(ValidationError) as exc:
        PortableField.model_validate({"name": "fld", "label": "F", "field_type": "text"})
    assert "type" in str(exc.value)


@pytest.mark.parametrize(
    ("sections", "needle"),
    [
        (
            [{"name": "sec", "label": "S", "sections": [{"name": "child", "label": "C"}]}],
            "sections are only allowed inside a group",
        ),
        (
            [
                {"name": "grp1", "label": "G1", "group": True},
                {"name": "grp2", "label": "G2", "group": True},
            ],
            "at most one group",
        ),
        # Deeper nesting: the grandchild's parent is a non-group carrying
        # sections, so it fails its OWN rule first — same needle.
        (
            [
                {
                    "name": "grp",
                    "label": "G",
                    "group": True,
                    "sections": [
                        {
                            "name": "child",
                            "label": "C",
                            "sections": [{"name": "deep", "label": "D"}],
                        }
                    ],
                }
            ],
            "sections are only allowed inside a group",
        ),
        (
            [
                {
                    "name": "grp",
                    "label": "G",
                    "group": True,
                    "sections": [{"name": "child", "label": "C", "group": True}],
                }
            ],
            "a group must be a root section",
        ),
        (
            [
                {
                    "name": "sec",
                    "label": "S",
                    "fields": [
                        {"name": "fld", "label": "A", "type": "text"},
                        {"name": "fld", "label": "B", "type": "text"},
                    ],
                }
            ],
            "duplicate field name",
        ),
        (
            [
                {
                    "name": "sec",
                    "label": "S",
                    "fields": [{"name": "Bad", "label": "B", "type": "text"}],
                }
            ],
            "String should match pattern",
        ),
        (
            [
                {
                    "name": "sec",
                    "label": "S",
                    "fields": [{"name": "fld", "label": "B", "type": "blob"}],
                }
            ],
            "Input should be",
        ),
        # validation_schema is not a format key (spec §4.4)
        (
            [
                {
                    "name": "sec",
                    "label": "S",
                    "fields": [
                        {"name": "fld", "label": "B", "type": "text", "validation_schema": {"x": 1}}
                    ],
                }
            ],
            "Extra inputs are not permitted",
        ),
        (
            [{"name": "sec", "label": "S", "entry_label": "thing"}],
            "entry_label is only allowed on a group",
        ),
    ],
)
def test_structural_rejections(sections, needle) -> None:
    with pytest.raises(ValidationError) as exc:
        PortableTemplate.model_validate(_doc(sections=sections))
    assert needle in str(exc.value)


def test_same_named_sibling_sections_are_legal() -> None:
    doc = PortableTemplate.model_validate(
        _doc(sections=[{"name": "sec", "label": "A"}, {"name": "sec", "label": "B"}])
    )
    assert [s.label for s in doc.sections] == ["A", "B"]


def test_wrong_kind_and_version_are_rejected_by_the_model() -> None:
    with pytest.raises(ValidationError):
        PortableTemplate.model_validate(_doc(kind="quality_assessment"))
    with pytest.raises(ValidationError):
        PortableTemplate.model_validate(_doc(prumo_template=2))


def test_size_caps() -> None:
    with pytest.raises(ValidationError):
        PortableTemplate.model_validate(
            _doc(sections=[{"name": f"sec{i}", "label": "S"} for i in range(101)])
        )
    with pytest.raises(ValidationError):
        PortableTemplate.model_validate(_doc(sections=[]))
    # Per-level caps multiply; the total-fields cap bounds the transaction.
    big = [
        {
            "name": f"sec{i}",
            "label": "S",
            "fields": [{"name": f"f{j}", "label": "F", "type": "text"} for j in range(200)],
        }
        for i in range(11)
    ]
    with pytest.raises(ValidationError) as exc:
        PortableTemplate.model_validate(_doc(sections=big))
    assert f"at most {MAX_TOTAL_FIELDS} fields" in str(exc.value)


def test_long_llm_description_is_legal_up_to_4000() -> None:
    """The seeded CHARMS+Multimodal carries ~1.4k-char llm_descriptions; the
    editor's 1000 cap is a UX guard the seed itself exceeds (spec §4.3)."""
    fld = PortableField(name="fld", label="F", type="text", llm_description="x" * 4000)
    assert len(fld.llm_description or "") == 4000
    with pytest.raises(ValidationError):
        PortableField(name="fld", label="F", type="text", llm_description="x" * 4001)


def test_description_caps() -> None:
    with pytest.raises(ValidationError):
        PortableSection(name="sec", label="S", description="x" * 501)
    with pytest.raises(ValidationError):
        PortableTemplate.model_validate(_doc(description="x" * 2001))


def test_section_model_is_importable() -> None:
    sec = PortableSection(name="sec", label="S")
    assert sec.fields == [] and sec.sections == []
