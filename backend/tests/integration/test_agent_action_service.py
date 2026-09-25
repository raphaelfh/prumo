"""Integration tests for ``app.services.agent_action_service`` (spec §6.1).

Real Postgres: CHECK constraints, FK delete rules and the partial index
are invisible to a mocked session.
"""

from __future__ import annotations

import hashlib
import json
from uuid import UUID, uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession

from app.services import agent_action_service
from app.services.agent_action_service import record_applied, record_refused
from tests.integration.conftest import SEED
from tests.integration.helpers.pat_rows import insert_pat_row as _token


async def _throwaway_project(db: AsyncSession) -> UUID:
    pid = uuid4()
    await db.execute(
        text(
            "INSERT INTO public.projects (id, name, created_by_id, is_active) "
            "VALUES (:id, 'audit-fk', :uid, true)"
        ),
        {"id": str(pid), "uid": str(SEED.primary_profile)},
    )
    return pid


async def _throwaway_template(db: AsyncSession, project_id: UUID) -> UUID:
    tid = uuid4()  # is_active=false: no active-version trigger involvement
    await db.execute(
        text(
            "INSERT INTO public.project_extraction_templates "
            "(id, project_id, name, description, framework, version, kind, schema, "
            "is_active, created_by) "
            "VALUES (:id, :pid, 'audit-fk', NULL, 'CUSTOM', '1.0', 'extraction', "
            "'{}'::jsonb, false, :uid)"
        ),
        {"id": str(tid), "pid": str(project_id), "uid": str(SEED.primary_profile)},
    )
    return tid


@pytest.mark.asyncio
async def test_record_applied_inserts_one_row_stamped_by_the_database(
    db_session: AsyncSession,
) -> None:
    tok = await _token(db_session)
    row = await record_applied(
        db_session,
        token_id=tok,
        user_id=SEED.primary_profile,
        project_id=SEED.primary_project,
        template_id=SEED.primary_template,
        tool="edit_template_draft",
        tool_input={"ops": [1]},
        before={"a": 1},
        after={"a": 2},
    )

    db_now = (await db_session.execute(text("SELECT now()"))).scalar_one()
    fetched = (
        (
            await db_session.execute(
                text(
                    "SELECT outcome, error_code, before, after, input, created_at "
                    "FROM public.agent_actions WHERE id = :id"
                ),
                {"id": str(row.id)},
            )
        )
        .mappings()
        .one()
    )

    assert fetched["outcome"] == "applied"
    assert fetched["error_code"] is None
    assert fetched["before"] == {"a": 1}
    assert fetched["after"] == {"a": 2}
    assert fetched["input"] == {"ops": [1]}
    assert fetched["created_at"] == db_now


@pytest.mark.asyncio
async def test_record_refused_survives_the_callers_rollback(
    db_session_real: AsyncSession,
) -> None:
    """A real-commit session throughout: ``db_session``'s SAVEPOINT-restart
    hook rolls back its whole transaction (including an earlier same-session
    commit) on an explicit mid-test ``rollback()``, which would erase the
    token before it ever reaches the FK check under test -- and inserting
    the audit row via ``db_session`` here would hold a FOR KEY SHARE lock on
    the token row for the rest of the (uncommitted) test transaction,
    deadlocking any real-session cleanup. ``db_session_real`` gives plain
    Postgres transaction semantics: each ``commit()``/``rollback()`` only
    touches the work since the previous one, exactly as in production.
    """
    tok = await _token(db_session_real)
    await db_session_real.commit()
    try:
        await db_session_real.execute(
            text("UPDATE public.projects SET description = 'dirty' WHERE id = :pid"),
            {"pid": str(SEED.primary_project)},
        )
        await db_session_real.rollback()

        await record_refused(
            db_session_real,
            token_id=tok,
            user_id=SEED.primary_profile,
            project_id=SEED.primary_project,
            template_id=SEED.primary_template,
            tool="update_project_details",
            tool_input={"fields": {}},
            error_code="STALE_VALUE",
        )
        await db_session_real.commit()

        description = (
            await db_session_real.execute(
                text("SELECT description FROM public.projects WHERE id = :pid"),
                {"pid": str(SEED.primary_project)},
            )
        ).scalar_one()
        assert description != "dirty"

        rows = (
            (
                await db_session_real.execute(
                    text(
                        "SELECT outcome, error_code, before, after FROM public.agent_actions "
                        "WHERE token_id = :tok"
                    ),
                    {"tok": str(tok)},
                )
            )
            .mappings()
            .all()
        )
        assert len(rows) == 1
        row = rows[0]
        assert row["outcome"] == "refused"
        assert row["error_code"] == "STALE_VALUE"
        assert row["before"] is None
        assert row["after"] is None
    finally:
        await db_session_real.execute(
            text("DELETE FROM public.agent_actions WHERE token_id = :tok"), {"tok": str(tok)}
        )
        await db_session_real.execute(
            text("DELETE FROM public.personal_access_tokens WHERE id = :tok"), {"tok": str(tok)}
        )
        await db_session_real.commit()


