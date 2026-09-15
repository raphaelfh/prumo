"""Durable request identity and transaction-scoped execution ownership."""

from collections.abc import Awaitable, Callable
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.error_handler import ConflictError, NotFoundError
from app.models.extraction_attempt import ExtractionAttempt
from app.repositories.extraction_attempt_repository import ExtractionAttemptRepository
from app.schemas.extraction import SectionExtractionRequest
from app.schemas.extraction_attempt import AttemptScope
from app.services.extraction_errors import ExtractionTaskError, classify_extraction_error
from app.services.extraction_run_read_service import get_run_or_raise
from app.services.run_lifecycle_service import InvalidStageTransitionError, RunLifecycleService


class ExtractionAttemptService:
    def __init__(self, db: AsyncSession):
        self.db = db
        self.attempts = ExtractionAttemptRepository(db)

    async def prepare_request(
        self, payload: SectionExtractionRequest, owner_id: UUID, *, job_id: str
    ) -> ExtractionAttempt:
        """Called only after kickoff scope authorization; commit before queue IO."""
        request_id = payload.request_id or uuid4()
        existing = await self.attempts.get_owned(request_id, owner_id)
        run_id = payload.run_id
        if existing is not None:
            run_id = run_id or existing.run_id
        if run_id is None:
            run, _ = await RunLifecycleService(self.db).resolve_or_create_extract_run(
                project_id=payload.project_id,
                article_id=payload.article_id,
                project_template_id=payload.template_id,
                user_id=owner_id,
            )
            run_id = run.id
        summary = await get_run_or_raise(self.db, run_id)
        if summary.stage != "extract":
            raise InvalidStageTransitionError("AI extraction requires the extract stage")
        normalized = payload.model_dump(mode="json", exclude={"request_id"})
        normalized["run_id"] = str(run_id)
        attempt, _ = await self.attempts.get_or_create(
            request_id=request_id,
            owner_id=owner_id,
            scope=AttemptScope(
                project_id=payload.project_id,
                article_id=payload.article_id,
                template_id=payload.template_id,
                run_id=run_id,
            ),
            request_payload=normalized,
            job_id=job_id,
        )
        if attempt.owner_id != owner_id:
            raise NotFoundError("Extraction request")
        if attempt.request_payload != normalized:
            raise ConflictError("requestId already belongs to a different extraction request")
        await self.db.commit()
        return attempt

    async def execute_attempt(
        self,
        attempt_id: UUID,
        operation: Callable[[ExtractionAttempt], Awaitable[dict[str, Any]]],
        *,
        retryable: Callable[[Exception], bool] = lambda _: False,
    ) -> dict[str, Any]:
        """Use a dedicated session: no domain/run transaction belongs here."""
        failure = None
        async with self.db.begin():
            attempt = await self.attempts.lock(attempt_id)
            if attempt is None:
                raise NotFoundError("Extraction attempt")
            if attempt.status == "failed":
                raise ExtractionTaskError(
                    attempt.error_code or "EXTRACTION_FAILED", attempt.error or ""
                )
            if attempt.status in {"completed", "cancelled"}:
                return attempt.result or {}
            try:
                result = await operation(attempt)
            except Exception as exc:
                if retryable(exc):
                    raise
                code, message = classify_extraction_error(exc)
                attempt.status, attempt.error_code, attempt.error = "failed", code.value, message
                failure = exc
                result = {}
            else:
                attempt.status, attempt.result = "completed", result
        if failure is not None:
            raise failure
        return result
