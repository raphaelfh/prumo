"""``evidence_repair``: dry run by default, ``--apply`` touches exactly the
reported AI rows, ``stamp-versions`` apply is serialized against reparses,
``reparse`` is manager-gated and project-scoped."""

from __future__ import annotations

import json
import uuid
from typing import Any
from uuid import UUID

import pytest
from sqlalchemy import event, text
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker

from app.models.extraction_workflow import ExtractionReviewerDecision
from app.services import evidence_repair
from app.services.article_file_service import ArticleFileService, ParseEnqueueError
from app.services.evidence_repair import (
    RepairAction,
    format_report,
    llm_pages,
    reparse_project,
    stamp_versions,
)
from tests.integration.conftest import SEED, make_proposal
from tests.integration.test_document_parsing_service import (
    LAYOUT_SHIFTED,
    LAYOUT_V1,
    OTHER,
    QUOTE,
    ScriptedParser,
    _add_evidence,
    _ai_record,
    _file_version,
    _insert_article_file,
    _parsed_file,
    _row,
)

#: A quote that is on no page of any layout: re-anchoring fails.
MISSING = "A sentence that no layout contains."


async def _set(db: AsyncSession, evidence_id: UUID, **values: Any) -> None:
    """Shape a row as legacy data (raw SQL: positions are JSON text)."""
    sets = ", ".join(
        f"{k} = CAST(:{k} AS jsonb)" if k == "position" else f"{k} = :{k}" for k in values
    )
    params = {k: (json.dumps(v) if k == "position" else v) for k, v in values.items()}
    await db.execute(
        text(f"UPDATE public.extraction_evidence SET {sets} WHERE id = :id"),  # noqa: S608
        {**params, "id": evidence_id},
    )


async def _llm_page_row(db: AsyncSession, *, run_id: UUID, file_id: UUID, **links: Any) -> UUID:
    """Legacy unanchored row carrying a model-supplied page."""
    evidence_id = await _add_evidence(
        db, run_id=run_id, file_id=file_id, grounded=False, content_version=None, **links
    )
    await _set(db, evidence_id, page_number=7)
    return evidence_id


async def _human_and_decision(db: AsyncSession, run_id: UUID) -> tuple[UUID, UUID]:
    human = await make_proposal(
        db,
        run_id=run_id,
        instance_id=SEED.primary_instance,
        field_id=SEED.primary_field,
        user_id=SEED.primary_profile,
    )
    decision = ExtractionReviewerDecision(
        run_id=run_id,
        instance_id=SEED.primary_instance,
        field_id=SEED.primary_field,
        reviewer_id=SEED.primary_profile,
        decision="edit",
        value={"value": 142},
    )
    db.add(decision)
    await db.flush()
    return human, decision.id


class _Fixture:
    """One parsed file (layout v1) with one row per repair action."""

    file_id: UUID
    clear: UUID
    current: UUID
    reanchor: UUID
    stale: UUID
    anchored_ok: UUID
    human_rows: list[UUID]


async def _fixture(db: AsyncSession) -> _Fixture:
    fx = _Fixture()
    fx.file_id, _ = await _parsed_file(db, ScriptedParser(LAYOUT_V1))
    run_id, record = await _ai_record(db)
    ai = {"proposal_record_id": record}
    fx.clear = await _llm_page_row(db, run_id=run_id, file_id=fx.file_id, **ai)
    fx.current = await _add_evidence(
        db, run_id=run_id, file_id=fx.file_id, content_version=None, **ai
    )
    # Grounded, range no longer slices to the quote, but the quote is on page 1.
    fx.reanchor = await _add_evidence(
        db, run_id=run_id, file_id=fx.file_id, content_version=None, **ai
    )
    pos = (await _row(db, fx.reanchor))["position"]
    pos["anchor"]["range"] = {"page": 2, "charStart": 0, "charEnd": len(QUOTE)}
    pos["anchor"]["quote"] = "the quote as the model recorded it"
    await _set(db, fx.reanchor, position=pos, page_number=2)
    # Grounded, range does not slice to the text, and the text is nowhere.
    fx.stale = await _add_evidence(
        db, run_id=run_id, file_id=fx.file_id, content_version=None, **ai
    )
    await _set(db, fx.stale, text_content=MISSING)
    # Already versioned: nothing to do.
    fx.anchored_ok = await _add_evidence(db, run_id=run_id, file_id=fx.file_id, **ai)

    human, decision = await _human_and_decision(db, run_id)
    fx.human_rows = []
    for links in ({"proposal_record_id": human}, {"reviewer_decision_id": decision}):
        fx.human_rows.append(await _llm_page_row(db, run_id=run_id, file_id=fx.file_id, **links))
        fx.human_rows.append(
            await _add_evidence(
                db, run_id=run_id, file_id=fx.file_id, content_version=None, **links
            )
        )
    await db.commit()
    return fx


