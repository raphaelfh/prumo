"""Validation tests for ``app.schemas.template_structure`` (B-7 Task 1).

Pure Pydantic v2 validation: no DB, no async, no fixtures. Every
constraint mirrors the frontend Zod ``ExtractionFieldSchema``
(frontend/types/extraction.ts) EXACTLY — the two rule sets guarding the
same wire shape is the drift class the B-7 slice exists to close.
"""

from datetime import UTC, datetime
from types import SimpleNamespace
from uuid import uuid4

import pytest
from pydantic import ValidationError

from app.schemas.template_structure import (
    TemplateFieldCreateRequest,
    TemplateFieldDeleteResponse,
    TemplateFieldMoveRequest,
    TemplateFieldRead,
    TemplateFieldReorderRequest,
    TemplateFieldReorderResponse,
    TemplateFieldSortOrderUpdate,
    TemplateFieldUpdateRequest,
)

ENTITY_TYPE_ID = uuid4()
FIELD_ID = uuid4()

VALID_CREATE = {
    "entity_type_id": str(ENTITY_TYPE_ID),
    "name": "field_example",
    "label": "Field Example",
    "field_type": "text",
}


def make_create(**overrides: object) -> TemplateFieldCreateRequest:
    return TemplateFieldCreateRequest(**{**VALID_CREATE, **overrides})


# =================== TemplateFieldCreateRequest ===================


