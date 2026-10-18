"""``ai_usage_ledger`` (migration 0091): posture, generated total, link
survival, per-call accounting and the durability of metered rows.

The ledger is backend-only, with the 0072 ``deny_all`` posture: the client
roles hold no privilege at all, and the ``deny_all`` policy is the floor if a
grant ever comes back. Usage outlives the owner, run, attempt and batch it
names (``ON DELETE SET NULL``); only a project delete removes it.
"""

from __future__ import annotations

import json
from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Any
from uuid import UUID, uuid4

import pytest
from pydantic import BaseModel
from sqlalchemy import event, func, select, text
from sqlalchemy.exc import DBAPIError, IntegrityError
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker
from structlog.testing import capture_logs

from app.core.factories import create_ledger_session_factory
from app.llm import entailment, verify
from app.llm.extractor import LlmUsage, UsageLedgerWriteError
from app.llm.prompts import entry_identification, section_extraction
from app.models.ai_usage_ledger import AiUsageLedger
from app.models.extraction import ExtractionRun
from app.models.extraction_attempt import ExtractionAttempt
from app.models.extraction_batch import ExtractionBatch, ExtractionBatchItem
from app.schemas.llm_target import LlmTarget
from app.services.ai_usage_metering import LedgerSink, UsageContext, metered
from app.services.template_versioning import TemplateVersionService
from tests.fakes.recorded_llm import RecordedLlm
from tests.fakes.usage_sink import RecordingUsageSink
from tests.integration.conftest import SEED
from tests.integration.helpers.ai_extraction import extraction, request, seed_article_text
from tests.integration.helpers.engine_setup import run_in_extract
from tests.integration.test_ai_extraction_flows import (
    _entry_with_children,
    _no_live_run,
    _sections,
)
from tests.integration.test_extraction_attempt_repository import graph as attempt_graph

graph = attempt_graph

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


# --------------------------------------------------------------------------
# Per-call accounting: the service on ``db_session`` with the recording sink
# --------------------------------------------------------------------------

_VERIFIED = LlmTarget(provider="openai", model="gpt-5.6-luna", mode_requested="verified")


async def test_single_section_verified_run_records_one_entry_per_call(
    db_session: AsyncSession,
) -> None:
    """Extract, verify and each entailment judge call are one entry each,
    with their own kind, prompt version and last response id; the run's
    ``results.tokens`` is the sum of the ``ok`` entries, entailment included."""
    await _no_live_run(db_session)
    quotes = ("A total of 142 participants were enrolled.", "Sample: 142 subjects total.")
    await seed_article_text(db_session, *quotes)
    fake = RecordedLlm(
        fields={
            "sample_size": {
                "value": 142,
                "evidence": [{"block_ref": "p1·b0", "quote": q} for q in quotes],
            }
        },
        verdicts={"sample_size": "confirmed"},
        usages={
            section_extraction.NAME: LlmUsage(100, 10, ["x0", "x1"]),
            verify.NAME: LlmUsage(50, 5, ["v1"]),
            entailment.NAME: LlmUsage(7, 1, ["e1"]),
        },
    )
    sink = RecordingUsageSink()

    result = await extraction(db_session, fake, usage_sink=sink).run_from_request(
        request(entity_type_id=SEED.primary_entity_type), engine=_VERIFIED
    )

    run = await db_session.get(ExtractionRun, UUID(result.extraction_run_id))
    assert run is not None
    await db_session.refresh(run)
    (extract_call,) = fake.field_calls()
    assert sorted(
        (e.pass_kind, e.prompt_version, e.usage.request_ids[-1], e.outcome) for e in sink.entries
    ) == [
        ("entailment", entailment.VERSION, "e1", "ok"),
        ("entailment", entailment.VERSION, "e1", "ok"),
        ("extract", extract_call.prompt_version, "x1", "ok"),
        ("verify", verify.VERSION, "v1", "ok"),
    ]
    assert {(e.ctx.project_id, e.ctx.run_id, e.ctx.owner_id) for e in sink.entries} == {
        (SEED.primary_project, run.id, SEED.primary_profile)
    }
    assert {(e.ctx.provider, e.ctx.model) for e in sink.entries} == {("openai", "gpt-5.6-luna")}
    assert run.results["tokens"] == {"prompt": 164, "completion": 17, "total": 181}
    assert sink.ok_sum() == run.results["tokens"]
    assert not {"tokens_prompt", "tokens_completion", "tokens_total"} & set(run.results)