def _all_ids(fx: _Fixture) -> list[UUID]:
    return [fx.clear, fx.current, fx.reanchor, fx.stale, fx.anchored_ok, *fx.human_rows]


def _mine(report_ids: list[UUID], fx: _Fixture) -> set[UUID]:
    """The report's ids restricted to this test's rows (the DB is shared)."""
    return set(report_ids) & set(_all_ids(fx))


async def test_dry_run_writes_nothing(db_session: AsyncSession) -> None:
    fx = await _fixture(db_session)
    before = {i: await _row(db_session, i) for i in _all_ids(fx)}

    pages = await llm_pages(db_session, apply=False)
    versions = await stamp_versions(db_session, apply=False)

    assert not pages.applied and not versions.applied
    assert _mine(pages.row_ids[RepairAction.CLEAR_LLM_PAGE], fx) == {fx.clear}
    assert pages.per_project[SEED.primary_project][RepairAction.CLEAR_LLM_PAGE] >= 1
    assert _mine(versions.row_ids[RepairAction.STAMP_CURRENT], fx) == {fx.current}
    assert _mine(versions.row_ids[RepairAction.REANCHOR], fx) == {fx.reanchor}
    assert _mine(versions.row_ids[RepairAction.STAMP_STALE], fx) == {fx.stale}
    counts = versions.per_project[SEED.primary_project]
    assert counts[RepairAction.STAMP_CURRENT] >= 1 and counts[RepairAction.REANCHOR] >= 1
    assert {i: await _row(db_session, i) for i in _all_ids(fx)} == before
    # The session is still writable after a dry run (the read-only scope ended).
    await _set(db_session, fx.clear, rank=1)


async def test_dry_run_is_read_only_on_the_server(db_session: AsyncSession) -> None:
    """A write attempted inside the dry run's scope is refused by Postgres."""
    from sqlalchemy.exc import DBAPIError

    async with evidence_repair._read_only(db_session):
        with pytest.raises(DBAPIError, match="read-only"):
            await db_session.execute(text("CREATE TEMP TABLE _repair_probe (x int)"))