class TestCreateRequest:
    def test_minimal_valid_construction_applies_defaults(self) -> None:
        model = make_create()
        assert model.entity_type_id == ENTITY_TYPE_ID
        assert model.name == "field_example"
        assert model.label == "Field Example"
        assert model.field_type == "text"
        assert model.is_required is False
        assert model.validation_schema == {}
        assert model.description is None
        assert model.allowed_values is None
        assert model.unit is None
        assert model.allowed_units is None
        assert model.llm_description is None
        assert model.allow_other is False
        assert model.other_placeholder is None
        assert model.allows_not_applicable is False
        assert model.allows_not_evaluated is False
        assert model.sort_order == 0

    def test_other_label_has_no_default(self) -> None:
        """Panel 16: the pt-BR ``'Outro (especificar)'`` Zod default was dead
        code — the backend must NOT resurrect it."""
        assert make_create().other_label is None

    def test_entity_type_id_is_required(self) -> None:
        payload = {k: v for k, v in VALID_CREATE.items() if k != "entity_type_id"}
        with pytest.raises(ValidationError):
            TemplateFieldCreateRequest(**payload)

    def test_extra_keys_are_rejected(self) -> None:
        with pytest.raises(ValidationError):
            make_create(created_at="2026-01-01")

    # ---- name: ^[a-z][a-z0-9_]*$, 2..50 ----

    @pytest.mark.parametrize("name", ["ab", "a2", "a" + "b" * 49, "field_example_9"])
    def test_name_valid(self, name: str) -> None:
        assert make_create(name=name).name == name

    @pytest.mark.parametrize(
        "name",
        [
            "a",  # below min length 2
            "a" + "b" * 50,  # above max length 50
            "1abc",  # must start with a lowercase letter
            "_abc",  # must start with a lowercase letter
            "Abc",  # uppercase rejected
            "ab-c",  # hyphen rejected
            "ab c",  # whitespace rejected
            "",
        ],
    )
    def test_name_invalid(self, name: str) -> None:
        with pytest.raises(ValidationError):
            make_create(name=name)

    # ---- label: 1..100 ----

    @pytest.mark.parametrize("label", ["X", "L" * 100])
    def test_label_valid(self, label: str) -> None:
        assert make_create(label=label).label == label

    @pytest.mark.parametrize("label", ["", "L" * 101])
    def test_label_invalid(self, label: str) -> None:
        with pytest.raises(ValidationError):
            make_create(label=label)

    # ---- description: <=500, nullable ----

    def test_description_boundaries(self) -> None:
        assert make_create(description="d" * 500).description == "d" * 500
        assert make_create(description=None).description is None
        with pytest.raises(ValidationError):
            make_create(description="d" * 501)

    # ---- field_type Literal ----

    @pytest.mark.parametrize(
        "field_type", ["text", "number", "date", "select", "multiselect", "boolean"]
    )
    def test_field_type_valid(self, field_type: str) -> None:
        assert make_create(field_type=field_type).field_type == field_type

    @pytest.mark.parametrize("field_type", ["TEXT", "textt", "json", ""])
    def test_field_type_invalid(self, field_type: str) -> None:
        with pytest.raises(ValidationError):
            make_create(field_type=field_type)

    # ---- validation_schema: dict, default {}, nullable ----

    def test_validation_schema_accepts_dict_and_null(self) -> None:
        assert make_create(validation_schema={"min": 1}).validation_schema == {"min": 1}
        assert make_create(validation_schema=None).validation_schema is None
        with pytest.raises(ValidationError):
            make_create(validation_schema=["not", "a", "dict"])

    # ---- allowed_values: 1..100, unique items, nullable ----

    def test_allowed_values_boundaries(self) -> None:
        hundred = [f"v{i}" for i in range(100)]
        assert make_create(allowed_values=hundred).allowed_values == hundred
        assert make_create(allowed_values=None).allowed_values is None
        with pytest.raises(ValidationError):
            make_create(allowed_values=[])
        with pytest.raises(ValidationError):
            make_create(allowed_values=[f"v{i}" for i in range(101)])

    def test_allowed_values_duplicates_rejected(self) -> None:
        with pytest.raises(ValidationError):
            make_create(allowed_values=["a", "b", "a"])

    # ---- unit: <=50, nullable ----

    def test_unit_boundaries(self) -> None:
        assert make_create(unit="u" * 50).unit == "u" * 50
        with pytest.raises(ValidationError):
            make_create(unit="u" * 51)

    # ---- allowed_units: 1..20, item <=50, unique, nullable ----

    def test_allowed_units_boundaries(self) -> None:
        twenty = [f"u{i}" for i in range(20)]
        assert make_create(allowed_units=twenty).allowed_units == twenty
        assert make_create(allowed_units=None).allowed_units is None
        with pytest.raises(ValidationError):
            make_create(allowed_units=[])
        with pytest.raises(ValidationError):
            make_create(allowed_units=[f"u{i}" for i in range(21)])

    def test_allowed_units_item_length_capped_at_50(self) -> None:
        assert make_create(allowed_units=["u" * 50]).allowed_units == ["u" * 50]
        with pytest.raises(ValidationError):
            make_create(allowed_units=["u" * 51])

    def test_allowed_units_duplicates_rejected(self) -> None:
        with pytest.raises(ValidationError):
            make_create(allowed_units=["mg", "kg", "mg"])

    # ---- llm_description: <=1000, nullable ----

    def test_llm_description_boundaries(self) -> None:
        assert make_create(llm_description="l" * 1000).llm_description == "l" * 1000
        with pytest.raises(ValidationError):
            make_create(llm_description="l" * 1001)

    # ---- other_label <=100 / other_placeholder <=200 ----

    def test_other_label_boundaries(self) -> None:
        assert make_create(other_label="o" * 100).other_label == "o" * 100
        assert make_create(other_label=None).other_label is None
        with pytest.raises(ValidationError):
            make_create(other_label="o" * 101)

    def test_other_placeholder_boundaries(self) -> None:
        assert make_create(other_placeholder="p" * 200).other_placeholder == "p" * 200
        with pytest.raises(ValidationError):
            make_create(other_placeholder="p" * 201)

    # ---- sort_order: int >= 0, client-supplied (panel 10) ----

    def test_sort_order_boundaries(self) -> None:
        assert make_create(sort_order=0).sort_order == 0
        assert make_create(sort_order=7).sort_order == 7
        with pytest.raises(ValidationError):
            make_create(sort_order=-1)


# =================== TemplateFieldUpdateRequest ===================


