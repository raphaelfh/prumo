"""``ai_usage_ledger`` (migration 0091): posture, generated total, link survival.

The ledger is backend-only, with the 0072 ``deny_all`` posture: the client
roles hold no privilege at all, and the ``deny_all`` policy is the floor if a
grant ever comes back. Usage outlives the owner, run, attempt and batch it
names (``ON DELETE SET NULL``); only a project delete removes it.
"""

from __future__ import annotations

import json
from uuid import UUID, uuid4

import pytest
from sqlalchemy import select, text
from sqlalchemy.exc import DBAPIError, IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.ai_usage_ledger import AiUsageLedger
from app.models.extraction_attempt import ExtractionAttempt
from tests.integration.conftest import SEED
from tests.integration.helpers.engine_setup import run_in_extract

_TABLE = "public.ai_usage_ledger"

_INSERT_ROW = (
    "INSERT INTO public.ai_usage_ledger "
    "(project_id, provider, model, pass_kind, prompt_version, "
    "prompt_tokens, completion_tokens, outcome) "
    "VALUES (:pid, 'openai', 'probe-model', 'extract', 'v1', 1, 2, 'ok')"
)


def _ledger_row(project_id: UUID, **links: UUID | None) -> AiUsageLedger:
    return AiUsageLedger(
        project_id=project_id,
        provider="openai",
        model="probe-model",
        key_scope="user_byok",
        pass_kind="extract",
        prompt_version="v1",
        prompt_tokens=120,
        completion_tokens=30,
        outcome="ok",
        request_id="req-probe",
        **links,
    )


async def _as_manager(db: AsyncSession, sql: str, *, regrant_select: bool = False) -> str | int:
    """Run ``sql`` under ``authenticated`` with a manager JWT, then roll back.

    Returns the error text, or the scalar result when the statement passed.
    ``regrant_select`` restores SELECT inside the rolled-back transaction so
    the probe reaches the ``deny_all`` policy instead of the missing grant.
    """
    await db.commit()
    try:
        if regrant_select:
            await db.execute(text(f"GRANT SELECT ON {_TABLE} TO authenticated"))
        await db.execute(
            text("SELECT set_config('request.jwt.claims', :claims, true)"),
            {"claims": json.dumps({"sub": str(SEED.primary_profile), "role": "authenticated"})},
        )
        await db.execute(text("SET LOCAL ROLE authenticated"))
        result = await db.execute(text(sql), {"pid": str(SEED.primary_project)})
        return int(result.scalar_one()) if result.returns_rows else int(result.rowcount)
    except DBAPIError as exc:
        return str(exc.orig)
    finally:
        await db.rollback()


@pytest.mark.parametrize("role", ["anon", "authenticated"])
@pytest.mark.parametrize("privilege", ["SELECT", "INSERT", "UPDATE", "DELETE"])
async def test_ledger_is_deny_all(db_session: AsyncSession, role: str, privilege: str) -> None:
    granted = (
        await db_session.execute(
            text("SELECT has_table_privilege(:role, :table, :privilege)"),
            {"role": role, "table": _TABLE, "privilege": privilege},
        )
    ).scalar_one()
    assert granted is False, f"{role} holds {privilege} on {_TABLE}"


@pytest.mark.parametrize(
    "sql",
    [f"SELECT count(*) FROM {_TABLE}", _INSERT_ROW],
    ids=["select", "insert"],
)
async def test_ledger_manager_jwt_is_refused(db_session: AsyncSession, sql: str) -> None:
    outcome = await _as_manager(db_session, sql)
    assert isinstance(outcome, str) and "permission denied" in outcome, outcome


async def test_ledger_policy_floor_hides_rows_even_with_grant(db_session: AsyncSession) -> None:
    await db_session.execute(text(_INSERT_ROW), {"pid": str(SEED.primary_project)})
    await db_session.commit()
    owner_count = (await db_session.execute(text(f"SELECT count(*) FROM {_TABLE}"))).scalar_one()
    assert owner_count >= 1, "the backend's own role sees the row it inserted"

    assert await _as_manager(db_session, f"SELECT count(*) FROM {_TABLE}", regrant_select=True) == 0


async def test_total_tokens_is_generated_and_links_survive(db_session: AsyncSession) -> None:
    run = await run_in_extract(db_session)
    attempt = ExtractionAttempt(
        request_id=uuid4(),
        owner_id=SEED.primary_profile,
        project_id=run.project_id,
        article_id=run.article_id,
        template_id=run.template_id,
        run_id=run.id,
        request_payload={},
    )
    db_session.add(attempt)
    await db_session.flush()
    row = _ledger_row(
        run.project_id, owner_id=SEED.primary_profile, run_id=run.id, attempt_id=attempt.id
    )
    db_session.add(row)
    await db_session.flush()
    await db_session.refresh(row)
    assert row.total_tokens == 150
    assert row.created_at is not None
    row_id, run_id, attempt_id = row.id, run.id, attempt.id

    async def links() -> tuple[UUID | None, UUID | None]:
        db_session.expunge_all()
        survivor = (
            await db_session.execute(select(AiUsageLedger).where(AiUsageLedger.id == row_id))
        ).scalar_one()
        assert survivor.owner_id == SEED.primary_profile
        assert survivor.total_tokens == 150
        return survivor.run_id, survivor.attempt_id

    # Attempt first, then run: the row was inserted in THIS transaction, so a
    # run delete cascading through the attempt would re-check attempt_id on the
    # run_id SET NULL update before the attempt's own SET NULL runs. Ledger rows
    # commit in their own transaction in the app, where that re-check is skipped.
    await db_session.execute(
        text("DELETE FROM public.extraction_attempts WHERE id = :id"), {"id": str(attempt_id)}
    )
    assert await links() == (run_id, None)
    await db_session.execute(
        text("DELETE FROM public.extraction_runs WHERE id = :id"), {"id": str(run_id)}
    )
    assert await links() == (None, None)


async def test_project_delete_removes_its_usage(db_session: AsyncSession) -> None:
    project_id = uuid4()
    await db_session.execute(
        text(
            "INSERT INTO public.projects (id, name, created_by_id, is_active) "
            "VALUES (:id, 'ledger-cascade-probe', :uid, true)"
        ),
        {"id": str(project_id), "uid": str(SEED.primary_profile)},
    )
    row = _ledger_row(project_id)
    db_session.add(row)
    await db_session.flush()
    row_id = row.id

    await db_session.execute(
        text("DELETE FROM public.projects WHERE id = :id"), {"id": str(project_id)}
    )
    db_session.expunge_all()
    remaining = (
        await db_session.execute(select(AiUsageLedger).where(AiUsageLedger.id == row_id))
    ).scalar_one_or_none()
    assert remaining is None


async def test_negative_tokens_refused(db_session: AsyncSession) -> None:
    row = _ledger_row(SEED.primary_project)
    row.prompt_tokens = -1
    db_session.add(row)
    with pytest.raises(IntegrityError, match="ck_ai_usage_ledger_prompt_tokens_nonneg"):
        await db_session.flush()