async def test_apply_touches_exactly_the_reported_rows(db_session: AsyncSession) -> None:
    fx = await _fixture(db_session)
    before = {i: await _row(db_session, i) for i in _all_ids(fx)}
    dry_pages = await llm_pages(db_session, apply=False)
    dry_versions = await stamp_versions(db_session, apply=False)

    pages = await llm_pages(db_session, apply=True)
    versions = await stamp_versions(db_session, apply=True)

    assert pages.applied and versions.applied
    after = {i: await _row(db_session, i) for i in _all_ids(fx)}
    changed = {i for i in after if after[i] != before[i]}
    reported_dry = {
        i
        for report in (dry_pages, dry_versions)
        for action, ids in report.row_ids.items()
        if action is not RepairAction.NONE
        for i in ids
    }
    reported_apply = {
        i
        for report in (pages, versions)
        for action, ids in report.row_ids.items()
        if action is not RepairAction.NONE
        for i in ids
    }
    assert changed == reported_dry & set(_all_ids(fx)) == reported_apply & set(_all_ids(fx))
    assert changed == {fx.clear, fx.current, fx.reanchor, fx.stale}

    assert (after[fx.clear]["page_number"], after[fx.clear]["attribution_label"]) == (
        None,
        "ungroundable",
    )
    version = await _file_version(db_session, fx.file_id)
    assert after[fx.current]["content_version"] == version
    assert after[fx.current]["position"] == before[fx.current]["position"]
    assert after[fx.reanchor]["content_version"] == version
    assert after[fx.reanchor]["page_number"] == 1
    assert after[fx.reanchor]["position"]["anchor"]["range"] == {
        "page": 1,
        "charStart": before[fx.current]["position"]["anchor"]["range"]["charStart"],
        "charEnd": before[fx.current]["position"]["anchor"]["range"]["charEnd"],
    }
    assert after[fx.stale]["content_version"] == version - 1
    assert after[fx.stale]["position"] == before[fx.stale]["position"]
    for i in _all_ids(fx):
        assert after[i]["text_content"] == before[i]["text_content"]
        quote = (before[i]["position"] or {}).get("anchor", {}).get("quote")
        assert (after[i]["position"] or {}).get("anchor", {}).get("quote") == quote


async def test_human_and_decision_evidence_untouched(db_session: AsyncSession) -> None:
    fx = await _fixture(db_session)
    before = {i: await _row(db_session, i) for i in fx.human_rows}
    assert any(r["page_number"] == 7 and r["position"] == {} for r in before.values())
    assert any(r["position"] and r["content_version"] is None for r in before.values())

    reports = [
        await llm_pages(db_session, apply=False),
        await stamp_versions(db_session, apply=False),
        await llm_pages(db_session, apply=True),
        await stamp_versions(db_session, apply=True),
    ]

    reported = {i for r in reports for ids in r.row_ids.values() for i in ids}
    assert reported.isdisjoint(fx.human_rows)
    assert {i: await _row(db_session, i) for i in fx.human_rows} == before


