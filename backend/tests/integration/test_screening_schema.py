"""Screening schema (migration 0094): posture, append-only, CHECKs, cascades.

The three screening tables are backend-only with the 0072 ``deny_all``
posture: the client roles hold no privilege, and the ``deny_all`` policy is
the floor if a grant ever comes back. Decisions and arbitrations are
append-only (the 0081 trigger). 0094 also closes client writes on the two
article-sync tables while members keep reading them.
"""

from __future__ import annotations

import json
from typing import Any
from uuid import UUID

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError, IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.screening import ScreeningArbitration, ScreeningAssignment, ScreeningDecision
from tests.integration.conftest import SEED
from tests.integration.helpers.batch_fixtures import make_article

SCREENING = ["screening_assignments", "screening_decisions", "screening_arbitrations"]
SYNC = ["article_sync_runs", "article_sync_events"]


async def _privilege(db: AsyncSession, role: str, table: str, privilege: str) -> bool:
    return bool(
        (
            await db.execute(
                text("SELECT has_table_privilege(:role, :table, :privilege)"),
                {"role": role, "table": f"public.{table}", "privilege": privilege},
            )
        ).scalar_one()
    )


async def _as_manager(
    db: AsyncSession,
    sql: str,
    params: dict[str, Any] | None = None,
    *,
    regrant_select_on: str | None = None,
) -> str | int:
    """Run ``sql`` under ``authenticated`` with a manager JWT, then roll back.

    Returns the error text, or the scalar result when the statement passed.
    ``regrant_select_on`` restores SELECT inside the rolled-back transaction
    so the probe reaches the ``deny_all`` policy instead of the missing grant.
    """
    await db.commit()
    try:
        if regrant_select_on is not None:
            await db.execute(text(f"GRANT SELECT ON public.{regrant_select_on} TO authenticated"))
        await db.execute(
            text("SELECT set_config('request.jwt.claims', :claims, true)"),
            {"claims": json.dumps({"sub": str(SEED.primary_profile), "role": "authenticated"})},
        )
        await db.execute(text("SET LOCAL ROLE authenticated"))
        result = await db.execute(text(sql), params or {})
        return int(result.scalar_one()) if result.returns_rows else int(result.rowcount)
    except DBAPIError as exc:
        return str(exc.orig)
    finally:
        await db.rollback()


async def _assignment(db: AsyncSession) -> ScreeningAssignment:
    article_id = await make_article(db, SEED.primary_project, title="screening article")
    assignment = ScreeningAssignment(
        project_id=SEED.primary_project,
        article_id=article_id,
        enrolled_by=SEED.primary_profile,
    )
    db.add(assignment)
    await db.flush()
    return assignment


async def _decision(
    db: AsyncSession,
    assignment_id: UUID,
    decision: str = "include",
    exclusion_reason: str | None = None,
) -> ScreeningDecision:
    row = ScreeningDecision(
        assignment_id=assignment_id,
        reviewer_id=SEED.primary_profile,
        decision=decision,
        exclusion_reason=exclusion_reason,
    )
    db.add(row)
    await db.flush()
    return row


async def _arbitration(
    db: AsyncSession,
    assignment_id: UUID,
    decision: str = "include",
    exclusion_reason: str | None = None,
    selected_decision_id: UUID | None = None,
) -> ScreeningArbitration:
    row = ScreeningArbitration(
        assignment_id=assignment_id,
        decision=decision,
        exclusion_reason=exclusion_reason,
        selected_decision_id=selected_decision_id,
        decided_by=SEED.primary_profile,
    )
    db.add(row)
    await db.flush()
    return row


# --- Posture -----------------------------------------------------------------


@pytest.mark.parametrize("table", SCREENING)
@pytest.mark.parametrize("role", ["anon", "authenticated"])
@pytest.mark.parametrize("privilege", ["SELECT", "INSERT", "UPDATE", "DELETE"])
async def test_screening_tables_are_deny_all(
    db_session: AsyncSession, table: str, role: str, privilege: str
) -> None:
    assert await _privilege(db_session, role, table, privilege) is False, (
        f"{role} holds {privilege} on {table}"
    )


@pytest.mark.parametrize("table", SYNC)
@pytest.mark.parametrize("role", ["anon", "authenticated"])
@pytest.mark.parametrize("privilege", ["INSERT", "UPDATE", "DELETE"])
async def test_sync_tables_refuse_client_writes(
    db_session: AsyncSession, table: str, role: str, privilege: str
) -> None:
    assert await _privilege(db_session, role, table, privilege) is False, (
        f"{role} holds {privilege} on {table}"
    )


