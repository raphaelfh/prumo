"""RunLifecycleService.resolve_or_create_extract_run — the standalone-path gate.

Under the one-live-run invariant (partial unique index, migration 0045) the
standalone AI-extraction paths can no longer create a run unconditionally: the
gate reuses the coordinate's live run when one exists (so AI work lands where
the reviewer is editing), creates one only on a fresh coordinate, and refuses
to touch a run already in consensus. All state is savepoint-scoped via the
default ``db_session`` fixture.
"""

from __future__ import annotations

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction import ExtractionRunStage
from app.services.run_lifecycle_service import RunBusyError, RunLifecycleService
from tests.integration.conftest import SEED


async def _cancel_live_runs(db: AsyncSession) -> None:
    """Clear the SEED coordinate so 'no live run' scenarios are deterministic."""
    await db.execute(
        text(
            "UPDATE public.extraction_runs SET stage = 'cancelled', status = 'failed' "
            "WHERE project_id = :pid AND article_id = :aid AND template_id = :tid "
            "  AND stage IN ('pending', 'extract', 'consensus')"
        ),
        {
            "pid": str(SEED.primary_project),
            "aid": str(SEED.primary_article),
            "tid": str(SEED.primary_template),
        },
    )


def _service(db: AsyncSession) -> RunLifecycleService:
    return RunLifecycleService(db)


@pytest.mark.asyncio
async def test_creates_and_advances_when_no_live_run(db_session: AsyncSession) -> None:
    await _cancel_live_runs(db_session)
    service = _service(db_session)

    run, created = await service.resolve_or_create_extract_run(
        project_id=SEED.primary_project,
        article_id=SEED.primary_article,
        project_template_id=SEED.primary_template,
        user_id=SEED.primary_profile,
        parameters={"origin": "gate-test"},
    )

    assert created is True
    assert run.stage == ExtractionRunStage.EXTRACT.value


@pytest.mark.asyncio
async def test_reuses_the_live_extract_run(db_session: AsyncSession) -> None:
    await _cancel_live_runs(db_session)
    service = _service(db_session)

    first, created_first = await service.resolve_or_create_extract_run(
        project_id=SEED.primary_project,
        article_id=SEED.primary_article,
        project_template_id=SEED.primary_template,
        user_id=SEED.primary_profile,
    )
    assert created_first is True

    # Second standalone extraction (e.g. the FE's next batch chunk, or a
    # model extraction after a section extraction) reuses the SAME run —
    # created=False tells the caller the session/first-creator owns the
    # lifecycle, so it must not complete/fail it.
    second, created_second = await service.resolve_or_create_extract_run(
        project_id=SEED.primary_project,
        article_id=SEED.primary_article,
        project_template_id=SEED.primary_template,
        user_id=SEED.primary_profile,
    )
    assert created_second is False
    assert second.id == first.id


@pytest.mark.asyncio
async def test_advances_a_pending_live_run(db_session: AsyncSession) -> None:
    await _cancel_live_runs(db_session)
    service = _service(db_session)

    pending = await service.create_run(
        project_id=SEED.primary_project,
        article_id=SEED.primary_article,
        project_template_id=SEED.primary_template,
        user_id=SEED.primary_profile,
    )
    assert pending.stage == ExtractionRunStage.PENDING.value

    run, created = await service.resolve_or_create_extract_run(
        project_id=SEED.primary_project,
        article_id=SEED.primary_article,
        project_template_id=SEED.primary_template,
        user_id=SEED.primary_profile,
    )
    assert created is False
    assert run.id == pending.id
    assert run.stage == ExtractionRunStage.EXTRACT.value


@pytest.mark.asyncio
async def test_refuses_a_run_in_consensus(db_session: AsyncSession) -> None:
    await _cancel_live_runs(db_session)
    service = _service(db_session)

    run, _ = await service.resolve_or_create_extract_run(
        project_id=SEED.primary_project,
        article_id=SEED.primary_article,
        project_template_id=SEED.primary_template,
        user_id=SEED.primary_profile,
    )
    await service.advance_stage(
        run_id=run.id,
        target_stage=ExtractionRunStage.CONSENSUS,
        user_id=SEED.primary_profile,
    )

    # Appending AI proposals to an adjudication-in-progress is exactly the
    # shadow-work the invariant forbids — surfaced as a clear error, never a
    # forked run (pre-0045 this silently created one: the data-loss bug).
    with pytest.raises(RunBusyError, match="consensus"):
        await service.resolve_or_create_extract_run(
            project_id=SEED.primary_project,
            article_id=SEED.primary_article,
            project_template_id=SEED.primary_template,
            user_id=SEED.primary_profile,
        )