async def test_multi_section_run_entries_sum_to_reported_usage(db_session: AsyncSession) -> None:
    """A top-level sweep with an entry group: one identify call for the group,
    one extract per entry and per singleton section; ``results.tokens`` and
    each section's ``tokens`` add up to the ledger entries."""
    (group,) = await _sections(db_session, ("models_x", ("model_name",)))
    await db_session.execute(
        text(
            "UPDATE extraction_entity_types SET cardinality='many', entry_label='model' "
            "WHERE id=:id"
        ),
        {"id": group},
    )
    await db_session.execute(
        text("UPDATE extraction_fields SET is_entity_key=true WHERE entity_type_id=:id"),
        {"id": group},
    )
    # The run reads the published snapshot: publish the group's new shape.
    await TemplateVersionService(db_session).republish(
        project_id=SEED.primary_project,
        project_template_id=SEED.primary_template,
        user_id=SEED.primary_profile,
    )
    run = await run_in_extract(db_session)
    await seed_article_text(db_session)
    fake = RecordedLlm(
        entries=["A", "B"],
        usages={
            entry_identification.NAME: LlmUsage(3, 1, ["i1"]),
            section_extraction.NAME: LlmUsage(20, 2),
        },
    )
    sink = RecordingUsageSink()

    result = await extraction(db_session, fake, usage_sink=sink).run_from_request(
        request(run_id=run.id)
    )

    await db_session.refresh(run)
    extracts = len(fake.field_calls())
    assert extracts >= 3, "precondition: two entries and at least one singleton section"
    assert [e.pass_kind for e in sink.entries].count("identify") == 1
    assert [e.pass_kind for e in sink.entries].count("extract") == extracts
    expected = {"prompt": 3 + 20 * extracts, "completion": 1 + 2 * extracts}
    expected["total"] = expected["prompt"] + expected["completion"]
    assert run.results["tokens"] == expected == sink.ok_sum()
    assert "total_tokens_used" not in run.results
    ok_sections = [s for s in result.sections if s["success"]]
    assert all("tokens_used" not in s for s in result.sections)
    assert sum(s["tokens"]["total"] for s in ok_sections) == expected["total"]
    (group_section,) = [s for s in ok_sections if s["entity_type_id"] == str(group)]
    assert group_section["tokens"] == {"prompt": 43, "completion": 5, "total": 48}


async def test_a_standalone_entry_batch_reports_one_tokens_shape(
    db_session: AsyncSession,
) -> None:
    """The per-entry batch that owns its run completes it with ``tokens``
    summed over its sections; no ``total_tokens_used`` is written."""
    parent, _children = await _entry_with_children(
        db_session, ("first_child", ("a",)), ("second_child", ("b",))
    )
    await _no_live_run(db_session)
    await seed_article_text(db_session)
    sink = RecordingUsageSink()

    result = await extraction(
        db_session, RecordedLlm(usage=LlmUsage(11, 2)), usage_sink=sink
    ).run_from_request(request(parent_instance_id=parent, extract_all_sections=True))

    run = await db_session.get(ExtractionRun, UUID(result.extraction_run_id))
    assert run is not None
    await db_session.refresh(run)
    assert run.status == "completed"
    assert run.results["tokens"] == {"prompt": 22, "completion": 4, "total": 26}
    assert run.results["tokens"] == sink.ok_sum()
    assert "total_tokens_used" not in run.results
    assert [s["tokens"]["total"] for s in result.sections] == [13, 13]


# --------------------------------------------------------------------------
# Durability: ``LedgerSink`` on its own engine, against committed parents
# --------------------------------------------------------------------------


@dataclass(frozen=True)
class _Parents:
    project_id: UUID
    run_id: UUID
    attempt_id: UUID
    batch_id: UUID


@pytest.fixture
async def committed_ledger_parents(graph: Any) -> AsyncIterator[_Parents]:
    """A committed run, attempt and batch (with one item linked to the
    attempt) on a throwaway project; the ledger sink's own connections can
    reference them. The project delete in ``graph``'s finalizer
    cascades to every row created here, ledger rows included."""
    db, scope, _iid, _fid = graph
    attempt = ExtractionAttempt(
        request_id=uuid4(),
        owner_id=SEED.primary_profile,
        project_id=scope.project_id,
        article_id=scope.article_id,
        template_id=scope.template_id,
        run_id=scope.run_id,
        request_payload={},
    )
    db.add(attempt)
    await db.flush()
    batch = ExtractionBatch(
        owner_id=SEED.primary_profile,
        project_id=scope.project_id,
        template_id=scope.template_id,
    )
    db.add(batch)
    await db.flush()
    db.add(
        ExtractionBatchItem(
            batch_id=batch.id,
            article_id=scope.article_id,
            attempt_id=attempt.id,
            status="dispatched",
        )
    )
    await db.commit()
    yield _Parents(scope.project_id, scope.run_id, attempt.id, batch.id)


def _ctx(parents: _Parents, **overrides: Any) -> UsageContext:
    return UsageContext(
        **{
            "project_id": parents.project_id,
            "owner_id": SEED.primary_profile,
            "run_id": parents.run_id,
            "attempt_id": parents.attempt_id,
            "provider": "openai",
            "model": "gpt-5.6-luna",
            "key_scope": "user_byok",
            **overrides,
        }
    )


class _NoFields(BaseModel):
    """An output with no fields: the fake's reply validates into it whatever
    the prompt, and the durability tests read only the ledger."""


async def _ask(llm: Any, prompt_name: str) -> Any:
    return await llm(
        output_model=_NoFields,
        system_prompt="sys",
        user_prompt="user",
        model=None,
        prompt_name=prompt_name,
        prompt_version="v-ledger",
    )


