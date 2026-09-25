"""edit_template_draft (spec §5.2, §7): check order, lock, audit, race tests.

Every negative case asserts three things together: the error code, "no
structure rows" (field count + label set under the template unchanged), and
"lock not claimed" (``draft_lock_holder`` unchanged) — the tool's transaction
must roll back atomically on every refusal.
"""

from __future__ import annotations

import asyncio
from typing import Any
from uuid import UUID, uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.mcp import session as mcp_session
from app.api.mcp.tools import template_draft as template_draft_tool
from app.schemas.personal_access_token import PersonalAccessTokenCreateRequest
from app.services import template_field_naming, template_field_service
from app.services.pat_service import create_token, resolve_principal
from tests.integration.conftest import SEED, clean_project_clones
from tests.integration.helpers.template_fixtures import (
    ARTICLE_ID,
    add_field,
    draft_lock_holder,
    fresh_charms,
)
from tests.integration.mcp.conftest import SeededPat
from tests.integration.mcp.tool_calls import call_tool, error_payload, structured


class _Pg(Exception):
    sqlstate = "40P01"


def _section_and_field(schema: dict[str, Any]) -> tuple[str, str]:
    section = next(et for et in schema["entity_types"] if et.get("fields"))
    return section["id"], section["fields"][0]["id"]


def _label_of(schema: dict[str, Any], section_id: str, field_id: str) -> str:
    section = next(et for et in schema["entity_types"] if et["id"] == section_id)
    return next(f["label"] for f in section["fields"] if f["id"] == field_id)


async def _label_set(db: AsyncSession, template_id: UUID) -> frozenset[str]:
    rows = (
        await db.execute(
            text(
                "SELECT f.id, f.label FROM public.extraction_fields f "
                "JOIN public.extraction_entity_types et ON et.id = f.entity_type_id "
                "WHERE et.project_template_id = :tid"
            ),
            {"tid": str(template_id)},
        )
    ).all()
    return frozenset(f"{row.id}:{row.label}" for row in rows)


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


async def test_success_returns_unpublished_draft(
    mcp_client, pat_primary_rw, db_session: AsyncSession
) -> None:
    project_id, template_id, schema = await fresh_charms(db_session)
    section_id, field_id = _section_and_field(schema)
    old_label = _label_of(schema, section_id, field_id)

    ops = [
        {
            "op": "add_question",
            "section_id": section_id,
            "label": "Follow-up (months)",
            "type": "select",
            "options": ["6", "12"],
        },
        {"op": "update_question", "field_id": field_id, "label": "Reworded"},
    ]
    result = await call_tool(
        mcp_client,
        pat_primary_rw,
        "edit_template_draft",
        {"project_id": str(project_id), "template_id": str(template_id), "ops": ops},
    )
    body = structured(result)
    assert body["status"] == "draft_saved_unpublished"
    assert body["visible_to_reviewers_and_ai"] is False
    assert len(body["applied"]) == 2
    assert [a["op_index"] for a in body["applied"]] == [0, 1]
    assert body["applied"][0]["name"] == "follow_up_months"
    assert body["diff"]["status"] == "available"
    assert (
        body["editor_path"] == f"/projects/{project_id}?tab=extraction&extractionTab=configuration"
    )
    assert "Publish" in body["next_step"]

    row = (
        await db_session.execute(
            text(
                "SELECT before, after FROM public.agent_actions "
                "WHERE outcome = 'applied' AND tool = 'edit_template_draft' "
                "ORDER BY created_at DESC LIMIT 1"
            )
        )
    ).one()
    assert len(row.after["ops"]) == 2
    assert row.before["ops"] == [None, {"label": old_label}]