@pytest.mark.asyncio
async def test_oversized_input_is_stored_as_a_marker(db_session: AsyncSession) -> None:
    tok = await _token(db_session)
    big = {"blob": "x" * 70_000}
    raw = json.dumps(big, ensure_ascii=False, sort_keys=True, separators=(", ", ": ")).encode()

    row = await record_applied(
        db_session,
        token_id=tok,
        user_id=SEED.primary_profile,
        project_id=SEED.primary_project,
        template_id=SEED.primary_template,
        tool="edit_template_draft",
        tool_input=big,
        before={},
        after={},
    )

    stored = (
        await db_session.execute(
            text("SELECT input FROM public.agent_actions WHERE id = :id"), {"id": str(row.id)}
        )
    ).scalar_one()
    assert stored == {
        "truncated": True,
        "bytes": len(raw),
        "sha256": hashlib.sha256(raw).hexdigest(),
    }


@pytest.mark.asyncio
async def test_input_under_the_threshold_is_stored_verbatim(db_session: AsyncSession) -> None:
    tok = await _token(db_session)
    small = {"blob": "x" * 50_000}

    row = await record_applied(
        db_session,
        token_id=tok,
        user_id=SEED.primary_profile,
        project_id=SEED.primary_project,
        template_id=SEED.primary_template,
        tool="edit_template_draft",
        tool_input=small,
        before={},
        after={},
    )

    stored = (
        await db_session.execute(
            text("SELECT input FROM public.agent_actions WHERE id = :id"), {"id": str(row.id)}
        )
    ).scalar_one()
    assert stored == small


@pytest.mark.asyncio
async def test_input_size_is_measured_in_bytes_not_characters(db_session: AsyncSession) -> None:
    tok = await _token(db_session)
    # 40,000 chars, 80,000 UTF-8 bytes ("é" is 2 bytes) -> must be treated as oversized.
    accented = {"blob": "é" * 40_000}

    row = await record_applied(
        db_session,
        token_id=tok,
        user_id=SEED.primary_profile,
        project_id=SEED.primary_project,
        template_id=SEED.primary_template,
        tool="edit_template_draft",
        tool_input=accented,
        before={},
        after={},
    )

    stored = (
        await db_session.execute(
            text("SELECT input FROM public.agent_actions WHERE id = :id"), {"id": str(row.id)}
        )
    ).scalar_one()
    assert stored.get("truncated") is True


@pytest.mark.asyncio
async def test_table_constraints(db_session: AsyncSession) -> None:
    base_cols = "id, token_id, user_id, project_id, template_id, tool, input, outcome, error_code"

    with pytest.raises(DBAPIError) as exc:
        async with db_session.begin_nested():
            await db_session.execute(
                text(
                    f"INSERT INTO public.agent_actions ({base_cols}) VALUES "
                    "(gen_random_uuid(), NULL, :uid, :pid, NULL, 'x', '{}'::jsonb, "
                    "'maybe', 'X')"
                ),
                {"uid": str(SEED.primary_profile), "pid": str(SEED.primary_project)},
            )
    assert "ck_agent_actions_outcome_check" in str(exc.value)

    with pytest.raises(DBAPIError) as exc:
        async with db_session.begin_nested():
            await db_session.execute(
                text(
                    f"INSERT INTO public.agent_actions ({base_cols}) VALUES "
                    "(gen_random_uuid(), NULL, :uid, :pid, NULL, 'x', '{}'::jsonb, "
                    "'applied', 'X')"
                ),
                {"uid": str(SEED.primary_profile), "pid": str(SEED.primary_project)},
            )
    assert "ck_agent_actions_error_code_check" in str(exc.value)

    with pytest.raises(DBAPIError) as exc:
        async with db_session.begin_nested():
            await db_session.execute(
                text(
                    f"INSERT INTO public.agent_actions ({base_cols}) VALUES "
                    "(gen_random_uuid(), NULL, :uid, :pid, NULL, 'x', '{}'::jsonb, "
                    "'refused', NULL)"
                ),
                {"uid": str(SEED.primary_profile), "pid": str(SEED.primary_project)},
            )
    assert "ck_agent_actions_error_code_check" in str(exc.value)

    with pytest.raises(DBAPIError) as exc:
        async with db_session.begin_nested():
            await db_session.execute(
                text(
                    f"INSERT INTO public.agent_actions ({base_cols}) VALUES "
                    "(gen_random_uuid(), NULL, :uid, :pid, NULL, 'x', "
                    "jsonb_build_object('blob', repeat('x', 70000)), 'applied', NULL)"
                ),
                {"uid": str(SEED.primary_profile), "pid": str(SEED.primary_project)},
            )
    assert "ck_agent_actions_input_size_check" in str(exc.value)


