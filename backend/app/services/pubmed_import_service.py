"""PubMed import by PMID through the canonical article path.

The endpoint writes a ``pending`` run and enqueues; the worker's
:meth:`PubmedImportService.run_import` fetches serial efetch batches and
writes one ``article_sync_events`` row per received PMID (repeats included),
so a redelivered or concurrent delivery of the same run never writes a PMID
twice.

Lock order, everywhere: the per-project advisory lock, then the run row.
:meth:`PubmedImportService.mark_failed` takes only the run row, so the two
orders never invert. Network calls happen outside every lock.
"""

from __future__ import annotations

import xml.etree.ElementTree as ET
from collections import Counter
from collections.abc import Mapping, Sequence
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
from app.schemas.pubmed_import import ImportRunRead, PubmedDryRunRead
from app.services.advisory_locks import take_advisory_xact_lock
from app.services.article_source_normalization import (
    PUBMED_FILL_FIELDS,
    normalize_pubmed_record,
)
from app.services.pubmed_client import EFETCH_BATCH_SIZE, PubMedClient, PubMedFetchError
from app.worker import queue_health

#: Right half of the per-project advisory key that serializes PubMed writes.
logger = get_logger(__name__)

PUBMED_IMPORT_LOCK = UUID("e2d0f3dc-4692-406e-bcaa-5df90c43fcf6")
LIVE_RUN_STATUSES = ("pending", "running")


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

    async def mark_failed(self, *, project_id: UUID, sync_run_id: UUID) -> None:
        """Fail a live run; a missing, foreign or terminal run is left untouched."""
        run = await self._runs.run_in_project(sync_run_id, project_id=project_id, for_update=True)
        if run is not None and run.status in LIVE_RUN_STATUSES:
            await self._runs.update_counts(run, {}, "failed")

    async def get_run(
        self, *, project_id: UUID, requester_id: UUID, sync_run_id: UUID
    ) -> ImportRunRead:
        run = await self._runs.run_in_project(
            sync_run_id, project_id=project_id, requested_by=requester_id
        )
        if run is None:
            raise ImportRunNotFoundError()
        return ImportRunRead.model_validate(
            {
                "sync_run_id": run.id,
                "source": run.source,
                "status": run.status,
                "total_received": run.total_received,
                "persisted": run.persisted,
                "updated": run.updated,
                "skipped": run.skipped,
                "failed": run.failed,
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
        await self._runs.update_counts(run, {}, "running")
        await self.db.commit()

        distinct = list(dict.fromkeys(pmids))
        repeats = Counter(pmids)
        for start in range(0, len(distinct), batch_size):
            chunk = distinct[start : start + batch_size]
            # Unlocked pre-filter: no NCBI call for PMIDs an earlier delivery wrote.
            done = await self._events.pmids_with_events(sync_run_id, chunk)
            batch = [pmid for pmid in chunk if pmid not in done]
            if not batch:
                continue
            records: dict[str, ET.Element] | None
            try:
                records = await client.efetch(batch)
            except PubMedFetchError:
                logger.warning(
                    "pubmed_efetch_failed",
                    sync_run_id=str(sync_run_id),
                    pmids=batch,
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
                    project_id, sync_run_id, pmid, records, repeats=repeats[pmid]
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
    ) -> None:
        """One event for the PMID, plus one ``duplicate_in_request`` per repeat."""
        article_id: UUID | None = None
        error_code: str | None = None
        record = records.get(pmid) if records is not None else None
        if records is None:
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
                article, created = await self._articles.fill_only_upsert(
                    project_id=project_id,
                    payload=canonical.article_fields,
                    canonical_identity=canonical.canonical_identity,
                    fill_fields=PUBMED_FILL_FIELDS,
                )
                article_id = article.id
                event_status = "inserted" if created else "updated"

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
