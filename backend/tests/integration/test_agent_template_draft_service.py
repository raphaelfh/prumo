"""Integration tests for the questionnaire-draft service (spec §5.2, task 10a).

Both ops write through ``template_field_service``, so these tests verify the
op -> column mapping, name derivation, sort_order and baseline isolation, not
the create/update mechanics already covered by the field-service suites.
"""

from uuid import uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.schemas.mcp_template_draft import AddQuestionOp, UpdateQuestionOp
from app.services.agent_template_draft_service import (
    AppliedDraftOp,
    DraftOpError,
    NarrowBaselineError,
    apply_draft_ops,
    assert_isolated_baseline,
)
from app.services.template_field_service import FieldNotFoundError
from app.services.template_section_service import SectionNotFoundError
from app.services.template_version_read_service import NoActiveTemplateVersionError
from tests.integration.conftest import SEED
from tests.integration.helpers.template_fixtures import (
    add_field,
    force_narrow_baseline,
    fresh_charms,
)


@pytest.mark.asyncio
async def test_baseline_wide_passes(db_session: AsyncSession) -> None:
    _project_id, template_id, _schema = await fresh_charms(db_session)
    await assert_isolated_baseline(db_session, template_id=template_id)


@pytest.mark.asyncio
async def test_baseline_narrow_refused_for_seeded_primary_template(
    db_session: AsyncSession,
) -> None:
    with pytest.raises(NarrowBaselineError):
        await assert_isolated_baseline(db_session, template_id=SEED.primary_template)


@pytest.mark.asyncio
async def test_baseline_narrow_refused_after_forcing_narrow(db_session: AsyncSession) -> None:
    _project_id, template_id, schema = await fresh_charms(db_session)
    section_id = schema["entity_types"][0]["id"]
    await force_narrow_baseline(db_session, template_id, section_id)
    with pytest.raises(NarrowBaselineError):
        await assert_isolated_baseline(db_session, template_id=template_id)


@pytest.mark.asyncio
async def test_baseline_missing_refused(db_session: AsyncSession) -> None:
    # 0004's active-version invariant is a DEFERRED constraint trigger, so
    # this UPDATE is legal inside the never-committed test transaction.
    await db_session.execute(
        text(
            "UPDATE public.extraction_template_versions SET is_active = false "
            "WHERE project_template_id = :tid"
        ),
        {"tid": str(SEED.primary_template)},
    )
    await db_session.flush()
    with pytest.raises(NoActiveTemplateVersionError):
        await assert_isolated_baseline(db_session, template_id=SEED.primary_template)


@pytest.mark.asyncio
async def test_add_question_maps_columns_and_sort_order(db_session: AsyncSession) -> None:
    project_id, template_id, schema = await fresh_charms(db_session)
    entity_types = schema["entity_types"]
    section_with_fields = next(et for et in entity_types if et.get("fields"))
    section_id = section_with_fields["id"]
    current_max = (
        await db_session.execute(
            text(
                "SELECT COALESCE(MAX(sort_order), -1) FROM public.extraction_fields "
                "WHERE entity_type_id = :sid"
            ),
            {"sid": section_id},
        )
    ).scalar_one()

    op = AddQuestionOp(
        op="add_question",
        section_id=section_id,
        label="Follow-up (months)",
        type="select",
        options=["6", "12"],
        instructions="Longest follow-up",
    )
    applied = await apply_draft_ops(
        db_session, project_id=project_id, template_id=template_id, ops=[op]
    )

    assert len(applied) == 1
    result = applied[0]
    assert isinstance(result, AppliedDraftOp)
    assert result.op_index == 0
    assert result.op == "add_question"
    assert result.before is None
    field = result.field
    assert str(field.entity_type_id) == str(section_id)
    assert field.name == "follow_up_months"
    assert field.label == "Follow-up (months)"
    assert field.field_type == "select"
    assert field.allowed_values == ["6", "12"]
    assert field.llm_description == "Longest follow-up"
    assert field.sort_order == current_max + 1

    # A section with no fields gets sort_order = 0.
    empty_section = next((et for et in entity_types if not et.get("fields")), None)
    if empty_section is not None:
        op2 = AddQuestionOp(
            op="add_question", section_id=empty_section["id"], label="New Q", type="text"
        )
        applied2 = await apply_draft_ops(
            db_session, project_id=project_id, template_id=template_id, ops=[op2]
        )
        assert applied2[0].field.sort_order == 0