@pytest.mark.asyncio
async def test_foreign_key_delete_rules(db_session: AsyncSession) -> None:
    rows = (
        await db_session.execute(
            text(
                "SELECT conname, confdeltype::text FROM pg_constraint "
                "WHERE conrelid = 'public.agent_actions'::regclass AND contype = 'f'"
            )
        )
    ).all()
    assert dict(rows) == {
        "agent_actions_token_id_fkey": "n",
        "agent_actions_user_id_fkey": "n",
        "agent_actions_project_id_fkey": "c",
        "agent_actions_template_id_fkey": "n",
    }


@pytest.mark.asyncio
async def test_deleting_the_token_or_template_keeps_the_row_and_nulls_the_reference(
    db_session: AsyncSession,
) -> None:
    project_id = await _throwaway_project(db_session)
    template_id = await _throwaway_template(db_session, project_id)
    tok = await _token(db_session)

    row = await record_applied(
        db_session,
        token_id=tok,
        user_id=SEED.primary_profile,
        project_id=project_id,
        template_id=template_id,
        tool="edit_template_draft",
        tool_input={},
        before={},
        after={},
    )

    await db_session.execute(
        text("DELETE FROM public.personal_access_tokens WHERE id = :tok"), {"tok": str(tok)}
    )
    await db_session.execute(
        text("DELETE FROM public.project_extraction_templates WHERE id = :tid"),
        {"tid": str(template_id)},
    )

    fetched = (
        (
            await db_session.execute(
                text("SELECT token_id, template_id FROM public.agent_actions WHERE id = :id"),
                {"id": str(row.id)},
            )
        )
        .mappings()
        .one()
    )
    assert fetched["token_id"] is None
    assert fetched["template_id"] is None


@pytest.mark.asyncio
async def test_deleting_the_project_removes_its_rows(db_session: AsyncSession) -> None:
    project_id = await _throwaway_project(db_session)
    tok = await _token(db_session)

    await record_refused(
        db_session,
        token_id=tok,
        user_id=SEED.primary_profile,
        project_id=project_id,
        template_id=None,
        tool="update_project_details",
        tool_input={},
        error_code="STALE_VALUE",
    )

    await db_session.execute(
        text("DELETE FROM public.projects WHERE id = :pid"), {"pid": str(project_id)}
    )

    count = (
        await db_session.execute(
            text("SELECT count(*) FROM public.agent_actions WHERE project_id = :pid"),
            {"pid": str(project_id)},
        )
    ).scalar_one()
    assert count == 0


@pytest.mark.asyncio
async def test_partial_index_exists(db_session: AsyncSession) -> None:
    indexdef = (
        await db_session.execute(
            text(
                "SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' "
                "AND indexname = 'ix_agent_actions_template_applied'"
            )
        )
    ).scalar_one()
    assert "(template_id, created_at)" in indexdef
    assert "WHERE (outcome = 'applied'::text)" in indexdef


@pytest.mark.asyncio
async def test_foreign_keys_are_indexed(db_session: AsyncSession) -> None:
    rows = (
        await db_session.execute(
            text(
                "SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' "
                "AND indexname IN ('ix_agent_actions_project_id', 'ix_agent_actions_token_id', "
                "'ix_agent_actions_user_id')"
            )
        )
    ).all()
    by_name = dict(rows)
    assert by_name["ix_agent_actions_project_id"].endswith("(project_id)")
    assert by_name["ix_agent_actions_token_id"].endswith("(token_id)")
    assert by_name["ix_agent_actions_user_id"].endswith("(user_id)")


def test_service_exposes_insert_only() -> None:
    public_callables = {
        name
        for name, value in vars(agent_action_service).items()
        if callable(value)
        and not name.startswith("_")
        and getattr(value, "__module__", "") == agent_action_service.__name__
    }
    assert public_callables == {"record_applied", "record_refused"}