@pytest.mark.parametrize("table", SYNC)
async def test_sync_tables_keep_member_select(db_session: AsyncSession, table: str) -> None:
    assert await _privilege(db_session, "authenticated", table, "SELECT") is True


@pytest.mark.parametrize("table", SCREENING)
async def test_screening_read_as_authenticated_is_permission_denied(
    db_session: AsyncSession, table: str
) -> None:
    refused = await _as_manager(db_session, f"SELECT count(*) FROM public.{table}")
    assert isinstance(refused, str) and "permission denied" in refused, refused

    visible = await _as_manager(
        db_session,
        "SELECT count(*) FROM public.articles WHERE project_id = :pid",
        {"pid": str(SEED.primary_project)},
    )
    assert isinstance(visible, int) and visible >= 1, visible


async def test_deny_all_policy_hides_rows_even_with_grant(db_session: AsyncSession) -> None:
    await _assignment(db_session)
    await db_session.commit()
    owner_count = (
        await db_session.execute(text("SELECT count(*) FROM public.screening_assignments"))
    ).scalar_one()
    assert owner_count >= 1, "the backend's own role sees the row it inserted"

    hidden = await _as_manager(
        db_session,
        "SELECT count(*) FROM public.screening_assignments",
        regrant_select_on="screening_assignments",
    )
    assert hidden == 0


# --- Append-only -------------------------------------------------------------


@pytest.mark.parametrize("table", ["screening_decisions", "screening_arbitrations"])
@pytest.mark.parametrize("op", ["update", "delete"])
async def test_append_only_trigger_refuses_non_owner(
    db_session: AsyncSession, table: str, op: str
) -> None:
    assignment = await _assignment(db_session)
    row: ScreeningDecision | ScreeningArbitration
    if table == "screening_decisions":
        row = await _decision(db_session, assignment.id)
    else:
        row = await _arbitration(db_session, assignment.id)
    await db_session.commit()
    sql = (
        f"UPDATE public.{table} SET rationale = 'x' WHERE id = :id"
        if op == "update"
        else f"DELETE FROM public.{table} WHERE id = :id"
    )
    try:
        # The CI stub's service_role may lack the privilege; grant it inside the
        # rolled-back transaction so the trigger, not the ACL, is what refuses.
        await db_session.execute(text(f"GRANT UPDATE, DELETE ON public.{table} TO service_role"))
        await db_session.execute(text("SET LOCAL ROLE service_role"))
        with pytest.raises(DBAPIError, match="append-only table"):
            await db_session.execute(text(sql), {"id": str(row.id)})
    finally:
        await db_session.rollback()


# --- CHECKs and uniqueness -----------------------------------------------------


@pytest.mark.parametrize("model", ["decision", "arbitration"])
async def test_exclusion_reason_only_on_exclude(db_session: AsyncSession, model: str) -> None:
    assignment = await _assignment(db_session)
    write = _decision if model == "decision" else _arbitration
    table = "screening_decisions" if model == "decision" else "screening_arbitrations"

    with pytest.raises(IntegrityError, match=f"ck_{table}_reason_on_exclude"):
        async with db_session.begin_nested():
            await write(db_session, assignment.id, "include", "Wrong population")

    with_reason = await write(db_session, assignment.id, "exclude", "Wrong population")
    without_reason = await write(db_session, assignment.id, "exclude", None)
    assert with_reason.id != without_reason.id


async def test_decision_value_is_checked(db_session: AsyncSession) -> None:
    assignment = await _assignment(db_session)
    with pytest.raises(IntegrityError, match="ck_screening_decisions_decision"):
        async with db_session.begin_nested():
            await _decision(db_session, assignment.id, "skip")


async def test_full_text_and_not_retrieved_are_accepted(db_session: AsyncSession) -> None:
    ta = await _assignment(db_session)
    full_text = ScreeningAssignment(
        project_id=ta.project_id,
        article_id=ta.article_id,
        phase="full_text",
        enrolled_by=SEED.primary_profile,
    )
    db_session.add(full_text)
    await db_session.flush()
    await _decision(db_session, full_text.id, "not_retrieved")
    await _arbitration(db_session, ta.id, "not_retrieved")

    with pytest.raises(IntegrityError, match="ck_screening_assignments_phase"):
        async with db_session.begin_nested():
            db_session.add(
                ScreeningAssignment(
                    project_id=ta.project_id, article_id=ta.article_id, phase="other"
                )
            )
            await db_session.flush()


