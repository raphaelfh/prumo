"""PubMed import by PMID through the canonical article path.

The endpoint writes a ``pending`` run and enqueues; the worker's
:meth:`PubmedImportService.run_import` fetches serial efetch batches and
writes one ``article_sync_events`` row per received PMID (repeats included),
so a redelivered or concurrent delivery of the same run never writes a PMID
twice. A PMID whose article already has every fill field is recorded
``unchanged`` without asking NCBI, so a re-import does no work.

A run stops as ``failed`` with an error code in ``failure_summary``: after
``MAX_CONSECUTIVE_FAILED_BATCHES`` failed fetches in a row
(``NCBI_UNAVAILABLE``), at the task's soft time limit (``IMPORT_TIME_LIMIT``),
or when it is still live ``IMPORT_RUN_STALE_AFTER`` after its creation
(``IMPORT_STALE``: written when the task starts on it, derived on poll).

Lock order, everywhere: the per-project advisory lock, then the run row.
:meth:`PubmedImportService.mark_failed` takes only the run row, so the two
orders never invert. Network calls happen outside every lock.
"""

from __future__ import annotations

import xml.etree.ElementTree as ET
from collections import Counter
from collections.abc import Mapping, Sequence
from datetime import UTC, datetime, timedelta
from typing import get_args
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.error_handler import AppError
from app.core.logging import get_logger
from app.models.article_author import ArticleSyncRun
from app.repositories.article_repository import (
    ArticleRepository,
    ArticleSyncEventRepository,
    ArticleSyncRunRepository,
)
from app.schemas.common import ApiErrorCode
from app.schemas.pubmed_import import ImportRunErrorCode, ImportRunRead, PubmedDryRunRead
from app.services.advisory_locks import take_advisory_xact_lock
from app.services.article_source_normalization import (
    PUBMED_FILL_FIELDS,
    normalize_pubmed_record,
)
from app.services.pubmed_client import EFETCH_BATCH_SIZE, PubMedClient, PubMedFetchError
from app.worker import queue_health

logger = get_logger(__name__)

#: Right half of the per-project advisory key that serializes PubMed writes.
PUBMED_IMPORT_LOCK = UUID("e2d0f3dc-4692-406e-bcaa-5df90c43fcf6")
LIVE_RUN_STATUSES = ("pending", "running")
MAX_CONSECUTIVE_FAILED_BATCHES = 3
#: Past the task's hard time limit (30 min): a run still live this long after
#: its creation was killed or never consumed.
IMPORT_RUN_STALE_AFTER = timedelta(hours=1)


def _is_stale(run: ArticleSyncRun, now: datetime) -> bool:
    return run.status in LIVE_RUN_STATUSES and run.created_at <= now - IMPORT_RUN_STALE_AFTER


def _error_code(run: ArticleSyncRun) -> ImportRunErrorCode | None:
    code = (run.failure_summary or {}).get("error_code")
    return code if code in get_args(ImportRunErrorCode) else None


class NcbiEmailMissingError(AppError):
    def __init__(self) -> None:
        super().__init__(
            code=ApiErrorCode.NCBI_EMAIL_NOT_CONFIGURED.value,
            message="PubMed import is not configured on this server.",
            status_code=503,
        )


class ImportQueueUnavailableError(AppError):
    def __init__(self) -> None:
        super().__init__(
            code=ApiErrorCode.SERVICE_UNAVAILABLE.value,
            message="The import queue is unavailable. The import may not have started.",
            status_code=503,
        )


class ImportRunNotFoundError(Exception):
    """No run with that id was requested by the caller in that project."""


def run_counts(status_counts: Mapping[str, int], *, total_received: int) -> dict[str, int]:
    """Map a run's event counts by status onto its ``article_sync_runs`` counters."""
    return {
        "total_received": total_received,
        "persisted": status_counts.get("inserted", 0),
        "updated": status_counts.get("updated", 0),
        "skipped": status_counts.get("duplicate_in_request", 0),
        "failed": status_counts.get("not_found", 0) + status_counts.get("failed", 0),
    }