async def _rows(engine: AsyncEngine, project_id: UUID) -> list[AiUsageLedger]:
    async with async_sessionmaker(engine, expire_on_commit=False)() as s:
        return list(
            (
                await s.scalars(
                    select(AiUsageLedger)
                    .where(AiUsageLedger.project_id == project_id)
                    .order_by(AiUsageLedger.created_at, AiUsageLedger.pass_kind)
                )
            ).all()
        )


def _recorded(fail: dict[str, BaseException] | None = None) -> RecordedLlm:
    return RecordedLlm(
        usages={section_extraction.NAME: LlmUsage(40, 8, ["req-ok"])}, fail=fail or {}
    )


async def test_rows_survive_the_outer_rollback(
    committed_ledger_parents: _Parents, _engine: AsyncEngine
) -> None:
    parents = committed_ledger_parents
    llm = metered(
        _recorded({verify.NAME: RuntimeError("verify down")}),
        LedgerSink(create_ledger_session_factory(_engine)),
        lambda: _ctx(parents),
    )

    async with async_sessionmaker(_engine)() as outer:
        await outer.begin()
        await outer.execute(
            text("UPDATE extraction_runs SET status='running' WHERE id=:id"),
            {"id": parents.run_id},
        )
        await _ask(llm, section_extraction.NAME)
        with pytest.raises(RuntimeError, match="verify down"):
            await _ask(llm, verify.NAME)
        await outer.rollback()

    rows = await _rows(_engine, parents.project_id)
    assert sorted(
        (r.pass_kind, r.outcome, r.prompt_tokens, r.completion_tokens, r.total_tokens, r.request_id)
        for r in rows
    ) == [
        ("extract", "ok", 40, 8, 48, "req-ok"),
        ("verify", "failed", 0, 0, 0, None),
    ]
    assert {(r.run_id, r.attempt_id, r.owner_id, r.key_scope) for r in rows} == {
        (parents.run_id, parents.attempt_id, SEED.primary_profile, "user_byok")
    }


async def test_batch_id_resolved_from_attempt(
    committed_ledger_parents: _Parents, _engine: AsyncEngine
) -> None:
    parents = committed_ledger_parents
    llm = metered(
        _recorded(), LedgerSink(create_ledger_session_factory(_engine)), lambda: _ctx(parents)
    )
    lookups: list[str] = []

    def count(_conn: Any, _cursor: Any, statement: str, *_rest: Any) -> None:
        if "extraction_batch_items" in statement:
            lookups.append(statement)

    event.listen(_engine.sync_engine, "before_cursor_execute", count)
    try:
        await _ask(llm, section_extraction.NAME)
        await _ask(llm, entailment.NAME)
    finally:
        event.remove(_engine.sync_engine, "before_cursor_execute", count)

    rows = await _rows(_engine, parents.project_id)
    assert [r.batch_id for r in rows] == [parents.batch_id, parents.batch_id]
    assert len(lookups) == 1


async def test_run_delete_nulls_run_id(
    committed_ledger_parents: _Parents, _engine: AsyncEngine
) -> None:
    parents = committed_ledger_parents
    llm = metered(
        _recorded(), LedgerSink(create_ledger_session_factory(_engine)), lambda: _ctx(parents)
    )
    await _ask(llm, section_extraction.NAME)

    async with async_sessionmaker(_engine)() as s:
        await s.execute(text("DELETE FROM extraction_runs WHERE id=:id"), {"id": parents.run_id})
        await s.commit()

    (row,) = await _rows(_engine, parents.project_id)
    assert row.run_id is None
    assert (row.pass_kind, row.outcome, row.total_tokens) == ("extract", "ok", 48)


async def test_sink_write_failure_surfaces(
    committed_ledger_parents: _Parents, _engine: AsyncEngine
) -> None:
    """A row that cannot be written fails the successful call it meters."""
    parents = committed_ledger_parents
    llm = metered(
        _recorded(),
        LedgerSink(create_ledger_session_factory(_engine)),
        lambda: _ctx(parents, project_id=uuid4()),
    )

    with pytest.raises(UsageLedgerWriteError) as raised:
        await _ask(llm, section_extraction.NAME)

    assert isinstance(raised.value.__cause__, IntegrityError)
    async with async_sessionmaker(_engine)() as s:
        written = await s.scalar(
            select(func.count())
            .select_from(AiUsageLedger)
            .where(AiUsageLedger.attempt_id == parents.attempt_id)
        )
    assert written == 0


async def test_missing_project_is_skipped_and_logged(
    committed_ledger_parents: _Parents, _engine: AsyncEngine
) -> None:
    parents = committed_ledger_parents
    llm = metered(
        _recorded(),
        LedgerSink(create_ledger_session_factory(_engine)),
        lambda: _ctx(parents, project_id=None),
    )

    with capture_logs() as logs:
        output, usage = await _ask(llm, section_extraction.NAME)

    assert usage.total_tokens == 48
    assert await _rows(_engine, parents.project_id) == []
    (skipped,) = [e for e in logs if e["event"] == "usage_ledger_skipped"]
    assert skipped["log_level"] == "warning"
    assert skipped["pass_kind"] == "extract"
    assert skipped["attempt_id"] == str(parents.attempt_id)