async def test_stamp_apply_rereads_after_a_reparse_between_classify_and_apply(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    file_id, service = await _parsed_file(db_session, ScriptedParser(LAYOUT_V1, LAYOUT_SHIFTED))
    run_id, record = await _ai_record(db_session)
    a = await _add_evidence(
        db_session, run_id=run_id, file_id=file_id, proposal_record_id=record, content_version=None
    )
    b = await _add_evidence(
        db_session, run_id=run_id, file_id=file_id, proposal_record_id=record, content_version=None
    )
    await db_session.commit()
    dry = await stamp_versions(db_session, apply=False)
    assert {a, b} <= set(dry.row_ids[RepairAction.STAMP_CURRENT])

    # The reparse lands after apply listed its candidates and before it takes
    # this file's lock; a row C is written against the new blocks meanwhile.
    real_lock = evidence_repair.lock_file_blocks
    c_holder: list[UUID] = []

    async def reparse_then_lock(db: AsyncSession, locked_file: UUID) -> None:
        if locked_file == file_id and not c_holder:
            await service.parse_article_file(file_id)
            c_holder.append(
                await _add_evidence(
                    db,
                    run_id=run_id,
                    file_id=file_id,
                    proposal_record_id=record,
                    content_version=None,
                )
            )
        await real_lock(db, locked_file)

    monkeypatch.setattr(evidence_repair, "lock_file_blocks", reparse_then_lock)
    reparsed = {i: await _row(db_session, i) for i in (a, b)}  # before the reparse

    applied = await stamp_versions(db_session, apply=True)

    (c,) = c_holder
    assert await _file_version(db_session, file_id) == 2
    for i in (a, b):
        row = await _row(db_session, i)
        assert row["content_version"] == 2  # the reparse's version, not the dry run's 1
        assert row["page_number"] == 2
        assert row["position"]["anchor"]["range"]["page"] == 2
        assert row["position"] != reparsed[i]["position"]
        assert i in applied.row_ids[RepairAction.NONE]
        assert all(i not in ids for act, ids in applied.row_ids.items() if act != RepairAction.NONE)
    # C was classified against the new blocks and version.
    assert c in applied.row_ids[RepairAction.STAMP_CURRENT]
    row_c = await _row(db_session, c)
    assert (row_c["content_version"], row_c["page_number"]) == (2, 2)
    assert row_c["position"]["anchor"]["range"]["charStart"] == len(OTHER) + 1


async def test_stamp_apply_takes_the_parse_lock_before_reading(db_session: AsyncSession) -> None:
    fx = await _fixture(db_session)
    statements: list[tuple[str, Any]] = []
    conn = await db_session.connection()

    def record(_conn, _cursor, statement, parameters, _context, _executemany) -> None:  # noqa: ANN001
        statements.append((statement, parameters))

    event.listen(conn.sync_connection, "before_cursor_execute", record)
    try:
        await stamp_versions(db_session, apply=True)
    finally:
        event.remove(conn.sync_connection, "before_cursor_execute", record)

    def params_contain(parameters: Any, value: str) -> bool:
        values = parameters.values() if isinstance(parameters, dict) else parameters or ()
        return any(v == value or v == UUID(value) for v in values)

    file_key = str(fx.file_id)
    lock_at = next(
        n
        for n, (sql, params) in enumerate(statements)
        if "pg_advisory_xact_lock(hashtextextended(" in sql and params_contain(params, file_key)
    )
    version_reads = [
        n
        for n, (sql, params) in enumerate(statements)
        if "FROM public.article_files" in sql
        and "content_version" in sql
        and params_contain(params, file_key)
    ]
    updates = [
        n
        for n, (sql, params) in enumerate(statements)
        if sql.lstrip().upper().startswith("UPDATE PUBLIC.EXTRACTION_EVIDENCE")
        and any(params_contain(params, str(i)) for i in (fx.current, fx.reanchor, fx.stale))
    ]
    assert version_reads and len(updates) == 3
    assert all(lock_at < n for n in version_reads + updates)


async def _main_file(db: AsyncSession, *, project_id: UUID, role: str = "MAIN") -> UUID:
    article_id = uuid.uuid4()
    await db.execute(
        text(
            "INSERT INTO public.articles (id, project_id, title, row_version)"
            " VALUES (:id, :pid, 'evidence-repair', 1)"
        ),
        {"id": article_id, "pid": project_id},
    )
    file_id = await _insert_article_file(db, project_id=project_id, article_id=article_id)
    if role != "MAIN":
        await db.execute(
            text(
                "UPDATE public.article_files SET file_role = CAST(:r AS file_role) WHERE id = :id"
            ),
            {"r": role, "id": file_id},
        )
    return file_id


async def test_reparse_requires_a_manager_and_lists_main_files(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    mine = [await _main_file(db_session, project_id=SEED.primary_project) for _ in range(2)]
    supplement = await _main_file(db_session, project_id=SEED.primary_project, role="SUPPLEMENT")
    foreign = await _main_file(db_session, project_id=SEED.secondary_project)
    await db_session.commit()

    for user in (SEED.reviewer_profile, SEED.outsider_profile):
        with pytest.raises(ValueError, match="manager"):
            await reparse_project(
                db_session,
                project_id=SEED.primary_project,
                as_user=user,
                apply=False,
                trace_id="t",
            )

    dry = await reparse_project(
        db_session,
        project_id=SEED.primary_project,
        as_user=SEED.primary_profile,
        apply=False,
        trace_id="t",
    )
    listed = dry.row_ids[RepairAction.REPARSE]
    assert set(mine) <= set(listed)
    assert supplement not in listed and foreign not in listed
    assert list(dry.per_project) == [SEED.primary_project]

    calls: list[UUID] = []

    async def fake_enqueue(_self, article_file, *, project_id, user_id, trace_id) -> None:  # noqa: ANN001
        assert (project_id, user_id, trace_id) == (
            SEED.primary_project,
            str(SEED.primary_profile),
            "t",
        )
        calls.append(article_file.id)
        if len(calls) == 1:
            raise ParseEnqueueError("broker down")

    monkeypatch.setattr(ArticleFileService, "_enqueue_or_fail", fake_enqueue)
    applied = await reparse_project(
        db_session,
        project_id=SEED.primary_project,
        as_user=SEED.primary_profile,
        apply=True,
        trace_id="t",
    )

    assert sorted(calls) == sorted(listed)  # each listed file once, foreign never
    assert applied.row_ids[RepairAction.REPARSE_FAILED] == [calls[0]]
    assert set(applied.row_ids[RepairAction.REPARSE]) == set(listed) - {calls[0]}
    assert applied.per_project[SEED.primary_project][RepairAction.REPARSE_FAILED] == 1


def test_main_prints_the_report(
    _engine: AsyncEngine, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    from app.core import deps

    monkeypatch.setattr(
        deps, "AsyncSessionLocal", async_sessionmaker(_engine, expire_on_commit=False)
    )

    assert evidence_repair.main(["llm-pages"]) == 0

    out = capsys.readouterr().out
    assert out.startswith("evidence_repair llm-pages (dry run)")
    assert "Total:" in out


def test_format_report_lists_projects_and_totals() -> None:
    project = uuid.UUID("00000000-0000-0000-0000-0000000000aa")
    report = evidence_repair.RepairReport(
        command="stamp-versions",
        applied=True,
        per_project={},
        row_ids={},
    )
    first, second = uuid.uuid4(), uuid.uuid4()
    report.record(project, RepairAction.STAMP_CURRENT, first)
    report.record(project, RepairAction.STAMP_STALE, second)

    assert format_report(report) == (
        "evidence_repair stamp-versions (applied)\n"
        f"project {project}: stamp_current=1 stamp_stale=1\n"
        "Total: stamp_current=1 stamp_stale=1"
    )


def test_main_requires_project_and_user_for_reparse(capsys: pytest.CaptureFixture[str]) -> None:
    with pytest.raises(SystemExit):
        evidence_repair.main(["reparse"])
    assert "--project" in capsys.readouterr().err


@pytest.mark.parametrize("command", ["llm-pages", "stamp-versions"])
@pytest.mark.parametrize("flag", ["--project", "--as-user"])
def test_main_refuses_reparse_flags_on_global_commands(
    command: str, flag: str, capsys: pytest.CaptureFixture[str], monkeypatch: pytest.MonkeyPatch
) -> None:
    """The global commands repair every project; a scope flag they would
    silently ignore is a usage error, before any database work."""

    async def must_not_run(_args: object) -> None:
        raise AssertionError("ran despite a usage error")

    monkeypatch.setattr(evidence_repair, "_run", must_not_run)
    with pytest.raises(SystemExit) as exited:
        evidence_repair.main([command, flag, str(uuid.uuid4())])
    assert exited.value.code == 2
    assert f"{command} does not take --project or --as-user" in capsys.readouterr().err


async def test_file_without_blocks_reports_none_and_writes_nothing(
    db_session: AsyncSession,
) -> None:
    parsed, _ = await _parsed_file(db_session, ScriptedParser(LAYOUT_V1))
    run_id, record = await _ai_record(db_session)
    evidence_id = await _add_evidence(
        db_session, run_id=run_id, file_id=parsed, proposal_record_id=record, content_version=None
    )
    blockless = await _insert_article_file(
        db_session, project_id=SEED.primary_project, article_id=SEED.primary_article
    )
    await _set(db_session, evidence_id, article_file_id=blockless)
    await db_session.commit()
    before = await _row(db_session, evidence_id)

    dry = await stamp_versions(db_session, apply=False)
    applied = await stamp_versions(db_session, apply=True)

    assert evidence_id in dry.row_ids[RepairAction.NONE]
    assert evidence_id in applied.row_ids[RepairAction.NONE]
    assert await _row(db_session, evidence_id) == before
