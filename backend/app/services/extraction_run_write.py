"""The one oracle for writes against an ``ExtractionRun``.

Every write prologue — recording a proposal, a reviewer decision or a
consensus decision, landing AI results, kicking off an attempt — asks the
same questions, in this order, under one row lock:

1. Does the run exist?                         -> ``RunWriteError(reason="missing")``
2. Is it in a stage this write may land in?    -> ``RunWriteError(reason="stage")``
3. Do the client-supplied ids sit on its coordinate (instance in the run's
   article and template, field in the instance's entity type)?
                                               -> ``RunWriteError(reason="coordinate")``

:func:`open_run_for_write` answers them; the stage sets it takes are the
classmethods on :class:`ExtractionRunStage`. :func:`load_run_for_update` is
the lock primitive underneath, kept for the transition writers
(``run_lifecycle_service``) whose gate is ``_ALLOWED_TRANSITIONS`` (or the
one source stage a finalize / reopen leaves) and whose refusals are the
lifecycle's own errors. :func:`assert_instance_in_coordinate` is the kickoff-surface
sibling: an instance against an explicit coordinate when no run exists yet.

Lock contract (``SELECT … FOR UPDATE``):

- The caller MUST be inside an open transaction (every prumo service call is).
- The lock is released when that transaction commits or rolls back. A
  concurrent ``advance_stage`` blocks until then, which closes the TOCTOU
  between the stage read and the write.
- The row is read with ``populate_existing``, so a run object already in the
  identity map (loaded before an LLM call) takes the locked row's stage,
  never a stale one. Sessions run ``autoflush=False``: pending changes on
  that object are overwritten, so callers flush their own run edits first
  (the lifecycle does).
- Never hold it across external work: a worker-owned ``AiExtraction``
  commits (``before_external_work``) before PDF assembly and every model
  call, and ``ProposalLanding`` takes it only for the result transaction.
"""

from __future__ import annotations

from collections.abc import Collection
from typing import Literal
from uuid import UUID

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.error_handler import AppError
from app.models.extraction import ExtractionRun, ExtractionRunStage, StageSet
from app.repositories.extraction_repository import ExtractionInstanceRepository

RunWriteRefusal = Literal["missing", "stage", "coordinate"]


class RunWriteError(Exception):
    """The run refused a write; ``reason`` says why. HTTP translation in the router.

    One type for every refusal so each caller translates one error. A
    ``coordinate`` refusal is one message for "missing" and "belongs to
    someone else" alike, so a caller probing ids cannot tell them apart.
    """

    def __init__(
        self,
        message: str,
        *,
        reason: RunWriteRefusal,
        run_id: UUID | None,
        stage: str | None = None,
    ) -> None:
        super().__init__(message)
        self.reason = reason
        self.run_id = run_id
        self.stage = stage

    @property
    def run_busy(self) -> bool:
        """The run is in consensus: AI work waits, it is not a bad request."""
        return self.reason == "stage" and self.stage == ExtractionRunStage.CONSENSUS.value


RUN_BUSY_MESSAGE = "AI extraction is paused while this article is in consensus."


class RunBusyError(AppError):
    """An AI extraction kickoff hit a run in consensus (``RunWriteError.run_busy``).

    Adjudication accepts no new AI proposals, so the kickoff is refused as a
    typed 409 (``error.code = "RUN_BUSY"``) the frontend can word, instead of
    the bare 400 ``HTTP_ERROR``. The worker classifies the same refusal into
    ``ExtractionErrorCode.RUN_BUSY`` with :data:`RUN_BUSY_MESSAGE`.
    """

    def __init__(self, run_id: UUID | None) -> None:
        super().__init__(
            code="RUN_BUSY",
            message=RUN_BUSY_MESSAGE,
            status_code=409,
            details={"run_id": str(run_id)},
        )