@pytest.mark.asyncio
async def test_same_label_suffixes_within_batch(db_session: AsyncSession) -> None:
    # "Age"/"age" mirrors the brief's own naming-unit-test collision pattern
    # (derive_field_name("Age", {"age"}) == "age_2"); a literal 1-char base
    # ("x") always pads to "x_field" per Step 1/slug.ts and can never collide
    # directly with a pre-existing "x" row, so it cannot exercise this path.
    project_id, template_id, schema = await fresh_charms(db_session)
    section_id = schema["entity_types"][0]["id"]
    await add_field(db_session, section_id, "age")

    ops = [
        AddQuestionOp(op="add_question", section_id=section_id, label="Age", type="text"),
        AddQuestionOp(op="add_question", section_id=section_id, label="Age", type="text"),
    ]
    applied = await apply_draft_ops(
        db_session, project_id=project_id, template_id=template_id, ops=ops
    )

    assert applied[0].field.name == "age_2"
    assert applied[1].field.name == "age_3"


@pytest.mark.asyncio
async def test_update_question_changes_only_sent_keys_and_reports_before(
    db_session: AsyncSession,
) -> None:
    project_id, template_id, schema = await fresh_charms(db_session)
    section = next(et for et in schema["entity_types"] if et.get("fields"))
    section_id = section["id"]
    field_id = await add_field(db_session, section_id, "existing_field")
    old_label = "existing_field"

    op = UpdateQuestionOp(
        op="update_question", field_id=field_id, label="Reworded", instructions=None
    )
    applied = await apply_draft_ops(
        db_session, project_id=project_id, template_id=template_id, ops=[op]
    )

    result = applied[0]
    assert result.op == "update_question"
    assert result.field.label == "Reworded"
    assert result.field.llm_description is None
    assert result.before == {"label": old_label, "instructions": None}

    row = (
        await db_session.execute(
            text(
                "SELECT description, name, field_type, allowed_values FROM public.extraction_fields WHERE id = :id"
            ),
            {"id": str(field_id)},
        )
    ).one()
    assert row.description is None
    assert row.name == "existing_field"
    assert row.field_type == "text"
    assert row.allowed_values is None


@pytest.mark.asyncio
async def test_foreign_ids_raise_draft_op_error_with_index(db_session: AsyncSession) -> None:
    project_id, template_id, schema = await fresh_charms(db_session)
    section_id = schema["entity_types"][0]["id"]

    valid_add = AddQuestionOp(
        op="add_question", section_id=section_id, label="Valid Q", type="text"
    )
    foreign_update = UpdateQuestionOp(
        op="update_question", field_id=SEED.primary_field, label="Hijack"
    )
    with pytest.raises(DraftOpError) as exc_info:
        await apply_draft_ops(
            db_session,
            project_id=project_id,
            template_id=template_id,
            ops=[valid_add, foreign_update],
        )
    assert exc_info.value.op_index == 1
    assert isinstance(exc_info.value.cause, FieldNotFoundError)

    foreign_section_add = AddQuestionOp(
        op="add_question", section_id=uuid4(), label="Nope", type="text"
    )
    with pytest.raises(DraftOpError) as exc_info2:
        await apply_draft_ops(
            db_session, project_id=project_id, template_id=template_id, ops=[foreign_section_add]
        )
    assert isinstance(exc_info2.value.cause, SectionNotFoundError)
