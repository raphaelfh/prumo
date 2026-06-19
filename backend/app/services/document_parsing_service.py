"""Document Parsing Service.

Orchestrates the PDF-only parsing pipeline:

1. Load ArticleFile by ID.
2. Download PDF bytes via the injected StorageAdapter.
3. Parse bytes via the injected DocumentParser.
4. Normalise char offsets via assign_char_offsets_to_blocks (single source of
   truth from the parsing.base module).
5. Persist blocks via ArticleTextBlockRepository.replace_for_file (flush only).
6. Update ArticleFile.extraction_status and flush.
7. Return a typed DocumentParsingResult.

Transaction boundary
--------------------
This service NEVER commits.  All mutations are flushed inside the session so
the caller (Celery worker task, Task 1.5) can commit or roll back as a unit.
On parser error: the service sets ``extraction_status = "parse_failed"``,
flushes, logs, and re-raises so the future worker can handle retries.

NOTE: the ``parse_failed`` flush is best-effort in the context of a worker
retry — if the worker's ``worker_session()`` rolls back the outer transaction
the status update will not survive.  Durable ``parse_failed`` persistence is
finalised by Task 1.5 (the Celery task that owns commit semantics).
"""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.infrastructure.parsing.base import DocumentParser, assign_char_offsets_to_blocks
from app.infrastructure.storage.base import StorageAdapter
from app.models.article import ArticleFile
from app.repositories.article_text_block_repository import ArticleTextBlockRepository

_logger = get_logger(__name__)


@dataclass(frozen=True)
class DocumentParsingResult:
    """Typed result returned by DocumentParsingService.parse_article_file.

    Attributes:
        block_count: Total number of ParsedBlock objects persisted.
        page_count: Number of distinct page numbers across the persisted blocks.
        status: Final extraction_status value set on the ArticleFile.
            Either ``"parsed"`` (success) or ``"parse_failed"`` (error).
    """

    block_count: int
    page_count: int
    status: str


class DocumentParsingService:
    """Orchestrates PDF parsing for a single ArticleFile.

    Receives its concrete ``parser`` and ``storage`` by injection so callers
    (Celery task, unit tests) can choose the implementation without coupling
    the service to a specific adapter.

    Args:
        db: Async SQLAlchemy session.  The service flushes but never commits.
        user_id: Authenticated user ID (string form).
        storage: Storage adapter used to download the PDF bytes.
        parser: DocumentParser implementation to invoke.
        trace_id: Trace / request ID threaded into structured log events.
    """

    def __init__(
        self,
        db: AsyncSession,
        user_id: str,
        storage: StorageAdapter,
        parser: DocumentParser,
        trace_id: str,
    ) -> None:
        self.db = db
        self.user_id = user_id
        self.storage = storage
        self.parser = parser
        self.trace_id = trace_id
        self._repo = ArticleTextBlockRepository(db)

    async def parse_article_file(self, article_file_id: UUID) -> DocumentParsingResult:
        """Parse the PDF associated with *article_file_id* and persist the blocks.

        Args:
            article_file_id: PK of the ``ArticleFile`` to process.

        Returns:
            A :class:`DocumentParsingResult` with block_count, page_count, and
            status (``"parsed"``).

        Raises:
            FileNotFoundError: If the ArticleFile row does not exist.
            Any exception raised by ``self.parser.parse``: re-raised after
            setting ``extraction_status = "parse_failed"`` and flushing.
        """
        log = _logger.bind(
            trace_id=self.trace_id,
            article_file_id=str(article_file_id),
            user_id=self.user_id,
        )

        # 1. Load ArticleFile.
        article_file = (
            await self.db.execute(select(ArticleFile).where(ArticleFile.id == article_file_id))
        ).scalar_one_or_none()

        if article_file is None:
            raise FileNotFoundError(f"ArticleFile not found: {article_file_id}")

        # 2. Download PDF bytes.
        pdf_bytes = await self.storage.download("articles", article_file.storage_key)

        # 3. Parse — isolate so we can catch and handle parser errors.
        try:
            blocks = self.parser.parse(pdf_bytes)
        except Exception:
            log.exception("document_parsing_failed")
            article_file.extraction_status = "parse_failed"
            await self.db.flush()
            raise

        # 4. Normalise char offsets via the canonical helper (single source of
        #    truth for offset arithmetic — do NOT recompute inline).
        assign_char_offsets_to_blocks(blocks)

        # 5. Persist blocks (delete-then-bulk-insert, flush only).
        await self._repo.replace_for_file(article_file_id, blocks)

        # 6. Update status.
        article_file.extraction_status = "parsed"
        await self.db.flush()

        page_count = len({b.page_number for b in blocks})

        log.info(
            "document_parsing_succeeded",
            block_count=len(blocks),
            page_count=page_count,
        )

        # 7. Return typed result.
        return DocumentParsingResult(
            block_count=len(blocks),
            page_count=page_count,
            status="parsed",
        )
