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
- Never hold it across external work: a worker-owned
  ``SectionExtractionService`` commits (``_before_external_work``) before PDF
  assembly and every model call, and ``locked_result_filter`` takes it only
  for the result transaction.
"""

from __future__ import annotations

from typing import Literal
from uuid import UUID

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

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
        await _assert_coordinate(db, run_id=run_id, instance_id=instance_id, field_id=field_id)
    return run


def _stage_message(run: ExtractionRun, expect: StageSet) -> str:
    expected = [stage.value for stage in ExtractionRunStage if stage.value in expect]
    if len(expected) == 1:
        return f"Run {run.id} stage is '{run.stage}', not '{expected[0]}'"
    listed = ", ".join(f"'{stage}'" for stage in expected)
    return f"Run {run.id} stage is '{run.stage}', not one of {listed}"


async def _assert_coordinate(
    db: AsyncSession, *, run_id: UUID, instance_id: UUID, field_id: UUID
) -> None:
    """Coherent means the instance belongs to the run's template AND article
    (runs and instances are both per-article, so a template-coherent instance
    from another article is still refused — #79), and the field belongs to
    the instance's entity type."""
    result = await db.execute(
        text(
            """
            SELECT 1
            FROM public.extraction_runs r
            JOIN public.extraction_instances i
              ON i.id = :instance_id
             AND i.template_id = r.template_id
             AND i.article_id = r.article_id
            JOIN public.extraction_entity_types et
              ON et.id = i.entity_type_id
            JOIN public.extraction_fields f
              ON f.id = :field_id AND f.entity_type_id = et.id
            WHERE r.id = :run_id
            """
        ),
        {"run_id": run_id, "instance_id": instance_id, "field_id": field_id},
    )
    if result.scalar() is None:
        raise RunWriteError(
            f"Coordinate mismatch: run={run_id} instance={instance_id} field={field_id}",
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