class TestUpdateRequest:
    def test_empty_update_is_valid(self) -> None:
        model = TemplateFieldUpdateRequest()
        assert model.model_fields_set == set()
        assert model.model_dump(exclude_unset=True) == {}

    def test_partial_update_round_trips_only_set_fields(self) -> None:
        model = TemplateFieldUpdateRequest(label="New Label", sort_order=3)
        assert model.model_dump(exclude_unset=True) == {"label": "New Label", "sort_order": 3}

    def test_entity_type_id_is_rejected(self) -> None:
        """Moves have their own model — an update must never relocate a
        field across sections."""
        with pytest.raises(ValidationError):
            TemplateFieldUpdateRequest(entity_type_id=str(uuid4()))

    @pytest.mark.parametrize(
        "field",
        [
            "name",
            "label",
            "field_type",
            "is_required",
            "allow_other",
            "allows_not_applicable",
            "allows_not_evaluated",
            "allows_no_information",
            "sort_order",
        ],
    )
    def test_explicit_null_rejected_on_non_nullable_fields(self, field: str) -> None:
        """Zod ``.partial()`` keeps non-nullable keys non-nullable: they may
        be omitted, never nulled."""
        with pytest.raises(ValidationError):
            TemplateFieldUpdateRequest(**{field: None})

    @pytest.mark.parametrize(
        "field",
        [
            "description",
            "unit",
            "allowed_units",
            "llm_description",
            "allowed_values",
            "other_label",
            "other_placeholder",
            "validation_schema",
        ],
    )
    def test_explicit_null_accepted_on_nullable_fields(self, field: str) -> None:
        model = TemplateFieldUpdateRequest(**{field: None})
        assert model.model_dump(exclude_unset=True) == {field: None}

    def test_constraints_still_enforced_on_update(self) -> None:
        with pytest.raises(ValidationError):
            TemplateFieldUpdateRequest(name="1bad")
        with pytest.raises(ValidationError):
            TemplateFieldUpdateRequest(label="L" * 101)
        with pytest.raises(ValidationError):
            TemplateFieldUpdateRequest(sort_order=-1)
        with pytest.raises(ValidationError):
            TemplateFieldUpdateRequest(allowed_values=["a", "a"])
        with pytest.raises(ValidationError):
            TemplateFieldUpdateRequest(field_type="TEXT")


# =================== TemplateFieldMoveRequest ===================


class TestMoveRequest:
    def test_valid_move(self) -> None:
        model = TemplateFieldMoveRequest(entity_type_id=str(ENTITY_TYPE_ID), sort_order=4)
        assert model.entity_type_id == ENTITY_TYPE_ID
        assert model.sort_order == 4

    def test_both_fields_required(self) -> None:
        with pytest.raises(ValidationError):
            TemplateFieldMoveRequest(entity_type_id=str(ENTITY_TYPE_ID))
        with pytest.raises(ValidationError):
            TemplateFieldMoveRequest(sort_order=0)

    def test_negative_sort_order_rejected(self) -> None:
        with pytest.raises(ValidationError):
            TemplateFieldMoveRequest(entity_type_id=str(ENTITY_TYPE_ID), sort_order=-1)

    def test_extra_keys_are_rejected(self) -> None:
        with pytest.raises(ValidationError):
            TemplateFieldMoveRequest(
                entity_type_id=str(ENTITY_TYPE_ID), sort_order=0, name="sneaky"
            )


# =================== TemplateFieldReorderRequest ===================


class TestReorderRequest:
    def test_valid_batch(self) -> None:
        model = TemplateFieldReorderRequest(
            updates=[
                {"id": str(uuid4()), "sort_order": 0},
                {"id": str(uuid4()), "sort_order": 1},
            ]
        )
        assert len(model.updates) == 2
        assert all(isinstance(u, TemplateFieldSortOrderUpdate) for u in model.updates)

    def test_empty_batch_rejected(self) -> None:
        with pytest.raises(ValidationError):
            TemplateFieldReorderRequest(updates=[])

    def test_item_negative_sort_order_rejected(self) -> None:
        with pytest.raises(ValidationError):
            TemplateFieldReorderRequest(updates=[{"id": str(uuid4()), "sort_order": -1}])

    def test_duplicate_ids_pass_schema_validation(self) -> None:
        """Deliberate division of labor (panel 4): duplicate-id rejection and
        template-membership checks are the SERVICE's job — the schema stays a
        pure payload-shape gate (multi-section batches are legal)."""
        fid = str(uuid4())
        model = TemplateFieldReorderRequest(
            updates=[{"id": fid, "sort_order": 0}, {"id": fid, "sort_order": 1}]
        )
        assert len(model.updates) == 2


