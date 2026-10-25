"""PubMed import by PMID: the service on real Postgres, the races, and the two routes.

Every client is ``fixture_client`` over ``httpx.MockTransport``: no test
reaches NCBI. The default handler answers the three-record fixture
(42908551, 42875467, 42706533) whatever ids were asked for, so 49999999 is
always ``not_found``.
"""

from __future__ import annotations

import asyncio
from collections import Counter
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta
from typing import Any
from unittest.mock import MagicMock
from uuid import UUID, uuid4

import httpx
import pytest
from httpx import AsyncClient
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from structlog.testing import capture_logs

from app.api.v1.endpoints import pubmed_import
from app.core.config import settings
from app.main import app
from app.models.article import Article
from app.models.article_author import ArticleSyncEvent, ArticleSyncRun
from app.repositories.article_repository import ArticleSyncRunRepository
from app.services import pubmed_import_service
from app.services.prisma_service import prisma_counts
from app.services.pubmed_client import MAX_ATTEMPTS
from app.services.pubmed_import_service import IMPORT_RUN_STALE_AFTER, PubmedImportService
from app.services.screening_config_service import ScreeningConfigService
from app.worker import queue_health
from tests.integration.conftest import SEED
from tests.integration.helpers.engine_setup import client_as
from tests.integration.helpers.shared_fixtures import (
    FIXTURE_XML,
    barrier_handler,
    fixture_client,
    make_project,
    throwaway_project,
)

P = SEED.primary_project
FOUND = ["42908551", "42875467", "42706533"]
EMPTY_SET = b"<?xml version='1.0'?><PubmedArticleSet></PubmedArticleSet>"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _article(db: AsyncSession, project_id: UUID = P, **fields: Any) -> Article:
    fields.setdefault("title", "T")
    article = Article(project_id=project_id, **fields)
    db.add(article)
    await db.flush()
    return article


async def _new_run(db: AsyncSession, project_id: UUID = P, status: str = "pending") -> UUID:
    run = await ArticleSyncRunRepository(db).create_run(
        project_id=project_id,
        requested_by_user_id=SEED.primary_profile,
        source="pubmed",
        source_collection_key=None,
    )
    if status != "pending":
        run.status = status
        await db.flush()
    return run.id


async def _run_row(db: AsyncSession, run_id: UUID) -> ArticleSyncRun:
    result = await db.execute(
        select(ArticleSyncRun)
        .where(ArticleSyncRun.id == run_id)
        .execution_options(populate_existing=True)
    )
    return result.scalar_one()


async def _events(db: AsyncSession, run_id: UUID) -> list[ArticleSyncEvent]:
    result = await db.execute(
        select(ArticleSyncEvent)
        .where(ArticleSyncEvent.sync_run_id == run_id)
        .execution_options(populate_existing=True)
    )
    return list(result.scalars().all())


def _by_status(events: list[ArticleSyncEvent]) -> Counter[str]:
    return Counter(e.status for e in events)


async def _articles_with_pmid(db: AsyncSession, project_id: UUID, pmid: str) -> int:
    result = await db.execute(
        select(func.count())
        .select_from(Article)
        .where(Article.project_id == project_id, Article.pmid == pmid)
    )
    return int(result.scalar_one())


async def _run_count(db: AsyncSession, project_id: UUID = P) -> int:
    result = await db.execute(
        select(func.count())
        .select_from(ArticleSyncRun)
        .where(ArticleSyncRun.project_id == project_id)
    )
    return int(result.scalar_one())


def _counts(run: ArticleSyncRun) -> tuple[int, int, int, int, int]:
    return (run.total_received, run.persisted, run.updated, run.skipped, run.failed)


async def _import(
    db: AsyncSession, run_id: UUID, pmids: list[str], client: Any = None, **kwargs: Any
) -> str | None:
    return await PubmedImportService(db).run_import(
        project_id=kwargs.pop("project_id", P),
        sync_run_id=run_id,
        pmids=pmids,
        client=client or fixture_client(),
        **kwargs,
    )


# ---------------------------------------------------------------------------
# Service on real Postgres
# ---------------------------------------------------------------------------


