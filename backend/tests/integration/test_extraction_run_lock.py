"""TOCTOU recurrence guard for ExtractionRun stage-transition races.

Closes findings f_001 — f_004 (the four service callsites where
`await self.db.get(ExtractionRun, run_id)` was followed by a stage
check + mutate without a row lock).

The contract this test enforces: every service load of an
ExtractionRun acquires a `SELECT … FOR UPDATE` row lock so a concurrent
`run_lifecycle_service.advance_stage` (or any other transaction touching
the same row) blocks until the service's transaction commits.

How the test works:

1. Build a run in PROPOSAL stage via the standard fixture helper.
2. Open a SECOND engine + session and issue `SELECT … FOR UPDATE` on
   the same run row. The session2 transaction is held open via
   `BEGIN`; the lock is alive for the duration of the `async with`
   block.
3. From the primary `db_session`, attempt `ExtractionProposalService.
   record_proposal(...)` wrapped in `asyncio.wait_for(..., timeout=1.5)`.
   The service's loader is `load_run_for_update`, which itself issues
   `SELECT … FOR UPDATE`. Because session2 already holds the lock,
   session1's lock acquisition BLOCKS in the database.
4. Assert `asyncio.TimeoutError` — the call did not complete within
   the budget because it was blocked on the lock.

Counterfactual: without the fix (plain `db.get`), session1's read does
not take a lock and does not block on session2's lock under Postgres'
snapshot isolation. The call completes promptly and TimeoutError is
NOT raised — the test fails. The test therefore fires iff the fix is
present.
"""

from __future__ import annotations

import asyncio
from uuid import UUID

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.core.config import settings
from app.models.extraction import ExtractionRunStage
from app.models.extraction_workflow import ExtractionProposalSource
from app.services.extraction_proposal_service import ExtractionProposalService
from app.services.run_lifecycle_service import RunLifecycleService


async def _setup_proposal_run(
    db: AsyncSession,
) -> tuple[UUID, UUID, UUID, UUID] | None:
    """Build a run + advance to PROPOSAL; return (run_id, instance_id, field_id, profile_id)."""
    project_id = (await db.execute(text("SELECT id FROM public.projects LIMIT 1"))).scalar()
    article_id = (await db.execute(text("SELECT id FROM public.articles LIMIT 1"))).scalar()
    template_id = (
        await db.execute(text("SELECT id FROM public.project_extraction_templates LIMIT 1"))
    ).scalar()
    profile_id = (await db.execute(text("SELECT id FROM public.profiles LIMIT 1"))).scalar()
    if not all((project_id, article_id, template_id, profile_id)):
        return None
    row = await db.execute(
        text(
            """
            SELECT i.id, f.id
            FROM public.extraction_instances i
            JOIN public.extraction_entity_types et ON et.id = i.entity_type_id
            JOIN public.extraction_fields f ON f.entity_type_id = et.id
            WHERE i.template_id = :tid
            LIMIT 1
            """
        ),
        {"tid": template_id},
    )
    pair = row.first()
    if pair is None:
        return None
    instance_id, field_id = pair
    lifecycle = RunLifecycleService(db)
    run = await lifecycle.create_run(
        project_id=project_id,
        article_id=article_id,
        project_template_id=template_id,
        user_id=profile_id,
    )
    await lifecycle.advance_stage(
        run_id=run.id,
        target_stage=ExtractionRunStage.PROPOSAL,
        user_id=profile_id,
    )
    # Persist so the second session sees the row.
    await db.commit()
    return run.id, instance_id, field_id, profile_id


@pytest.mark.asyncio
async def test_record_proposal_blocks_on_concurrent_for_update_lock(
    db_session_real: AsyncSession,
) -> None:
    """Without FOR UPDATE in load_run_for_update, this test FAILS (no timeout).

    With FOR UPDATE, session1's loader blocks on session2's lock and we
    observe asyncio.TimeoutError within the 1.5s budget.

    Uses ``db_session_real`` because the test opens an independent engine
    (``engine2``) to drive the parallel lock acquisition; the row created
    by ``_setup_proposal_run`` must be visible across connections, which
    the SAVEPOINT-based default fixture deliberately prevents.
    """
    fx = await _setup_proposal_run(db_session_real)
    if fx is None:
        pytest.skip("Missing fixtures.")
    run_id, instance_id, field_id, profile_id = fx

    # Independent engine + session against the same database.
    engine2 = create_async_engine(settings.async_database_url, echo=False, pool_pre_ping=True)
    Session2 = async_sessionmaker(engine2, class_=AsyncSession, expire_on_commit=False)

    try:
        async with Session2() as session2:
            # Take a FOR UPDATE lock on the run row inside session2's open
            # transaction. The transaction is implicit — first execute opens it.
            await session2.execute(
                text("SELECT id FROM public.extraction_runs WHERE id = :rid FOR UPDATE"),
                {"rid": str(run_id)},
            )

            # Session1 attempts record_proposal — must block on session2's lock.
            service = ExtractionProposalService(db_session_real)
            with pytest.raises((asyncio.TimeoutError, TimeoutError)):
                await asyncio.wait_for(
                    service.record_proposal(
                        run_id=run_id,
                        instance_id=instance_id,
                        field_id=field_id,
                        source=ExtractionProposalSource.AI,
                        proposed_value={"v": "blocked"},
                    ),
                    timeout=1.5,
                )

            # Roll back session2 to release the lock cleanly.
            await session2.rollback()
    finally:
        await engine2.dispose()

    # Clean up the session1 row lock leftover from the timed-out call so
    # subsequent tests in this session are not polluted.
    await db_session_real.rollback()
    # Tear down: remove the run + cascade rows.
    await db_session_real.execute(
        text("DELETE FROM public.extraction_runs WHERE id = :rid"),
        {"rid": str(run_id)},
    )
    await db_session_real.commit()