# =================== Response models ===================


class TestResponses:
    def test_field_read_from_orm_attributes(self) -> None:
        """``model_validate(orm_row)`` is the service's return path — pin the
        ``from_attributes`` round-trip on an ORM-shaped object."""
        row = SimpleNamespace(
            id=FIELD_ID,
            entity_type_id=ENTITY_TYPE_ID,
            name="field_example",
            label="Field Example",
            description=None,
            field_type="select",
            is_required=True,
            unit=None,
            allowed_units=["mg", "kg"],
            llm_description="Extract carefully",
            allowed_values=["a", "b"],
            allow_other=True,
            other_label="Other (specify)",
            other_placeholder=None,
            allows_not_applicable=False,
            allows_not_evaluated=True,
            validation_schema={},
            sort_order=2,
            created_at=datetime(2026, 8, 8, tzinfo=UTC),
        )
        model = TemplateFieldRead.model_validate(row)
        assert model.id == FIELD_ID
        assert model.entity_type_id == ENTITY_TYPE_ID
        assert model.field_type == "select"
        assert model.allowed_values == ["a", "b"]
        assert model.allowed_units == ["mg", "kg"]
        assert model.allows_not_evaluated is True
        assert model.sort_order == 2

    def test_field_read_rejects_unknown_field_type(self) -> None:
        with pytest.raises(ValidationError):
            TemplateFieldRead(
                id=FIELD_ID,
                entity_type_id=ENTITY_TYPE_ID,
                name="field_example",
                label="X",
                field_type="json",
                is_required=False,
                sort_order=0,
                created_at=datetime(2026, 8, 8, tzinfo=UTC),
            )

    def test_delete_response_shape(self) -> None:
        model = TemplateFieldDeleteResponse(id=FIELD_ID, deleted=True)
        assert model.id == FIELD_ID
        assert model.deleted is True

    def test_reorder_response_shape(self) -> None:
        assert TemplateFieldReorderResponse(updated_count=3).updated_count == 3


class TestNoInformationDefault:
    """``allows_no_information`` inverts its siblings' default (migration 0062).

    ``not_applicable`` / ``not_evaluated`` default False because they were
    always opt-in. ``no_information`` was UNIVERSAL before 0062, so an absent
    key — an old bundle, a pre-0062 snapshot, an update that omits it — means
    "the marker was available", i.e. ``True``. Copying the siblings' ``False``
    here would silently switch the marker off on every existing template.
    """

    def test_create_defaults_to_allowing_the_marker(self) -> None:
        assert make_create().allows_no_information is True

    def test_read_defaults_to_allowing_the_marker(self) -> None:
        row = SimpleNamespace(
            id=FIELD_ID,
            entity_type_id=ENTITY_TYPE_ID,
            name="field_example",
            label="X",
            description=None,
            field_type="text",
            is_required=False,
            unit=None,
            allowed_units=None,
            llm_description=None,
            allowed_values=None,
            allow_other=False,
            other_label=None,
            other_placeholder=None,
            is_entity_key=False,
            allows_not_applicable=False,
            allows_not_evaluated=False,
            validation_schema=None,
            sort_order=0,
            created_at=datetime(2026, 8, 8, tzinfo=UTC),
        )
        assert TemplateFieldRead.model_validate(row).allows_no_information is True

    def test_update_omitting_the_key_leaves_it_unset(self) -> None:
        update = TemplateFieldUpdateRequest(label="X")
        assert "allows_no_information" not in update.model_fields_set

    def test_update_can_turn_the_marker_off(self) -> None:
        update = TemplateFieldUpdateRequest(allows_no_information=False)
        assert update.allows_no_information is False