async def test_dry_run_counts_and_writes_nothing(db_session: AsyncSession) -> None:
    await _article(db_session, pmid="42908551")
    runs_before = await _run_count(db_session)

    counts = await PubmedImportService(db_session).dry_run(
        P, ["42908551", "42875467", "42875467", "42706533"]
    )

    assert counts.kind == "dry_run"
    assert (
        counts.received,
        counts.distinct,
        counts.duplicate_in_request,
        counts.already_in_project,
        counts.new,
    ) == (4, 3, 1, 1, 2)
    assert await _run_count(db_session) == runs_before


async def test_run_import_writes_one_event_per_received_pmid(db_session: AsyncSession) -> None:
    run_id = await _new_run(db_session)
    pmids = ["42908551", "42875467", "42706533", "49999999", "42908551", "49999999"]

    status = await _import(db_session, run_id, pmids)

    assert status == "completed"
    events = await _events(db_session, run_id)
    assert _by_status(events) == {"inserted": 3, "not_found": 1, "duplicate_in_request": 2}
    assert all(e.event_payload == {"pmid": e.event_payload["pmid"]} for e in events)
    assert all(e.zotero_item_key is None for e in events)
    first = {e.event_payload["pmid"]: e for e in events if e.status != "duplicate_in_request"}
    dups = {e.event_payload["pmid"]: e for e in events if e.status == "duplicate_in_request"}
    assert first["42908551"].article_id is not None
    assert dups["42908551"].article_id == first["42908551"].article_id
    assert first["49999999"].article_id is None
    assert dups["49999999"].article_id is None
    run = await _run_row(db_session, run_id)
    assert _counts(run) == (6, 3, 0, 2, 1)
    assert run.status == "completed"
    assert run.completed_at is not None


async def test_reimport_fills_nothing_and_records_unchanged(db_session: AsyncSession) -> None:
    first_run = await _new_run(db_session)
    await _import(db_session, first_run, FOUND)
    articles_before = [await _articles_with_pmid(db_session, P, p) for p in FOUND]

    second_run = await _new_run(db_session)
    assert await _import(db_session, second_run, FOUND) == "completed"

    assert articles_before == [1, 1, 1]
    assert [await _articles_with_pmid(db_session, P, p) for p in FOUND] == [1, 1, 1]
    run = await _run_row(db_session, second_run)
    assert _counts(run) == (3, 0, 0, 0, 0)
    events = await _events(db_session, second_run)
    assert _by_status(events) == {"unchanged": 3}
    assert all(e.article_id is not None for e in events)


async def test_resuming_a_running_run_duplicates_nothing(db_session: AsyncSession) -> None:
    run_id = await _new_run(db_session)
    pmids = ["42908551", "42875467", "42706533", "49999999", "42908551", "49999999"]
    await _import(db_session, run_id, pmids)
    first_pass = _counts(await _run_row(db_session, run_id))
    # A redelivery after the worker died before completing.
    await db_session.execute(
        text("UPDATE public.article_sync_runs SET status = 'running' WHERE id = :id"),
        {"id": str(run_id)},
    )

    assert await _import(db_session, run_id, pmids) == "completed"

    assert len(await _events(db_session, run_id)) == 6
    run = await _run_row(db_session, run_id)
    assert _counts(run) == first_pass == (6, 3, 0, 2, 1)
    assert run.status == "completed"