async def test_add_question_mapping(mcp_client, pat_primary_rw, db_session: AsyncSession) -> None:
    project_id, template_id, schema = await fresh_charms(db_session)
    section_id, _field_id = _section_and_field(schema)
    max_sort_order = (
        await db_session.execute(
            text(
                "SELECT COALESCE(MAX(sort_order), -1) FROM public.extraction_fields "
                "WHERE entity_type_id = :sid"
            ),
            {"sid": section_id},
        )
    ).scalar_one()

    ops = [
        {
            "op": "add_question",
            "section_id": section_id,
            "label": "Mapped Q",
            "type": "select",
            "options": ["a", "b"],
            "instructions": "Some hint",
        }
    ]
    result = await call_tool(
        mcp_client,
        pat_primary_rw,
        "edit_template_draft",
        {"project_id": str(project_id), "template_id": str(template_id), "ops": ops},
    )
    body = structured(result)
    field_id = body["applied"][0]["field_id"]
    row = (
        await db_session.execute(
            text(
                "SELECT entity_type_id, allowed_values, llm_description, sort_order "
                "FROM public.extraction_fields WHERE id = :id"
            ),
            {"id": field_id},
        )
    ).one()
    assert str(row.entity_type_id) == section_id
    assert row.allowed_values == ["a", "b"]
    assert row.llm_description == "Some hint"
    assert row.sort_order == max_sort_order + 1


async def test_derived_name_collision_suffixes(
    mcp_client, pat_primary_rw, db_session: AsyncSession
) -> None:
    project_id, template_id, schema = await fresh_charms(db_session)
    section_id, _field_id = _section_and_field(schema)
    await add_field(db_session, UUID(section_id), "age")
    await db_session.commit()

    ops = [
        {"op": "add_question", "section_id": section_id, "label": "Age", "type": "text"},
        {"op": "add_question", "section_id": section_id, "label": "Age", "type": "text"},
    ]
    result = await call_tool(
        mcp_client,
        pat_primary_rw,
        "edit_template_draft",
        {"project_id": str(project_id), "template_id": str(template_id), "ops": ops},
    )
    body = structured(result)
    assert [a["name"] for a in body["applied"]] == ["age_2", "age_3"]


async def test_lock_retained_after_success(
    mcp_client, pat_primary_rw, db_session: AsyncSession
) -> None:
    project_id, template_id, schema = await fresh_charms(db_session)
    section_id, _field_id = _section_and_field(schema)
    ops = [{"op": "add_question", "section_id": section_id, "label": "Q", "type": "text"}]
    await call_tool(
        mcp_client,
        pat_primary_rw,
        "edit_template_draft",
        {"project_id": str(project_id), "template_id": str(template_id), "ops": ops},
    )
    assert await draft_lock_holder(db_session, template_id) == SEED.primary_profile


async def test_draft_lock_held(mcp_client, pat_primary_rw, db_session: AsyncSession) -> None:
    project_id, template_id, schema = await fresh_charms(db_session)
    section_id, _field_id = _section_and_field(schema)
    before = await _label_set(db_session, template_id)
    await db_session.execute(
        text("UPDATE public.project_extraction_templates SET config_draft_by = :r WHERE id = :t"),
        {"r": str(SEED.reviewer_profile), "t": str(template_id)},
    )
    await db_session.flush()

    ops = [{"op": "add_question", "section_id": section_id, "label": "Q", "type": "text"}]
    result = await call_tool(
        mcp_client,
        pat_primary_rw,
        "edit_template_draft",
        {"project_id": str(project_id), "template_id": str(template_id), "ops": ops},
    )
    payload = error_payload(result)
    assert payload["code"] == "DRAFT_LOCK_HELD"
    assert payload["holder_name"] == "Integration Reviewer"
    assert await draft_lock_holder(db_session, template_id) == SEED.reviewer_profile
    assert await _label_set(db_session, template_id) == before
    assert await _audit_count(db_session, outcome="refused") == 1