class PubmedImportService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db
        self._articles = ArticleRepository(db)
        self._runs = ArticleSyncRunRepository(db)
        self._events = ArticleSyncEventRepository(db)

    async def dry_run(self, project_id: UUID, pmids: Sequence[str]) -> PubmedDryRunRead:
        """Count what an import would do; reads the project's articles, writes nothing."""
        distinct = list(dict.fromkeys(pmids))
        already = len(await self._articles.existing_pmids(project_id, distinct))
        return PubmedDryRunRead(
            kind="dry_run",
            received=len(pmids),
            distinct=len(distinct),
            duplicate_in_request=len(pmids) - len(distinct),
            already_in_project=already,
            new=len(distinct) - already,
        )

    async def start(self, project_id: UUID, requester_id: UUID) -> UUID:
        """Write the ``pending`` run the worker will fill; flush only."""
        if not (settings.NCBI_EMAIL or "").strip():
            raise NcbiEmailMissingError()
        if not queue_health.is_queue_available():
            raise ImportQueueUnavailableError()
        run = await self._runs.create_run(
            project_id=project_id,
            requested_by_user_id=requester_id,
            source="pubmed",
            source_collection_key=None,
        )
        return run.id

    async def mark_failed(
        self,
        *,
        project_id: UUID,
        sync_run_id: UUID,
        error_code: ImportRunErrorCode | None = None,
    ) -> str | None:
        """Fail a live run; a missing, foreign or terminal run is left untouched.

        Returns the run's status afterwards (``None`` when there is no run).
        """
        run = await self._runs.run_in_project(sync_run_id, project_id=project_id, for_update=True)
        if run is None:
            return None
        if run.status in LIVE_RUN_STATUSES:
            summary = {"error_code": error_code} if error_code else None
            await self._runs.update_counts(run, {}, "failed", failure_summary=summary)
        return run.status

    async def get_run(
        self, *, project_id: UUID, requester_id: UUID, sync_run_id: UUID
    ) -> ImportRunRead:
        run = await self._runs.run_in_project(
            sync_run_id, project_id=project_id, requested_by=requester_id
        )
        if run is None:
            raise ImportRunNotFoundError()
        by_status = await self._events.status_counts(run.id)
        status, error_code = run.status, _error_code(run)
        if _is_stale(run, datetime.now(UTC)):
            status, error_code = "failed", "IMPORT_STALE"
        return ImportRunRead.model_validate(
            {
                "sync_run_id": run.id,
                "source": run.source,
                "status": status,
                "total_received": run.total_received,
                "persisted": run.persisted,
                "updated": run.updated,
                "unchanged": by_status.get("unchanged", 0),
                "skipped": run.skipped,
                "failed": run.failed,
                "not_found": by_status.get("not_found", 0),
                "fetch_failed": by_status.get("failed", 0),
                "error_code": error_code,
                "started_at": run.started_at,
                "completed_at": run.completed_at,
            }
        )

    async def run_import(
        self,
        *,
        project_id: UUID,
        sync_run_id: UUID,
        pmids: Sequence[str],
        client: PubMedClient,
        batch_size: int = EFETCH_BATCH_SIZE,
    ) -> str | None:
        """Import the run's PMIDs; returns the run's status when it stops.

        ``None`` when the project has no run with that id. A terminal run
        (completed, or failed by the endpoint) is left as it is.
        """
        run = await self._runs.run_in_project(sync_run_id, project_id=project_id, for_update=True)
        if run is None:
            return None
        if run.status not in LIVE_RUN_STATUSES:
            return run.status
        if _is_stale(run, datetime.now(UTC)):
            await self._runs.update_counts(
                run, {}, "failed", failure_summary={"error_code": "IMPORT_STALE"}
            )
            await self.db.commit()
            return "failed"
        await self._runs.update_counts(run, {}, "running")
        await self.db.commit()

        distinct = list(dict.fromkeys(pmids))
        repeats = Counter(pmids)
        failed_in_a_row = 0
        for start in range(0, len(distinct), batch_size):
            chunk = distinct[start : start + batch_size]
            # Unlocked pre-filter: no NCBI call for PMIDs an earlier delivery wrote.
            done = await self._events.pmids_with_events(sync_run_id, chunk)
            batch = [pmid for pmid in chunk if pmid not in done]
            if not batch:
                continue
            # Nothing to fill: recorded ``unchanged`` without an NCBI call.
            complete = await self._articles.complete_pmid_matches(
                project_id, batch, PUBMED_FILL_FIELDS
            )
            to_fetch = [pmid for pmid in batch if pmid not in complete]
            records: dict[str, ET.Element] | None = {}
            if to_fetch:
                try:
                    records = await client.efetch(to_fetch)
                    failed_in_a_row = 0
                except PubMedFetchError:
                    failed_in_a_row += 1
                    if failed_in_a_row >= MAX_CONSECUTIVE_FAILED_BATCHES:
                        logger.error(
                            "pubmed_import_ncbi_unavailable",
                            sync_run_id=str(sync_run_id),
                            failed_batches=failed_in_a_row,
                            exc_info=True,
                        )
                        stopped = await self.mark_failed(
                            project_id=project_id,
                            sync_run_id=sync_run_id,
                            error_code="NCBI_UNAVAILABLE",
                        )
                        await self.db.commit()
                        return stopped
                    logger.warning(
                        "pubmed_efetch_failed",
                        sync_run_id=str(sync_run_id),
                        pmids=to_fetch,
                        exc_info=True,
                    )
                    records = None

            await take_advisory_xact_lock(self.db, project_id, PUBMED_IMPORT_LOCK)
            run = await self._runs.run_in_project(
                sync_run_id, project_id=project_id, for_update=True
            )
            if run is None or run.status not in LIVE_RUN_STATUSES:
                stopped = run.status if run is not None else None
                await self.db.rollback()
                return stopped
            # Recomputed under the lock: a concurrent delivery may have written them.
            done = await self._events.pmids_with_events(sync_run_id, batch)
            for pmid in batch:
                if pmid in done:
                    continue
                await self._write_pmid(
                    project_id,
                    sync_run_id,
                    pmid,
                    records,
                    repeats=repeats[pmid],
                    complete_article_id=complete.get(pmid),
                )
            await self._save_counts(run, total_received=len(pmids), status="running")
            await self.db.commit()

        run = await self._runs.run_in_project(sync_run_id, project_id=project_id, for_update=True)
        if run is None:
            return None
        if run.status in LIVE_RUN_STATUSES:
            await self._save_counts(run, total_received=len(pmids), status="completed")
        final = run.status
        await self.db.commit()
        return final

    async def _write_pmid(
        self,
        project_id: UUID,
        sync_run_id: UUID,
        pmid: str,
        records: Mapping[str, ET.Element] | None,
        *,
        repeats: int,
        complete_article_id: UUID | None,
    ) -> None:
        """One event for the PMID, plus one ``duplicate_in_request`` per repeat.

        ``complete_article_id`` is the PMID's article when it had nothing left
        to fill (the PMID was not fetched).
        """
        article_id: UUID | None = None
        error_code: str | None = None
        record = records.get(pmid) if records is not None else None
        if complete_article_id is not None:
            event_status, article_id = "unchanged", complete_article_id
        elif records is None:
            event_status, error_code = "failed", "NCBI_UNAVAILABLE"
        elif record is None:
            event_status = "not_found"
        else:
            try:
                canonical = normalize_pubmed_record(record=record)
            except Exception:
                logger.warning(
                    "pubmed_parse_failed",
                    sync_run_id=str(sync_run_id),
                    pmid=pmid,
                    exc_info=True,
                )
                event_status, error_code = "failed", "PARSE_ERROR"
            else:
                article, event_status = await self._articles.fill_only_upsert(
                    project_id=project_id,
                    payload=canonical.article_fields,
                    canonical_identity=canonical.canonical_identity,
                    fill_fields=PUBMED_FILL_FIELDS,
                )
                article_id = article.id

        for index in range(repeats):
            await self._events.create_event(
                project_id=project_id,
                sync_run_id=sync_run_id,
                status=event_status if index == 0 else "duplicate_in_request",
                zotero_item_key=None,
                article_id=article_id,
                error_code=error_code if index == 0 else None,
                event_payload={"pmid": pmid},
            )

    async def _save_counts(self, run: ArticleSyncRun, *, total_received: int, status: str) -> None:
        counts = run_counts(await self._events.status_counts(run.id), total_received=total_received)
        await self._runs.update_counts(run, counts, status)