async def test_one_assignment_per_article_and_phase(db_session: AsyncSession) -> None:
    first = await _assignment(db_session)
    assert first.phase == "title_abstract"
    with pytest.raises(IntegrityError, match="uq_screening_assignments_article_phase"):
        async with db_session.begin_nested():
            db_session.add(
                ScreeningAssignment(project_id=first.project_id, article_id=first.article_id)
            )
            await db_session.flush()


# --- Timestamps ------------------------------------------------------------------


@pytest.mark.parametrize(
    ("table", "column", "expected"),
    [
        ("screening_decisions", "created_at", "clock_timestamp()"),
        ("screening_arbitrations", "created_at", "clock_timestamp()"),
        ("screening_assignments", "enrolled_at", "now()"),
    ],
    ids=["decision-created", "arbitration-created", "enrolled-shares-transaction-time"],
)
async def test_timestamp_defaults(
    db_session: AsyncSession, table: str, column: str, expected: str
) -> None:
    """The current row is the latest by ``created_at``, so a decision and a ruling are stamped by
    the clock at INSERT; an enroll's rows share one transaction time (spec §5)."""
    default = (
        await db_session.execute(
            text(
                "SELECT column_default FROM information_schema.columns "
                "WHERE table_schema = 'public' AND table_name = :t AND column_name = :c"
            ),
            {"t": table, "c": column},
        )
    ).scalar_one()
    assert default == expected


# --- Foreign keys ----------------------------------------------------------------


async def _count_for(db: AsyncSession, table: str, column: str, value: UUID) -> int:
    return int(
        (
            await db.execute(
                text(f"SELECT count(*) FROM public.{table} WHERE {column} = :v"),
                {"v": str(value)},
            )
        ).scalar_one()
    )


async def test_manager_deleting_an_enrolled_article_cascades_screening_rows(
    db_session: AsyncSession,
) -> None:
    assignment = await _assignment(db_session)
    first = await _decision(db_session, assignment.id)
    await _decision(db_session, assignment.id, "exclude", "Wrong population")
    await _arbitration(db_session, assignment.id, selected_decision_id=first.id)
    await db_session.commit()
    try:
        await db_session.execute(
            text("SELECT set_config('request.jwt.claims', :claims, true)"),
            {"claims": json.dumps({"sub": str(SEED.primary_profile), "role": "authenticated"})},
        )
        await db_session.execute(text("SET LOCAL ROLE authenticated"))
        deleted = await db_session.execute(
            text("DELETE FROM public.articles WHERE id = :aid"),
            {"aid": str(assignment.article_id)},
        )
        assert deleted.rowcount == 1
        await db_session.execute(text("RESET ROLE"))
        assert await _count_for(db_session, "screening_assignments", "id", assignment.id) == 0
        for table in ("screening_decisions", "screening_arbitrations"):
            assert await _count_for(db_session, table, "assignment_id", assignment.id) == 0
        await db_session.execute(text("SET CONSTRAINTS ALL IMMEDIATE"))
    finally:
        await db_session.rollback()


async def test_selected_decision_must_belong_to_the_same_assignment(
    db_session: AsyncSession,
) -> None:
    a1 = await _assignment(db_session)
    a2 = await _assignment(db_session)
    d1 = await _decision(db_session, a1.id)
    d2 = await _decision(db_session, a2.id)
    await db_session.execute(
        text("SET CONSTRAINTS fk_screening_arbitrations_selected_decision_match IMMEDIATE")
    )

    with pytest.raises(IntegrityError, match="fk_screening_arbitrations_selected_decision_match"):
        async with db_session.begin_nested():
            await _arbitration(db_session, a1.id, selected_decision_id=d2.id)

    ruling = await _arbitration(db_session, a1.id, selected_decision_id=d1.id)
    assert ruling.selected_decision_id == d1.id


async def test_every_foreign_key_leads_an_index(db_session: AsyncSession) -> None:
    unindexed = (
        (
            await db_session.execute(
                text(
                    "SELECT c.conname FROM pg_constraint c WHERE c.contype = 'f' "
                    "AND c.conrelid IN ('public.screening_assignments'::regclass, "
                    "'public.screening_decisions'::regclass, "
                    "'public.screening_arbitrations'::regclass) "
                    "AND NOT EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid = c.conrelid "
                    "AND (string_to_array(i.indkey::text, ' ')::int2[])"
                    "[1:cardinality(c.conkey)] = c.conkey)"
                )
            )
        )
        .scalars()
        .all()
    )
    assert unindexed == []