@pytest.mark.parametrize(
    "extra_op",
    [
        {"op": "delete_question"},
        {"op": "move_question"},
        {"op": "add_section"},
        {"op": "update_question", "type": "number"},
        {"op": "update_question", "options": ["a"]},
    ],
    ids=["delete_question", "move_question", "add_section", "update_type", "update_options"],
)
async def test_disallowed_op_refused(
    mcp_client, pat_primary_rw, db_session: AsyncSession, extra_op: dict[str, Any]
) -> None:
    project_id, template_id, schema = await fresh_charms(db_session)
    section_id, field_id = _section_and_field(schema)
    before = await _label_set(db_session, template_id)

    bad = dict(extra_op)
    if bad["op"] == "update_question":
        bad["field_id"] = field_id
    ops = [
        {"op": "add_question", "section_id": section_id, "label": "Q0", "type": "text"},
        bad,
    ]
    result = await call_tool(
        mcp_client,
        pat_primary_rw,
        "edit_template_draft",
        {"project_id": str(project_id), "template_id": str(template_id), "ops": ops},
    )
    payload = error_payload(result)
    assert payload["code"] == "OP_NOT_ALLOWED_VIA_AGENT"
    assert payload["op_index"] == 1
    assert await _label_set(db_session, template_id) == before
    assert await draft_lock_holder(db_session, template_id) is None
    assert await _audit_count(db_session, outcome="refused") == 1


async def test_ops_cap_25(mcp_client, pat_primary_rw, db_session: AsyncSession) -> None:
    project_id, template_id, schema = await fresh_charms(db_session)
    section_id, _field_id = _section_and_field(schema)
    before = await _label_set(db_session, template_id)
    ops = [
        {"op": "add_question", "section_id": section_id, "label": f"Q{i}", "type": "text"}
        for i in range(26)
    ]
    result = await call_tool(
        mcp_client,
        pat_primary_rw,
        "edit_template_draft",
        {"project_id": str(project_id), "template_id": str(template_id), "ops": ops},
    )
    payload = error_payload(result)
    assert payload["code"] == "TOO_MANY_OPS"
    assert await _label_set(db_session, template_id) == before
    assert await draft_lock_holder(db_session, template_id) is None
    assert await _audit_count(db_session, outcome="refused") == 1


@pytest.mark.parametrize(
    "use_random_template",
    [False, True],
    ids=["foreign-template", "random-template"],
)
async def test_foreign_template_with_too_many_ops_is_not_found(
    mcp_client,
    pat_primary_rw,
    db_session: AsyncSession,
    use_random_template: bool,
) -> None:
    _secondary_project_id, template_id, _schema = await fresh_charms(db_session)
    if use_random_template:
        template_id = uuid4()
    before = (
        await db_session.execute(text("SELECT count(*) FROM public.agent_actions"))
    ).scalar_one()
    ops = [
        {"op": "add_question", "section_id": str(uuid4()), "label": f"Q{i}", "type": "text"}
        for i in range(30)
    ]
    result = await call_tool(
        mcp_client,
        pat_primary_rw,
        "edit_template_draft",
        {
            "project_id": str(SEED.primary_project),
            "template_id": str(template_id),
            "ops": ops,
        },
    )
    assert error_payload(result)["code"] == "NOT_FOUND"
    after = (
        await db_session.execute(text("SELECT count(*) FROM public.agent_actions"))
    ).scalar_one()
    assert after == before


