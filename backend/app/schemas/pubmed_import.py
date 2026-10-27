"""PubMed import by PMID. snake_case on the wire."""

from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

MAX_PMIDS = 10_000

ImportRunStatus = Literal["pending", "running", "completed", "failed"]
# Why a run failed, when known: NCBI kept failing, the task hit its time
# limit, or the run stayed live past the stale cutoff.
ImportRunErrorCode = Literal["NCBI_UNAVAILABLE", "IMPORT_TIME_LIMIT", "IMPORT_STALE"]


class PubmedImportRequest(BaseModel):
    """PMIDs to import into the project; ``dry_run`` only counts them."""

    model_config = ConfigDict(extra="forbid")

    pmids: list[Annotated[str, StringConstraints(pattern=r"^[0-9]{1,10}$")]] = Field(
        min_length=1, max_length=MAX_PMIDS
    )
    dry_run: bool = False


class PubmedDryRunRead(BaseModel):
    """What an import of these PMIDs would do; nothing was written."""

    kind: Literal["dry_run"]
    received: int
    distinct: int
    duplicate_in_request: int
    already_in_project: int
    new: int


class PubmedImportStarted(BaseModel):
    """The import was queued; poll its run for progress."""

    kind: Literal["started"]
    sync_run_id: UUID
    status: Literal["pending"]


PubmedImportResult = Annotated[PubmedDryRunRead | PubmedImportStarted, Field(discriminator="kind")]


class ImportRunRead(BaseModel):
    """One import run's status and counts.

    ``failed`` is the stored total of ``not_found`` plus ``fetch_failed``
    (NCBI unavailable or an unparseable record); ``unchanged`` matched an
    article and filled nothing.
    """

    sync_run_id: UUID
    source: Literal["pubmed", "zotero"]
    status: ImportRunStatus
    total_received: int
    persisted: int
    updated: int
    unchanged: int
    skipped: int
    failed: int
    not_found: int
    fetch_failed: int
    error_code: ImportRunErrorCode | None
    started_at: datetime
    completed_at: datetime | None