async def load_run_for_update(db: AsyncSession, run_id: UUID) -> ExtractionRun | None:
    """Lock the run row and refresh it from the locked read."""
    stmt = (
        select(ExtractionRun)
        .where(ExtractionRun.id == run_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    return (await db.execute(stmt)).scalar_one_or_none()


async def open_run_for_write(
    db: AsyncSession,
    run_id: UUID,
    *,
    expect: StageSet,
    instance_id: UUID | None = None,
    field_id: UUID | None = None,
) -> ExtractionRun:
    """Lock the run, gate its stage on ``expect``, bind the coordinate; one error.

    ``instance_id`` and ``field_id`` travel together: pass both to also
    assert the (run, instance, field) triplet, neither for a run-level write.
    """
    if (instance_id is None) != (field_id is None):
        raise TypeError("open_run_for_write: instance_id and field_id travel together")
    run = await load_run_for_update(db, run_id)
    if run is None:
        raise RunWriteError(f"Run {run_id} not found", reason="missing", run_id=run_id)
    if run.stage not in expect:
        raise RunWriteError(
            _stage_message(run, expect), reason="stage", run_id=run_id, stage=run.stage
        )
    if instance_id is not None and field_id is not None:
        await assert_on_coordinate(
            db, run_id=run_id, instance_id=instance_id, field_ids=(field_id,)
        )
    return run


def _stage_message(run: ExtractionRun, expect: StageSet) -> str:
    expected = [stage.value for stage in ExtractionRunStage if stage.value in expect]
    if len(expected) == 1:
        return f"Run {run.id} stage is '{run.stage}', not '{expected[0]}'"
    listed = ", ".join(f"'{stage}'" for stage in expected)
    return f"Run {run.id} stage is '{run.stage}', not one of {listed}"


async def assert_on_coordinate(
    db: AsyncSession, *, run_id: UUID, instance_id: UUID, field_ids: Collection[UUID]
) -> None:
    """Every field in ``field_ids`` sits on the run's coordinate through ``instance_id``.

    Coherent means the instance belongs to the run's template AND article
    (runs and instances are both per-article, so a template-coherent instance
    from another article is still refused — #79), and each field belongs to
    the instance's entity type. :func:`open_run_for_write` binds one field;
    ``ProposalLanding`` binds a section's fields in this one read, under the
    run lock it already holds.
    """
    wanted = set(field_ids)
    result = await db.execute(
        text(
            """
            SELECT count(DISTINCT f.id)
            FROM public.extraction_runs r
            JOIN public.extraction_instances i
              ON i.id = :instance_id
             AND i.template_id = r.template_id
             AND i.article_id = r.article_id
            JOIN public.extraction_entity_types et
              ON et.id = i.entity_type_id
            JOIN public.extraction_fields f
              ON f.id = ANY(:field_ids) AND f.entity_type_id = et.id
            WHERE r.id = :run_id
            """
        ),
        {"run_id": run_id, "instance_id": instance_id, "field_ids": list(wanted)},
    )
    if result.scalar() != len(wanted):
        raise RunWriteError(
            f"Coordinate mismatch: run={run_id} instance={instance_id} "
            f"field={', '.join(sorted(str(f) for f in wanted))}",
            reason="coordinate",
            run_id=run_id,
        )


async def assert_instance_in_coordinate(
    db: AsyncSession,
    *,
    instance_id: UUID,
    project_id: UUID,
    article_id: UUID,
    template_id: UUID,
) -> None:
    """Refuse a client-supplied ``parent_instance_id`` that is not on the coordinate.

    The BOLA guard of the kickoff surface, where no run exists yet on a first
    extraction. The api layer may not reach a repository, so the scoped lookup
    is exposed here; :meth:`ExtractionInstanceRepository.get_in_coordinate`
    holds the predicate this and the extraction service share.
    """
    found = await ExtractionInstanceRepository(db).get_in_coordinate(
        instance_id,
        project_id=project_id,
        article_id=article_id,
        template_id=template_id,
    )
    if found is None:
        raise RunWriteError(f"Instance {instance_id} not found", reason="coordinate", run_id=None)