@pytest.mark.parametrize(
    ("op_builder", "field"),
    [
        (
            lambda section_id, _field_id: {
                "op": "add_question",
                "section_id": section_id,
                "label": "x" * 101,
                "type": "text",
            },
            "label",
        ),
        (
            lambda section_id, _field_id: {
                "op": "add_question",
                "section_id": section_id,
                "label": "Q",
                "type": "text",
                "options": ["a"],
            },
            "options",
        ),
        (
            lambda section_id, _field_id: {
                "op": "add_question",
                "section_id": section_id,
                "label": "Q",
                "type": "select",
            },
            "options",
        ),
        (
            lambda section_id, _field_id: {
                "op": "add_question",
                "section_id": section_id,
                "label": "Q",
                "type": "rating",
            },
            "type",
        ),
        (
            lambda _section_id, field_id: {
                "op": "update_question",
                "field_id": field_id,
                "label": None,
            },
            "label",
        ),
    ],
    ids=["label_too_long", "options_not_allowed", "options_missing", "bad_type", "null_label"],
)
async def test_invalid_argument_carries_op_index(
    mcp_client, pat_primary_rw, db_session: AsyncSession, op_builder: Any, field: str
) -> None:
    project_id, template_id, schema = await fresh_charms(db_session)
    section_id, field_id = _section_and_field(schema)
    before = await _label_set(db_session, template_id)
    filler = [
        {"op": "add_question", "section_id": section_id, "label": f"Filler{i}", "type": "text"}
        for i in range(2)
    ]
    bad_op = op_builder(section_id, field_id)
    ops = [
        *filler,
        bad_op,
        {"op": "add_question", "section_id": section_id, "label": "After", "type": "text"},
    ]

    result = await call_tool(
        mcp_client,
        pat_primary_rw,
        "edit_template_draft",
        {"project_id": str(project_id), "template_id": str(template_id), "ops": ops},
    )
    payload = error_payload(result)
    assert payload["code"] == "INVALID_ARGUMENT"
    assert payload["retryable"] is False
    assert payload["op_index"] == 2
    assert payload["field"] == field
    assert await _label_set(db_session, template_id) == before
    assert await draft_lock_holder(db_session, template_id) is None
    assert await _audit_count(db_session, outcome="refused") == 1


async def test_empty_ops_invalid(mcp_client, pat_primary_rw, db_session: AsyncSession) -> None:
    project_id, template_id, _schema = await fresh_charms(db_session)
    result = await call_tool(
        mcp_client,
        pat_primary_rw,
        "edit_template_draft",
        {"project_id": str(project_id), "template_id": str(template_id), "ops": []},
    )
    payload = error_payload(result)
    assert payload["code"] == "INVALID_ARGUMENT"
    assert payload["field"] == "ops"
    assert await _audit_count(db_session, outcome="refused") == 1


async def test_no_published_version_refused(
    mcp_client, pat_primary_rw, db_session: AsyncSession
) -> None:
    project_id, template_id, schema = await fresh_charms(db_session)
    section_id, _field_id = _section_and_field(schema)
    before = await _label_set(db_session, template_id)
    await db_session.execute(
        text(
            "UPDATE public.extraction_template_versions SET is_active = false "
            "WHERE project_template_id = :t"
        ),
        {"t": str(template_id)},
    )
    await db_session.flush()

    ops = [{"op": "add_question", "section_id": section_id, "label": "Q", "type": "text"}]
    result = await call_tool(
        mcp_client,
        pat_primary_rw,
        "edit_template_draft",
        {"project_id": str(project_id), "template_id": str(template_id), "ops": ops},
    )
    payload = error_payload(result)
    assert payload["code"] == "NO_PUBLISHED_VERSION"
    assert payload["retryable"] is False
    assert await _label_set(db_session, template_id) == before
    assert await draft_lock_holder(db_session, template_id) is None
    assert await _audit_count(db_session, outcome="refused") == 1


async def test_narrow_baseline_refused(
    mcp_client, pat_primary_rw, db_session: AsyncSession
) -> None:
    before = await _label_set(db_session, SEED.primary_template)
    ops = [
        {
            "op": "add_question",
            "section_id": str(SEED.primary_entity_type),
            "label": "Q",
            "type": "text",
        },
        {"op": "update_question", "field_id": str(SEED.primary_field), "label": "New label"},
    ]
    result = await call_tool(
        mcp_client,
        pat_primary_rw,
        "edit_template_draft",
        {
            "project_id": str(SEED.primary_project),
            "template_id": str(SEED.primary_template),
            "ops": ops,
        },
    )
    payload = error_payload(result)
    assert payload["code"] == "NARROW_BASELINE"
    assert await _label_set(db_session, SEED.primary_template) == before
    assert await draft_lock_holder(db_session, SEED.primary_template) is None
    assert (
        await db_session.execute(
            text(
                "SELECT count(*) FROM public.agent_actions WHERE outcome = 'refused' "
                "AND tool = 'edit_template_draft' AND template_id = :t"
            ),
            {"t": str(SEED.primary_template)},
        )
    ).scalar_one() == 1