async def test_ncbi_failure_fails_its_batch_and_continues(db_session: AsyncSession) -> None:
    calls = {"n": 0}

    def handler(_request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        if calls["n"] <= MAX_ATTEMPTS:  # every attempt of the first batch
            return httpx.Response(500)
        return httpx.Response(200, content=FIXTURE_XML.read_bytes())

    run_id = await _new_run(db_session)

    with capture_logs() as logs:
        status = await _import(db_session, run_id, FOUND, fixture_client(handler), batch_size=2)

    assert status == "completed"
    [failure] = [log for log in logs if log["event"] == "pubmed_efetch_failed"]
    assert failure["log_level"] == "warning"
    assert failure["sync_run_id"] == str(run_id)
    assert failure["pmids"] == ["42908551", "42875467"]
    assert failure["exc_info"] is True
    by_pmid = {e.event_payload["pmid"]: e for e in await _events(db_session, run_id)}
    for pmid in ("42908551", "42875467"):
        assert (by_pmid[pmid].status, by_pmid[pmid].error_code) == ("failed", "NCBI_UNAVAILABLE")
        assert by_pmid[pmid].article_id is None
    assert by_pmid["42706533"].status == "inserted"
    assert _counts(await _run_row(db_session, run_id)) == (3, 1, 0, 0, 2)


async def test_parse_error_fails_one_pmid_and_the_batch_continues(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    real = pubmed_import_service.normalize_pubmed_record

    def flaky(*, record: Any) -> Any:
        if record.findtext("MedlineCitation/PMID") == "42875467":
            raise ValueError("unexpected record shape")
        return real(record=record)

    monkeypatch.setattr(pubmed_import_service, "normalize_pubmed_record", flaky)
    run_id = await _new_run(db_session)

    with capture_logs() as logs:
        assert await _import(db_session, run_id, FOUND) == "completed"

    [failure] = [log for log in logs if log["event"] == "pubmed_parse_failed"]
    assert failure["log_level"] == "warning"
    assert failure["sync_run_id"] == str(run_id)
    assert failure["pmid"] == "42875467"
    assert failure["exc_info"] is True
    by_pmid = {e.event_payload["pmid"]: e for e in await _events(db_session, run_id)}
    assert (by_pmid["42875467"].status, by_pmid["42875467"].error_code) == (
        "failed",
        "PARSE_ERROR",
    )
    assert by_pmid["42875467"].article_id is None
    assert by_pmid["42908551"].status == "inserted"
    assert by_pmid["42706533"].status == "inserted"
    run = await _run_row(db_session, run_id)
    assert run.status == "completed"
    assert run.failed == 1


async def test_batches_are_serial_and_at_most_200(db_session: AsyncSession) -> None:
    sizes: list[int] = []
    state = {"in_flight": False, "overlapped": False}

    async def handler(request: httpx.Request) -> httpx.Response:
        if state["in_flight"]:
            state["overlapped"] = True
        state["in_flight"] = True
        sizes.append(len(request.url.params["id"].split(",")))
        await asyncio.sleep(0)
        state["in_flight"] = False
        return httpx.Response(200, content=EMPTY_SET)

    pmids = [str(40_000_000 + i) for i in range(450)]
    run_id = await _new_run(db_session)

    assert await _import(db_session, run_id, pmids, fixture_client(handler)) == "completed"

    assert sizes == [200, 200, 50]
    assert state["overlapped"] is False
    assert _by_status(await _events(db_session, run_id)) == {"not_found": 450}


@pytest.mark.parametrize("status", ["completed", "failed"], ids=["completed", "failed"])
async def test_terminal_run_is_a_no_op(db_session: AsyncSession, status: str) -> None:
    calls: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        return httpx.Response(200, content=FIXTURE_XML.read_bytes())

    run_id = await _new_run(db_session, status=status)

    assert await _import(db_session, run_id, FOUND, fixture_client(handler)) == status

    assert await _events(db_session, run_id) == []
    assert calls == []
    run = await _run_row(db_session, run_id)
    assert run.status == status
    assert _counts(run) == (0, 0, 0, 0, 0)


async def test_run_import_ignores_another_projects_run(db_session: AsyncSession) -> None:
    run_id = await _new_run(db_session, project_id=SEED.secondary_project)

    assert await _import(db_session, run_id, FOUND, project_id=P) is None

    assert await _events(db_session, run_id) == []
    assert (await _run_row(db_session, run_id)).status == "pending"


async def test_mark_failed_only_moves_live_runs(db_session: AsyncSession) -> None:
    service = PubmedImportService(db_session)
    pending = await _new_run(db_session)
    running = await _new_run(db_session, status="running")
    completed = await _new_run(db_session, status="completed")
    foreign = await _new_run(db_session)

    for run_id in (pending, running, completed):
        await service.mark_failed(project_id=P, sync_run_id=run_id)
    await service.mark_failed(project_id=SEED.secondary_project, sync_run_id=foreign)

    pending_row = await _run_row(db_session, pending)
    assert pending_row.status == "failed"
    assert pending_row.completed_at is not None
    assert (await _run_row(db_session, running)).status == "failed"
    assert (await _run_row(db_session, completed)).status == "completed"
    assert (await _run_row(db_session, foreign)).status == "pending"


@pytest.mark.parametrize("source", ["zotero", "RIS"], ids=["zotero", "ris"])
async def test_pubmed_match_keeps_the_existing_provenance(
    db_session: AsyncSession, source: str
) -> None:
    existing = await _article(
        db_session,
        doi="https://doi.org/10.3389/FENDO.2026.1959304",
        abstract=None,
        ingestion_source=source,
        source_payload={"key": "K"},
    )
    run_id = await _new_run(db_session)

    assert await _import(db_session, run_id, ["42908551"]) == "completed"

    events = await _events(db_session, run_id)
    assert [(e.status, e.article_id) for e in events] == [("updated", existing.id)]
    await db_session.refresh(existing)
    assert existing.ingestion_source == source
    assert existing.source_payload == {"key": "K"}
    assert existing.abstract
    assert await _articles_with_pmid(db_session, P, "42908551") == 1


def _failing_for(ids: set[str]) -> Any:
    """503 for any batch holding one of ``ids``; the fixture XML otherwise."""
    requested: list[list[str]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        batch = request.url.params["id"].split(",")
        requested.append(batch)
        if ids & set(batch):
            return httpx.Response(503)
        return httpx.Response(200, content=FIXTURE_XML.read_bytes())

    handler.requested = requested  # type: ignore[attr-defined]
    return handler


async def test_three_consecutive_failed_batches_fail_the_run(db_session: AsyncSession) -> None:
    pmids = ["42908551", "42875467", "42706533", "49999999"]
    handler = _failing_for(set(pmids))
    run_id = await _new_run(db_session)

    with capture_logs() as logs:
        status = await _import(db_session, run_id, pmids, fixture_client(handler), batch_size=1)

    assert status == "failed"
    assert len(handler.requested) == 3 * MAX_ATTEMPTS  # the fourth batch is never sent
    by_pmid = {e.event_payload["pmid"]: e for e in await _events(db_session, run_id)}
    assert {p: (e.status, e.error_code) for p, e in by_pmid.items()} == {
        "42908551": ("failed", "NCBI_UNAVAILABLE"),
        "42875467": ("failed", "NCBI_UNAVAILABLE"),
    }
    run = await _run_row(db_session, run_id)
    assert (run.status, run.failure_summary) == ("failed", {"error_code": "NCBI_UNAVAILABLE"})
    assert run.completed_at is not None
    [aborted] = [log for log in logs if log["event"] == "pubmed_import_ncbi_unavailable"]
    assert aborted["exc_info"] is True
    assert aborted["sync_run_id"] == str(run_id)


async def test_a_success_between_failed_batches_resets_the_streak(
    db_session: AsyncSession,
) -> None:
    # fail, fail, ok, fail, fail: never three in a row.
    pmids = ["40000001", "40000002", "42908551", "40000003", "40000004"]
    handler = _failing_for({"40000001", "40000002", "40000003", "40000004"})
    run_id = await _new_run(db_session)

    status = await _import(db_session, run_id, pmids, fixture_client(handler), batch_size=1)

    assert status == "completed"
    assert _by_status(await _events(db_session, run_id)) == {"failed": 4, "inserted": 1}
    assert (await _run_row(db_session, run_id)).failure_summary is None


async def _backdate(db: AsyncSession, run_id: UUID, by: timedelta) -> None:
    await db.execute(
        text("UPDATE public.article_sync_runs SET created_at = :at WHERE id = :id"),
        {"at": datetime.now(UTC) - by, "id": str(run_id)},
    )


async def test_task_start_fails_a_stale_run_without_fetching(db_session: AsyncSession) -> None:
    calls: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        return httpx.Response(200, content=FIXTURE_XML.read_bytes())

    run_id = await _new_run(db_session)
    await _backdate(db_session, run_id, IMPORT_RUN_STALE_AFTER + timedelta(minutes=1))

    assert await _import(db_session, run_id, FOUND, fixture_client(handler)) == "failed"

    assert calls == []
    assert await _events(db_session, run_id) == []
    run = await _run_row(db_session, run_id)
    assert (run.status, run.failure_summary) == ("failed", {"error_code": "IMPORT_STALE"})


@pytest.mark.parametrize("status", ["pending", "running"])
async def test_poll_reports_a_stale_live_run_as_failed_without_writing(
    db_session: AsyncSession, status: str
) -> None:
    stale = await _new_run(db_session, status=status)
    fresh = await _new_run(db_session, status=status)
    await _backdate(db_session, stale, IMPORT_RUN_STALE_AFTER + timedelta(minutes=1))
    await _backdate(db_session, fresh, IMPORT_RUN_STALE_AFTER - timedelta(minutes=1))
    service = PubmedImportService(db_session)

    stale_read = await service.get_run(
        project_id=P, requester_id=SEED.primary_profile, sync_run_id=stale
    )
    fresh_read = await service.get_run(
        project_id=P, requester_id=SEED.primary_profile, sync_run_id=fresh
    )

    assert (stale_read.status, stale_read.error_code) == ("failed", "IMPORT_STALE")
    assert (fresh_read.status, fresh_read.error_code) == (status, None)
    assert (await _run_row(db_session, stale)).status == status


async def test_poll_reports_outcome_counts_from_events(db_session: AsyncSession) -> None:
    await _article(
        db_session,
        pmid="42706533",
        abstract="A",
        mesh_terms=["M"],
        pmcid="PMC1",
        keywords=["k"],
        article_type="Letter",
        language="eng",
        volume="1",
        issue="2",
        pages="3",
    )
    handler = _failing_for({"40000001"})
    run_id = await _new_run(db_session)
    pmids = ["42908551", "49999999", "40000001", "42706533", "42908551"]

    await _import(db_session, run_id, pmids, fixture_client(handler), batch_size=1)
    read = await PubmedImportService(db_session).get_run(
        project_id=P, requester_id=SEED.primary_profile, sync_run_id=run_id
    )

    assert (read.persisted, read.unchanged, read.skipped) == (1, 1, 1)
    assert (read.not_found, read.fetch_failed, read.failed) == (1, 1, 2)
    assert read.error_code is None


def _complete_record(pmid: str) -> str:
    """A PubmedArticle that fills every ``PUBMED_FILL_FIELDS`` field."""
    return (
        f"<PubmedArticle><MedlineCitation><PMID>{pmid}</PMID><Article>"
        "<Journal><JournalIssue><Volume>9</Volume><Issue>2</Issue></JournalIssue></Journal>"
        f"<ArticleTitle>Record {pmid}</ArticleTitle><Pagination><MedlinePgn>1-9</MedlinePgn>"
        "</Pagination><Abstract><AbstractText>Text</AbstractText></Abstract>"
        "<Language>eng</Language><PublicationTypeList><PublicationType>Journal Article"
        "</PublicationType></PublicationTypeList></Article>"
        "<MeshHeadingList><MeshHeading><DescriptorName>Humans</DescriptorName></MeshHeading>"
        "</MeshHeadingList><KeywordList><Keyword>k</Keyword></KeywordList></MedlineCitation>"
        f"<PubmedData><ArticleIdList><ArticleId IdType='pmc'>PMC{pmid}</ArticleId>"
        "</ArticleIdList></PubmedData></PubmedArticle>"
    )


async def test_reimporting_complete_records_makes_no_ncbi_request(
    db_session: AsyncSession,
) -> None:
    pmids = ["41000001", "41000002"]
    requested: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        batch = request.url.params["id"].split(",")
        requested.extend(batch)
        body = "".join(_complete_record(p) for p in batch)
        return httpx.Response(200, content=f"<PubmedArticleSet>{body}</PubmedArticleSet>")

    project_id = await make_project(db_session)
    first = await _new_run(db_session, project_id=project_id)
    await _import(db_session, first, pmids, fixture_client(handler), project_id=project_id)
    await ScreeningConfigService(db_session).enroll(project_id, SEED.primary_profile, None)
    prisma_before = await prisma_counts(db_session, project_id)
    assert requested == pmids

    second = await _new_run(db_session, project_id=project_id)
    status = await _import(
        db_session, second, pmids, fixture_client(handler), project_id=project_id
    )

    assert status == "completed"
    assert requested == pmids  # nothing new was asked of NCBI
    events = await _events(db_session, second)
    assert _by_status(events) == {"unchanged": 2}
    assert all(e.article_id is not None for e in events)
    assert await prisma_counts(db_session, project_id) == prisma_before


# ---------------------------------------------------------------------------
# Races (real commits on a throwaway project)
# ---------------------------------------------------------------------------


async def _committed_run(session_factory: async_sessionmaker[AsyncSession], pid: UUID) -> UUID:
    async with session_factory() as s:
        run_id = await _new_run(s, project_id=pid)
        await s.commit()
    return run_id


async def test_concurrent_overlapping_imports_create_no_duplicate_article(
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    pmids = ["42908551", "42875467"]
    async with throwaway_project(session_factory) as pid:
        first = await _committed_run(session_factory, pid)
        second = await _committed_run(session_factory, pid)
        barrier = asyncio.Barrier(2)

        async def deliver(run_id: UUID) -> str | None:
            async with session_factory() as s:
                return await _import(
                    s, run_id, pmids, fixture_client(barrier_handler(barrier)), project_id=pid
                )

        assert await asyncio.gather(deliver(first), deliver(second)) == ["completed"] * 2

        async with session_factory() as s:
            assert [await _articles_with_pmid(s, pid, p) for p in pmids] == [1, 1]
            statuses = _by_status(await _events(s, first) + await _events(s, second))
            assert statuses == {"inserted": 2, "unchanged": 2}


async def test_same_run_delivered_twice_at_once_writes_each_event_once(
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    pmids = ["42908551", "42875467", "42706533", "49999999", "42908551"]
    async with throwaway_project(session_factory) as pid:
        run_id = await _committed_run(session_factory, pid)
        barrier = asyncio.Barrier(2)

        async def deliver() -> str | None:
            async with session_factory() as s:
                return await _import(
                    s, run_id, pmids, fixture_client(barrier_handler(barrier)), project_id=pid
                )

        await asyncio.gather(deliver(), deliver())

        async with session_factory() as s:
            events = await _events(s, run_id)
            assert len(events) == 5
            assert _by_status(events) == {"inserted": 3, "not_found": 1, "duplicate_in_request": 1}
            assert [await _articles_with_pmid(s, pid, p) for p in FOUND] == [1, 1, 1]
            run = await _run_row(s, run_id)
            assert _counts(run) == (5, 3, 0, 1, 1)
            assert run.status == "completed"


async def test_a_run_failed_mid_import_stays_failed(
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    async with throwaway_project(session_factory) as pid:
        run_id = await _committed_run(session_factory, pid)
        calls = {"n": 0}

        async def handler(_request: httpx.Request) -> httpx.Response:
            calls["n"] += 1
            if calls["n"] == 2:
                # The endpoint's failed-enqueue path, landing mid-import.
                async with session_factory() as s2:
                    await PubmedImportService(s2).mark_failed(project_id=pid, sync_run_id=run_id)
                    await s2.commit()
            return httpx.Response(200, content=FIXTURE_XML.read_bytes())

        async with session_factory() as s:
            status = await _import(
                s, run_id, FOUND, fixture_client(handler), project_id=pid, batch_size=1
            )

        assert status == "failed"
        async with session_factory() as s:
            events = await _events(s, run_id)
            assert [e.event_payload["pmid"] for e in events] == ["42908551"]
            assert (await _run_row(s, run_id)).status == "failed"


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@asynccontextmanager
async def _client(profile: UUID, db_session: AsyncSession) -> AsyncIterator[AsyncClient]:
    try:
        async with client_as(str(profile), db_session) as ac:
            yield ac
    finally:
        app.dependency_overrides.clear()


def _import_url(project_id: UUID = P) -> str:
    return f"/api/v1/projects/{project_id}/imports/pubmed"


def _poll_url(sync_run_id: UUID | str, project_id: UUID = P) -> str:
    return f"/api/v1/projects/{project_id}/imports/{sync_run_id}"


@pytest.fixture
def delay(monkeypatch: pytest.MonkeyPatch) -> MagicMock:
    """Email configured, queue up, enqueue recorded: the happy-path environment."""
    monkeypatch.setattr(settings, "NCBI_EMAIL", "dev@prumo.test")
    monkeypatch.setattr(queue_health, "is_queue_available", lambda: True)
    fake = MagicMock()
    monkeypatch.setattr(pubmed_import.import_pubmed_task, "delay", fake)
    return fake


async def test_import_requires_membership(db_session: AsyncSession, delay: MagicMock) -> None:
    async with _client(SEED.outsider_profile, db_session) as ac:
        posted = await ac.post(_import_url(), json={"pmids": ["42908551"]})
        polled = await ac.get(_poll_url(uuid4()))

    assert posted.status_code == 403
    assert polled.status_code == 403
    delay.assert_not_called()


@pytest.mark.parametrize(
    "pmids",
    [[str(i) for i in range(1, 10_002)], ["12a"], []],
    ids=["over-10000", "non-digit", "empty"],
)
async def test_import_validation_is_422(
    db_session: AsyncSession, delay: MagicMock, pmids: list[str]
) -> None:
    async with _client(SEED.primary_profile, db_session) as ac:
        response = await ac.post(_import_url(), json={"pmids": pmids})

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"
    delay.assert_not_called()


async def test_dry_run_needs_no_ncbi_email(
    db_session: AsyncSession, delay: MagicMock, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "NCBI_EMAIL", None)

    async with _client(SEED.primary_profile, db_session) as ac:
        response = await ac.post(_import_url(), json={"pmids": ["42908551"], "dry_run": True})

    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is True
    assert body["data"]["kind"] == "dry_run"
    assert body["data"]["new"] == 1
    delay.assert_not_called()


async def test_import_refuses_without_ncbi_email(
    db_session: AsyncSession, delay: MagicMock, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "NCBI_EMAIL", None)
    runs_before = await _run_count(db_session)

    async with _client(SEED.primary_profile, db_session) as ac:
        response = await ac.post(_import_url(), json={"pmids": ["42908551"]})

    assert response.status_code == 503
    body = response.json()
    assert body["ok"] is False
    assert body["error"]["code"] == "NCBI_EMAIL_NOT_CONFIGURED"
    assert await _run_count(db_session) == runs_before
    delay.assert_not_called()


async def test_import_refuses_when_queue_is_down(
    db_session: AsyncSession, delay: MagicMock, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(queue_health, "is_queue_available", lambda: False)
    runs_before = await _run_count(db_session)

    async with _client(SEED.primary_profile, db_session) as ac:
        response = await ac.post(_import_url(), json={"pmids": ["42908551"]})

    assert response.status_code == 503
    body = response.json()
    assert body["ok"] is False
    assert body["error"]["code"] == "SERVICE_UNAVAILABLE"
    assert await _run_count(db_session) == runs_before
    delay.assert_not_called()


async def test_import_enqueues_after_commit(db_session: AsyncSession, delay: MagicMock) -> None:
    async with _client(SEED.primary_profile, db_session) as ac:
        response = await ac.post(_import_url(), json={"pmids": ["42908551", "42875467"]})

    assert response.status_code == 202
    data = response.json()["data"]
    assert data["kind"] == "started"
    assert data["status"] == "pending"
    delay.assert_called_once()
    kwargs = delay.call_args.kwargs
    assert kwargs["pmids"] == ["42908551", "42875467"]
    assert kwargs["project_id"] == str(P)
    assert kwargs["sync_run_id"] == data["sync_run_id"]
    run = await _run_row(db_session, UUID(data["sync_run_id"]))
    assert (run.source, run.status, run.requested_by_user_id) == (
        "pubmed",
        "pending",
        SEED.primary_profile,
    )


async def test_failed_enqueue_marks_the_run_failed(
    db_session: AsyncSession, delay: MagicMock
) -> None:
    delay.side_effect = ConnectionError("broker down")

    async with _client(SEED.primary_profile, db_session) as ac:
        response = await ac.post(_import_url(), json={"pmids": ["42908551"]})

    assert response.status_code == 503
    assert response.json()["error"]["code"] == "SERVICE_UNAVAILABLE"
    run = await _run_row(db_session, UUID(delay.call_args.kwargs["sync_run_id"]))
    assert run.status == "failed"


async def test_poll_is_bound_to_project_and_requester(
    db_session: AsyncSession, delay: MagicMock
) -> None:
    async with _client(SEED.primary_profile, db_session) as ac:
        started = await ac.post(_import_url(), json={"pmids": ["42908551"]})
        sid = started.json()["data"]["sync_run_id"]
        own = await ac.get(_poll_url(sid))
        other_project = await ac.get(_poll_url(sid, SEED.secondary_project))
    async with _client(SEED.reviewer_profile, db_session) as ac:
        not_requester = await ac.get(_poll_url(sid))
    async with _client(SEED.outsider_profile, db_session) as ac:
        outsider = await ac.get(_poll_url(sid))

    assert own.status_code == 200
    data = own.json()["data"]
    assert data["sync_run_id"] == sid
    assert (data["source"], data["status"]) == ("pubmed", "pending")
    assert (data["total_received"], data["persisted"], data["failed"]) == (0, 0, 0)
    assert data["completed_at"] is None
    assert delay.call_count == 1
    assert not_requester.status_code == 404
    assert other_project.status_code == 404
    assert outsider.status_code == 403
