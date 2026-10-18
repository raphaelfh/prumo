"""edit_template_draft section and instruction ops: add, update and delete
sections, set the template instruction, and the reply's lint and
destructive-change counts.

Every refusal asserts the code, one refused audit row and that nothing
changed (sections, fields and the lock roll back with the call)."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from httpx import AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.template_create_service import create_blank_template
from tests.integration.conftest import SEED, clean_project_clones, make_proposal, open_session
from tests.integration.helpers.template_fixtures import (
    ARTICLE_ID,
    add_field,
    add_instance,
    add_section,
    draft_lock_holder,
    entity_id,
    fresh_charms,
)
from tests.integration.helpers.template_fixtures import field_id as fixture_field_id
from tests.integration.mcp.tool_calls import call_tool, error_payload, structured


async def _edit(mcp_client, pat, project_id: UUID, template_id: UUID, ops, **extra: Any):
    return await call_tool(
        mcp_client,
        pat,
        "edit_template_draft",
        {"project_id": str(project_id), "template_id": str(template_id), "ops": ops, **extra},
    )


async def _fingerprint(mcp_client, pat, project_id: UUID, template_id: UUID) -> str:
    body = structured(
        await call_tool(
            mcp_client,
            pat,
            "get_template",
            {"project_id": str(project_id), "template_id": str(template_id), "view": "changes"},
        )
    )
    assert body["fingerprint"]
    return body["fingerprint"]


async def _audit_count(db: AsyncSession, *, outcome: str) -> int:
    return (
        await db.execute(
            text(
                "SELECT count(*) FROM public.agent_actions WHERE outcome = :o "
                "AND tool = 'edit_template_draft'"
            ),
            {"o": outcome},
        )
    ).scalar_one()


async def _structure(db: AsyncSession, template_id: UUID) -> frozenset[str]:
    """Sections (label, cardinality, entry label, parent) and fields under the template."""
    sections = (
        await db.execute(
            text(
                "SELECT id, label, cardinality, entry_label, parent_entity_type_id, description "
                "FROM public.extraction_entity_types WHERE project_template_id = :t"
            ),
            {"t": str(template_id)},
        )
    ).all()
    fields = (
        await db.execute(
            text(
                "SELECT f.id, f.label FROM public.extraction_fields f "
                "JOIN public.extraction_entity_types et ON et.id = f.entity_type_id "
                "WHERE et.project_template_id = :t"
            ),
            {"t": str(template_id)},
        )
    ).all()
    return frozenset(
        [
            f"s:{r.id}:{r.label}:{r.cardinality}:{r.entry_label}:{r.parent_entity_type_id}:"
            f"{r.description}"
            for r in sections
        ]
        + [f"f:{r.id}:{r.label}" for r in fields]
    )


async def _instruction(db: AsyncSession, template_id: UUID) -> str | None:
    return (
        await db.execute(
            text(
                "SELECT llm_template_instruction FROM public.project_extraction_templates "
                "WHERE id = :t"
            ),
            {"t": str(template_id)},
        )
    ).scalar_one()


async def _assert_refused(
    db: AsyncSession, template_id: UUID, before: frozenset[str], payload: dict[str, Any]
) -> None:
    assert payload["op_index"] == 0
    assert await _structure(db, template_id) == before
    assert await draft_lock_holder(db, template_id) is None
    assert await _audit_count(db, outcome="refused") == 1
    assert await _audit_count(db, outcome="applied") == 0


async def test_blank_template_built_by_tool_calls(
    mcp_client, pat_primary_rw, db_session: AsyncSession, db_client: AsyncClient, auth_as_profile
) -> None:
    assert auth_as_profile == SEED.primary_profile
    project_id = SEED.secondary_project
    await clean_project_clones(db_session, project_id)
    template_id = (
        await create_blank_template(
            db_session,
            project_id=project_id,
            name="Built by tools",
            description=None,
            framework="CUSTOM",
            user_id=SEED.primary_profile,
        )
    ).project_template_id

    first = structured(
        await _edit(
            mcp_client,
            pat_primary_rw,
            project_id,
            template_id,
            [
                {
                    "op": "add_section",
                    "label": "Prediction models",
                    "cardinality": "many",
                    "entry_label": "Model",
                    "description": "Each prediction model the article reports.",
                }
            ],
        )
    )
    [added] = first["applied"]
    assert added["op"] == "add_section"
    assert added["label"] == "Prediction models"
    assert added["cardinality"] == "many"
    section_id = added["section_id"]
    assert first["lint"] == {"block": 1, "warn": 1}  # no entity key yet; empty section

    second = structured(
        await _edit(
            mcp_client,
            pat_primary_rw,
            project_id,
            template_id,
            [
                {
                    "op": "add_question",
                    "section_id": section_id,
                    "label": "Model name",
                    "type": "text",
                    "instructions": "The name the article gives the model.",
                },
                {
                    "op": "add_question",
                    "section_id": section_id,
                    "label": "Model type",
                    "type": "select",
                    "options": [
                        {"value": "dev", "label": "Development"},
                        {"value": "val", "label": "Validation"},
                    ],
                    "instructions": "Whether the article develops or validates the model.",
                },
                {"op": "set_instruction", "instruction": "Extract only what the article reports."},
            ],
        )
    )
    assert second["applied"][2] == {"op_index": 2, "op": "set_instruction", "changed": True}
    key_field = second["applied"][0]["field_id"]

    third = structured(
        await _edit(
            mcp_client,
            pat_primary_rw,
            project_id,
            template_id,
            [{"op": "update_question", "field_id": key_field, "is_entity_key": True}],
        )
    )
    assert third["lint"] == {"block": 0, "warn": 0}
    assert third["destructive_changes"] == 0
    assert await _instruction(db_session, template_id) == "Extract only what the article reports."

    fingerprint = await _fingerprint(mcp_client, pat_primary_rw, project_id, template_id)
    res = await db_client.get(f"/api/v1/projects/{project_id}/templates/{template_id}/config-diff")
    assert res.status_code == 200, res.text
    assert fingerprint == res.json()["data"]["fingerprint"] == third["draft_fingerprint"]


async def test_add_section_under_a_repeating_parent_applies(
    mcp_client, pat_primary_rw, db_session: AsyncSession
) -> None:
    project_id, template_id, _schema = await fresh_charms(db_session)
    parent = await add_section(
        db_session, template_id, "models_group", cardinality="many", entry_label="Model"
    )
    body = structured(
        await _edit(
            mcp_client,
            pat_primary_rw,
            project_id,
            template_id,
            [
                {
                    "op": "add_section",
                    "label": "Per model detail",
                    "cardinality": "one",
                    "parent_section_id": str(parent),
                    "required": True,
                }
            ],
        )
    )
    section_id = body["applied"][0]["section_id"]
    row = (
        await db_session.execute(
            text(
                "SELECT name, parent_entity_type_id, is_required, entry_label "
                "FROM public.extraction_entity_types WHERE id = :id"
            ),
            {"id": section_id},
        )
    ).one()
    assert (row.name, row.parent_entity_type_id, row.is_required, row.entry_label) == (
        "per_model_detail",
        parent,
        True,
        None,
    )


async def test_add_section_derives_a_unique_name(
    mcp_client, pat_primary_rw, db_session: AsyncSession
) -> None:
    project_id, template_id, _schema = await fresh_charms(db_session)
    await add_section(db_session, template_id, "outcomes")
    body = structured(
        await _edit(
            mcp_client,
            pat_primary_rw,
            project_id,
            template_id,
            [{"op": "add_section", "label": "Outcomes", "cardinality": "one"}],
        )
    )
    name = (
        await db_session.execute(
            text("SELECT name FROM public.extraction_entity_types WHERE id = :id"),
            {"id": body["applied"][0]["section_id"]},
        )
    ).scalar_one()
    assert name == "outcomes_2"


async def test_update_section_applies_sent_keys_and_audits_before(
    mcp_client, pat_primary_rw, db_session: AsyncSession
) -> None:
    project_id, template_id, _schema = await fresh_charms(db_session)
    section = await add_section(db_session, template_id, "plain")
    body = structured(
        await _edit(
            mcp_client,
            pat_primary_rw,
            project_id,
            template_id,
            [
                {
                    "op": "update_section",
                    "section_id": str(section),
                    "label": "Arms",
                    "cardinality": "many",
                    "entry_label": "Arm",
                    "description": "Each study arm.",
                }
            ],
        )
    )
    assert body["applied"] == [
        {
            "op_index": 0,
            "op": "update_section",
            "section_id": str(section),
            "label": "Arms",
            "cardinality": "many",
        }
    ]
    row = (
        await db_session.execute(
            text(
                "SELECT before, after FROM public.agent_actions "
                "WHERE outcome = 'applied' AND tool = 'edit_template_draft'"
            )
        )
    ).one()
    assert row.before["ops"] == [
        {"label": "plain", "cardinality": "one", "entry_label": None, "description": None}
    ]
    assert row.after["ops"][0]["entry_label"] == "Arm"


async def test_update_section_without_changes_is_invalid_argument(
    mcp_client, pat_primary_rw, db_session: AsyncSession
) -> None:
    project_id, template_id, _schema = await fresh_charms(db_session)
    section = await add_section(db_session, template_id, "plain")
    before = await _structure(db_session, template_id)
    payload = error_payload(
        await _edit(
            mcp_client,
            pat_primary_rw,
            project_id,
            template_id,
            [{"op": "update_section", "section_id": str(section)}],
        )
    )
    assert payload["code"] == "INVALID_ARGUMENT"
    assert payload["message"] == "name at least one field to change"
    await _assert_refused(db_session, template_id, before, payload)


async def test_cardinality_many_to_one_with_entries_is_in_use(
    mcp_client, pat_primary_rw, db_session: AsyncSession
) -> None:
    project_id, template_id, _schema = await fresh_charms(db_session)
    section = await add_section(
        db_session, template_id, "arms", cardinality="many", entry_label="Arm"
    )
    for _ in range(2):
        await add_instance(
            db_session, project_id=project_id, template_id=template_id, entity_type_id=section
        )
    before = await _structure(db_session, template_id)
    payload = error_payload(
        await _edit(
            mcp_client,
            pat_primary_rw,
            project_id,
            template_id,
            [{"op": "update_section", "section_id": str(section), "cardinality": "one"}],
        )
    )
    assert payload["code"] == "IN_USE"
    assert payload["retryable"] is False
    await _assert_refused(db_session, template_id, before, payload)


async def test_update_to_one_while_owning_children_is_structure_conflict(
    mcp_client, pat_primary_rw, db_session: AsyncSession
) -> None:
    project_id, template_id, _schema = await fresh_charms(db_session)
    parent = await add_section(
        db_session, template_id, "arms", cardinality="many", entry_label="Arm"
    )
    await add_section(db_session, template_id, "arm_detail", parent_id=parent)
    before = await _structure(db_session, template_id)
    payload = error_payload(
        await _edit(
            mcp_client,
            pat_primary_rw,
            project_id,
            template_id,
            [{"op": "update_section", "section_id": str(parent), "cardinality": "one"}],
        )
    )
    assert payload["code"] == "STRUCTURE_CONFLICT"
    assert payload["rule"] == "section_owns_children"
    await _assert_refused(db_session, template_id, before, payload)


async def test_delete_section_requires_fingerprint(
    mcp_client, pat_primary_rw, db_session: AsyncSession
) -> None:
    project_id, template_id, _schema = await fresh_charms(db_session)
    section = await add_section(db_session, template_id, "doomed")
    before = await _structure(db_session, template_id)
    payload = error_payload(
        await _edit(
            mcp_client,
            pat_primary_rw,
            project_id,
            template_id,
            [{"op": "delete_section", "section_id": str(section)}],
        )
    )
    assert payload["code"] == "INVALID_ARGUMENT"
    assert payload["field"] == "expected_fingerprint"
    assert await _structure(db_session, template_id) == before
    assert await _audit_count(db_session, outcome="refused") == 1


async def test_delete_section_applies_with_fingerprint(
    mcp_client, pat_primary_rw, db_session: AsyncSession
) -> None:
    project_id, template_id, _schema = await fresh_charms(db_session)
    section = await add_section(db_session, template_id, "doomed")
    await add_field(db_session, section, "doomed_q")
    fp = await _fingerprint(mcp_client, pat_primary_rw, project_id, template_id)
    body = structured(
        await _edit(
            mcp_client,
            pat_primary_rw,
            project_id,
            template_id,
            [{"op": "delete_section", "section_id": str(section)}],
            expected_fingerprint=fp,
        )
    )
    assert body["applied"] == [
        {
            "op_index": 0,
            "op": "delete_section",
            "section_id": str(section),
            "label": None,
            "cardinality": None,
        }
    ]
    assert not any(s.startswith(f"s:{section}:") for s in await _structure(db_session, template_id))
    row = (
        await db_session.execute(
            text(
                "SELECT before FROM public.agent_actions "
                "WHERE outcome = 'applied' AND tool = 'edit_template_draft'"
            )
        )
    ).one()
    assert row.before["ops"] == [
        {"section_id": str(section), "label": "doomed", "cardinality": "one"}
    ]


async def test_delete_section_owning_children_is_structure_conflict(
    mcp_client, pat_primary_rw, db_session: AsyncSession
) -> None:
    project_id, template_id, _schema = await fresh_charms(db_session)
    parent = await add_section(
        db_session, template_id, "arms", cardinality="many", entry_label="Arm"
    )
    await add_section(db_session, template_id, "arm_detail", parent_id=parent)
    fp = await _fingerprint(mcp_client, pat_primary_rw, project_id, template_id)
    before = await _structure(db_session, template_id)
    payload = error_payload(
        await _edit(
            mcp_client,
            pat_primary_rw,
            project_id,
            template_id,
            [{"op": "delete_section", "section_id": str(parent)}],
            expected_fingerprint=fp,
        )
    )
    assert payload["code"] == "STRUCTURE_CONFLICT"
    assert payload["rule"] == "section_owns_children"
    await _assert_refused(db_session, template_id, before, payload)


async def test_delete_section_with_recorded_values_is_in_use(
    mcp_client, pat_primary_rw, db_session: AsyncSession
) -> None:
    project_id, template_id, _schema = await fresh_charms(db_session)
    owner = await entity_id(db_session, template_id, "sample_size")
    target = await fixture_field_id(
        db_session, template_id, "sample_size", "number_of_participants"
    )
    session = await open_session(
        db_session,
        project_id=project_id,
        article_id=ARTICLE_ID,
        template_id=template_id,
        user_id=SEED.primary_profile,
    )
    await make_proposal(
        db_session,
        run_id=session.run_id,
        instance_id=UUID(session.instances_by_entity_type[str(owner)]),
        field_id=target,
        user_id=SEED.primary_profile,
    )
    fp = await _fingerprint(mcp_client, pat_primary_rw, project_id, template_id)
    before = await _structure(db_session, template_id)
    payload = error_payload(
        await _edit(
            mcp_client,
            pat_primary_rw,
            project_id,
            template_id,
            [{"op": "delete_section", "section_id": str(owner)}],
            expected_fingerprint=fp,
        )
    )
    assert payload["code"] == "IN_USE"
    assert payload["retryable"] is False
    await _assert_refused(db_session, template_id, before, payload)


async def test_add_section_under_single_parent_is_structure_conflict(
    mcp_client, pat_primary_rw, db_session: AsyncSession
) -> None:
    project_id, template_id, _schema = await fresh_charms(db_session)
    single = await add_section(db_session, template_id, "single")
    before = await _structure(db_session, template_id)
    payload = error_payload(
        await _edit(
            mcp_client,
            pat_primary_rw,
            project_id,
            template_id,
            [
                {
                    "op": "add_section",
                    "label": "Child",
                    "cardinality": "one",
                    "parent_section_id": str(single),
                }
            ],
        )
    )
    assert payload["code"] == "STRUCTURE_CONFLICT"
    assert payload["rule"] == "section_parent_must_repeat"
    await _assert_refused(db_session, template_id, before, payload)


async def test_entry_label_on_single_section_is_structure_conflict(
    mcp_client, pat_primary_rw, db_session: AsyncSession
) -> None:
    project_id, template_id, _schema = await fresh_charms(db_session)
    single = await add_section(db_session, template_id, "single")
    before = await _structure(db_session, template_id)
    cases = [
        {"op": "add_section", "label": "Once", "cardinality": "one", "entry_label": "Entry"},
        {"op": "add_section", "label": "Repeats", "cardinality": "many"},
        {"op": "update_section", "section_id": str(single), "entry_label": "Entry"},
    ]
    for count, op in enumerate(cases, start=1):
        payload = error_payload(
            await _edit(mcp_client, pat_primary_rw, project_id, template_id, [op])
        )
        assert payload["code"] == "STRUCTURE_CONFLICT", op
        assert payload["rule"] == "section_entry_label_cardinality", op
        assert payload["op_index"] == 0
        assert await _structure(db_session, template_id) == before
        assert await _audit_count(db_session, outcome="refused") == count


async def test_set_instruction_while_other_manager_holds_lock(
    mcp_client, pat_primary_rw, db_session: AsyncSession
) -> None:
    project_id, template_id, _schema = await fresh_charms(db_session)
    await db_session.execute(
        text("UPDATE public.project_extraction_templates SET config_draft_by = :r WHERE id = :t"),
        {"r": str(SEED.reviewer_profile), "t": str(template_id)},
    )
    await db_session.flush()
    old = await _instruction(db_session, template_id)
    payload = error_payload(
        await _edit(
            mcp_client,
            pat_primary_rw,
            project_id,
            template_id,
            [{"op": "set_instruction", "instruction": "New instruction"}],
        )
    )
    assert payload["code"] == "DRAFT_LOCK_HELD"
    assert await _instruction(db_session, template_id) == old
    assert await draft_lock_holder(db_session, template_id) == SEED.reviewer_profile
    assert await _audit_count(db_session, outcome="refused") == 1


async def test_set_instruction_reports_changed(
    mcp_client, pat_primary_rw, db_session: AsyncSession
) -> None:
    project_id, template_id, _schema = await fresh_charms(db_session)
    long_text = "Report only what the article states. " * 100
    body = structured(
        await _edit(
            mcp_client,
            pat_primary_rw,
            project_id,
            template_id,
            [
                {"op": "set_instruction", "instruction": long_text},
                {"op": "set_instruction", "instruction": f"  {long_text}  "},
                {"op": "set_instruction", "instruction": "   "},
                {"op": "set_instruction", "instruction": None},
            ],
        )
    )
    assert [a["changed"] for a in body["applied"]] == [True, False, True, False]
    assert all(set(a) == {"op_index", "op", "changed"} for a in body["applied"])
    assert await _instruction(db_session, template_id) is None


async def test_destructive_changes_count(
    mcp_client, pat_primary_rw, db_session: AsyncSession
) -> None:
    project_id, template_id, schema = await fresh_charms(db_session)
    published = next(et for et in schema["entity_types"] if et.get("fields"))
    fp = await _fingerprint(mcp_client, pat_primary_rw, project_id, template_id)
    body = structured(
        await _edit(
            mcp_client,
            pat_primary_rw,
            project_id,
            template_id,
            [{"op": "delete_question", "field_id": published["fields"][0]["id"]}],
            expected_fingerprint=fp,
        )
    )
    assert body["destructive_changes"] >= 1
    assert set(body["lint"]) == {"block", "warn"}


async def test_one_applied_row_covers_section_ops(
    mcp_client, pat_primary_rw, db_session: AsyncSession
) -> None:
    project_id, template_id, _schema = await fresh_charms(db_session)
    doomed = await add_section(db_session, template_id, "doomed")
    renamed = await add_section(db_session, template_id, "renamed")
    fp = await _fingerprint(mcp_client, pat_primary_rw, project_id, template_id)
    body = structured(
        await _edit(
            mcp_client,
            pat_primary_rw,
            project_id,
            template_id,
            [
                {"op": "add_section", "label": "Fresh", "cardinality": "one"},
                {"op": "update_section", "section_id": str(renamed), "label": "Renamed"},
                {"op": "delete_section", "section_id": str(doomed)},
                {"op": "set_instruction", "instruction": "Be precise."},
            ],
            expected_fingerprint=fp,
        )
    )
    expected = ["add_section", "update_section", "delete_section", "set_instruction"]
    assert [a["op"] for a in body["applied"]] == expected
    row = (
        await db_session.execute(
            text(
                "SELECT before, after FROM public.agent_actions "
                "WHERE outcome = 'applied' AND tool = 'edit_template_draft'"
            )
        )
    ).one()
    assert [op["op"] for op in row.after["ops"]] == expected
    assert row.after["ops"][3]["changed"] is True
    assert row.before["ops"][1] == {"label": "renamed"}
    assert row.before["ops"][2]["section_id"] == str(doomed)