async def test_row_guard_not_found_has_op_index_and_no_row(
    mcp_client, pat_primary_rw, db_session: AsyncSession
) -> None:
    project_id, template_id, schema = await fresh_charms(db_session)
    section_id, _field_id = _section_and_field(schema)
    before_fields = await _label_set(db_session, template_id)
    before_count = (
        await db_session.execute(text("SELECT count(*) FROM public.agent_actions"))
    ).scalar_one()

    ops = [
        {"op": "add_question", "section_id": section_id, "label": "Ok Q", "type": "text"},
        {
            "op": "update_question",
            "field_id": str(SEED.primary_field),
            "label": "Hijack",
        },
    ]
    result = await call_tool(
        mcp_client,
        pat_primary_rw,
        "edit_template_draft",
        {"project_id": str(project_id), "template_id": str(template_id), "ops": ops},
    )
    payload = error_payload(result)
    assert payload["code"] == "NOT_FOUND"
    assert payload["op_index"] == 1
    assert await _label_set(db_session, template_id) == before_fields
    assert await draft_lock_holder(db_session, template_id) is None
    after_count = (
        await db_session.execute(text("SELECT count(*) FROM public.agent_actions"))
    ).scalar_one()
    assert after_count == before_count


async def test_deadlock_maps_to_retry(
    mcp_client, pat_primary_rw, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    project_id, template_id, schema = await fresh_charms(db_session)
    section_id, _field_id = _section_and_field(schema)

    original_create_field = template_field_service.create_field
    calls = {"n": 0}

    async def _flaky_create_field(db, *, project_id, template_id, payload):  # type: ignore[no-untyped-def]
        calls["n"] += 1
        if calls["n"] == 2:
            raise DBAPIError("INSERT", {}, _Pg())
        return await original_create_field(
            db, project_id=project_id, template_id=template_id, payload=payload
        )

    monkeypatch.setattr(template_field_service, "create_field", _flaky_create_field)

    ops = [
        {"op": "add_question", "section_id": section_id, "label": "First", "type": "text"},
        {"op": "add_question", "section_id": section_id, "label": "Second", "type": "text"},
    ]
    result = await call_tool(
        mcp_client,
        pat_primary_rw,
        "edit_template_draft",
        {"project_id": str(project_id), "template_id": str(template_id), "ops": ops},
    )
    payload = error_payload(result)
    assert payload["code"] == "RETRY"
    assert payload["retryable"] is True
    row = (
        await db_session.execute(
            text(
                "SELECT count(*) FROM public.extraction_fields f "
                "JOIN public.extraction_entity_types et ON et.id = f.entity_type_id "
                "WHERE et.project_template_id = :tid AND f.label = 'First'"
            ),
            {"tid": str(template_id)},
        )
    ).scalar_one()
    assert row == 0
    assert await draft_lock_holder(db_session, template_id) is None
    assert await _audit_count(db_session, outcome="refused") == 1


async def test_deadlock_at_record_applied_write_maps_to_retry(
    mcp_client, pat_primary_rw, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    project_id, template_id, schema = await fresh_charms(db_session)
    section_id, _field_id = _section_and_field(schema)

    async def _boom(*_args, **_kwargs):  # type: ignore[no-untyped-def]
        raise DBAPIError("INSERT", {}, _Pg())

    monkeypatch.setattr(template_draft_tool, "record_applied_write", _boom)

    ops = [{"op": "add_question", "section_id": section_id, "label": "Q", "type": "text"}]
    result = await call_tool(
        mcp_client,
        pat_primary_rw,
        "edit_template_draft",
        {"project_id": str(project_id), "template_id": str(template_id), "ops": ops},
    )
    payload = error_payload(result)
    assert payload["code"] == "RETRY"
    assert payload["retryable"] is True
    applied_rows = (
        await db_session.execute(
            text("SELECT count(*) FROM public.agent_actions WHERE outcome = 'applied'")
        )
    ).scalar_one()
    assert applied_rows == 0
    assert await _audit_count(db_session, outcome="refused") == 1


@pytest.mark.mcp_real_sessions
async def test_claim_draft_lock_race(mcp_client) -> None:
    from app.services.template_draft_lock_service import claim_draft_lock

    async with mcp_session.session_factory() as setup:
        project_id, template_id, schema = await fresh_charms(setup)
        created = await create_token(
            setup,
            user_id=SEED.primary_profile,
            payload=PersonalAccessTokenCreateRequest(
                name="race", scope="read_write", expires_in_days=1
            ),
        )
        principal = await resolve_principal(setup, created.secret)
        await setup.commit()
    assert principal is not None
    pat = SeededPat(created.secret, principal)
    section_id, _field_id = _section_and_field(schema)

    try:
        async with mcp_session.session_factory() as holder_session:
            await claim_draft_lock(
                holder_session,
                project_id=project_id,
                template_id=template_id,
                user_id=SEED.reviewer_profile,
            )

            ops = [
                {"op": "add_question", "section_id": section_id, "label": "Race Q", "type": "text"}
            ]
            task = asyncio.create_task(
                call_tool(
                    mcp_client,
                    pat,
                    "edit_template_draft",
                    {
                        "project_id": str(project_id),
                        "template_id": str(template_id),
                        "ops": ops,
                    },
                )
            )
            await asyncio.sleep(0.3)
            assert not task.done()

            await holder_session.commit()
            result = await task

        payload = error_payload(result)
        assert payload["code"] == "DRAFT_LOCK_HELD"
        assert payload["holder_name"] == "Integration Reviewer"

        async with mcp_session.session_factory() as verify:
            holder = await draft_lock_holder(verify, template_id)
            assert holder == SEED.reviewer_profile
            count = (
                await verify.execute(
                    text(
                        "SELECT count(*) FROM public.extraction_fields f "
                        "JOIN public.extraction_entity_types et ON et.id = f.entity_type_id "
                        "WHERE et.project_template_id = :tid AND f.label = 'Race Q'"
                    ),
                    {"tid": str(template_id)},
                )
            ).scalar_one()
            assert count == 0
    finally:
        async with mcp_session.session_factory() as teardown:
            await teardown.execute(
                text("DELETE FROM public.personal_access_tokens WHERE id = :id"),
                {"id": str(created.token.id)},
            )
            await teardown.execute(
                text("DELETE FROM public.agent_actions WHERE project_id = :p"),
                {"p": str(SEED.secondary_project)},
            )
            await clean_project_clones(teardown, SEED.secondary_project)
            await teardown.execute(
                text("DELETE FROM public.articles WHERE id = :a"), {"a": str(ARTICLE_ID)}
            )
            await teardown.commit()


@pytest.mark.mcp_real_sessions
async def test_duplicate_name_race_maps_to_retryable(
    mcp_client, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A name that slips past both app-level checks (a writer's commit landed
    between the ``taken`` snapshot ``derive_field_name`` used and this call's
    own INSERT) is caught only by the 0050 unique index.

    The colliding row is inserted and committed by a genuinely separate
    session/connection BEFORE this test's tool call claims the draft lock,
    rather than mid-flight: the 0048 trigger (``0048_config_draft_marker``)
    unconditionally row-locks ``project_extraction_templates`` on every
    ``extraction_fields`` write, and ``claim_draft_lock`` + ``apply_draft_ops``
    share one open transaction that holds that same row locked for the whole
    call — so a second writer to the SAME template can only block until this
    call ends, never land inside it. A literal mid-flight second connection
    reproduces that lock wait exactly (verified: it hangs indefinitely).
    Sequencing the commit first, and forcing ``derive_field_name`` to ignore
    the (now correctly populated) ``taken`` set, reproduces the same
    observable contract — a name that both app-level guards miss, caught only
    by the DB backstop — deterministically and without blocking.
    """

    async def _never_taken(*_args, **_kwargs):  # type: ignore[no-untyped-def]
        return False

    monkeypatch.setattr(template_field_service, "_name_taken", _never_taken)

    def _racing_derive(_label: str, _taken):  # type: ignore[no-untyped-def]
        return "race"

    monkeypatch.setattr(template_field_naming, "derive_field_name", _racing_derive)

    async with mcp_session.session_factory() as setup:
        project_id, template_id, schema = await fresh_charms(setup)
        section_id, _field_id = _section_and_field(schema)
        # The colliding writer: fully committed before this call even starts.
        await add_field(setup, UUID(section_id), "race")
        created = await create_token(
            setup,
            user_id=SEED.primary_profile,
            payload=PersonalAccessTokenCreateRequest(
                name="race-dup", scope="read_write", expires_in_days=1
            ),
        )
        principal = await resolve_principal(setup, created.secret)
        await setup.commit()
    assert principal is not None
    pat = SeededPat(created.secret, principal)

    try:
        ops = [{"op": "add_question", "section_id": section_id, "label": "Race", "type": "text"}]
        result = await call_tool(
            mcp_client,
            pat,
            "edit_template_draft",
            {"project_id": str(project_id), "template_id": str(template_id), "ops": ops},
        )
        payload = error_payload(result)
        assert payload["code"] == "DUPLICATE_NAME"
        assert payload["retryable"] is True

        async with mcp_session.session_factory() as verify:
            rows = (
                await verify.execute(
                    text(
                        "SELECT count(*) FROM public.extraction_fields WHERE entity_type_id = :s "
                        "AND name = 'race'"
                    ),
                    {"s": section_id},
                )
            ).scalar_one()
            assert rows == 1
            holder = await draft_lock_holder(verify, template_id)
            assert holder is None
            refused = (
                await verify.execute(
                    text(
                        "SELECT count(*) FROM public.agent_actions WHERE outcome = 'refused' "
                        "AND tool = 'edit_template_draft' AND project_id = :p"
                    ),
                    {"p": str(project_id)},
                )
            ).scalar_one()
            assert refused == 1
    finally:
        async with mcp_session.session_factory() as teardown:
            await teardown.execute(
                text("DELETE FROM public.personal_access_tokens WHERE id = :id"),
                {"id": str(created.token.id)},
            )
            await teardown.execute(
                text("DELETE FROM public.agent_actions WHERE project_id = :p"),
                {"p": str(SEED.secondary_project)},
            )
            await clean_project_clones(teardown, SEED.secondary_project)
            await teardown.execute(
                text("DELETE FROM public.articles WHERE id = :a"), {"a": str(ARTICLE_ID)}
            )
            await teardown.commit()


async def test_nul_in_an_op_string_is_invalid_argument(
    mcp_client, pat_primary_rw, db_session: AsyncSession
) -> None:
    """F10 (final review): a U+0000 inside an op string is INVALID_ARGUMENT
    naming the op and field, audited, with nothing written."""
    project_id, template_id, schema = await fresh_charms(db_session)
    section_id, _field_id = _section_and_field(schema)
    before = await _label_set(db_session, template_id)
    ops = [
        {"op": "add_question", "section_id": section_id, "label": "Fine", "type": "text"},
        {"op": "add_question", "section_id": section_id, "label": "Bad\u0000", "type": "text"},
    ]

    result = await call_tool(
        mcp_client,
        pat_primary_rw,
        "edit_template_draft",
        {"project_id": str(project_id), "template_id": str(template_id), "ops": ops},
    )
    payload = error_payload(result)
    assert payload["code"] == "INVALID_ARGUMENT"
    assert payload["op_index"] == 1
    assert payload["field"] == "label"
    assert await _label_set(db_session, template_id) == before
    assert await draft_lock_holder(db_session, template_id) is None
    assert await _audit_count(db_session, outcome="refused") == 1
