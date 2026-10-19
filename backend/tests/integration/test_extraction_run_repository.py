"""Integration tests for ExtractionRunRepository.merge_provenance_section.

Runs against the real local Supabase Postgres so the JSONB reassign +
row-locked read-modify-write is exercised end-to-end (a mocked session hides
whether the change is actually flushed and re-read).

Pattern mirrors test_suggestion_read.py: seed a run via RunLifecycleService
with the SEED sentinel ids, then assert the merge semantics.
"""

from __future__ import annotations

from uuid import UUID, uuid4

import pytest
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction import ExtractionRun
from app.repositories.extraction_run_repository import ExtractionRunRepository
from app.services.run_lifecycle_service import RunLifecycleService
from tests.integration.conftest import SEED


async def _seed_run(db: AsyncSession):
    """A fresh EXTRACT-stage run on the primary seed project/article/template."""
    lifecycle = RunLifecycleService(db)
    run = await lifecycle.create_run(
        project_id=SEED.primary_project,
        article_id=SEED.primary_article,
        project_template_id=SEED.primary_template,
        user_id=SEED.primary_profile,
    )
    return run


async def _reread_results(db: AsyncSession, run_id: UUID) -> dict:
    """Re-read the run's ``results`` from the DB, overwriting the identity-mapped
    copy (``populate_existing``) so a never-flushed in-place mutation can't pass."""
    stmt = (
        select(ExtractionRun)
        .where(ExtractionRun.id == run_id)
        .execution_options(populate_existing=True)
    )
    run = (await db.execute(stmt)).scalar_one()
    return run.results


@pytest.mark.asyncio
async def test_merge_provenance_section_keeps_sibling_sections(db_session: AsyncSession) -> None:
    repo = ExtractionRunRepository(db_session)
    run = await _seed_run(db_session)
    et_a, et_b = uuid4(), uuid4()

    await repo.merge_provenance_section(run.id, et_a, {"model": "m-a"})
    await repo.merge_provenance_section(run.id, et_b, {"model": "m-b"})

    results = await _reread_results(db_session, run.id)
    sections = results["provenance"]["sections"]
    assert sections[str(et_a)] == {"model": "m-a"}
    assert sections[str(et_b)] == {"model": "m-b"}


@pytest.mark.asyncio
async def test_merge_provenance_section_missing_run_returns_none(db_session: AsyncSession) -> None:
    repo = ExtractionRunRepository(db_session)
    assert await repo.merge_provenance_section(uuid4(), uuid4(), {}) is None


@pytest.mark.asyncio
async def test_merge_provenance_section_preserves_flat_legacy_keys(
    db_session: AsyncSession,
) -> None:
    """A run whose provenance is a flat (pre-deploy) snapshot keeps those keys
    AND gains the sections map — the mixed-era shape Task 4's resolver relies on."""
    repo = ExtractionRunRepository(db_session)
    run = await _seed_run(db_session)
    # Plant the pre-deploy flat provenance directly — the shape a run carries
    # when it was written before the per-section snapshot existed. Reassign
    # (not mutate) so SQLAlchemy tracks the JSONB change.
    run.results = {"provenance": {"model": "legacy", "prompt_text": "SYS"}}
    await db_session.flush()

    et = uuid4()
    await repo.merge_provenance_section(run.id, et, {"model": "sectioned"})

    results = await _reread_results(db_session, run.id)
    provenance = results["provenance"]
    assert provenance["model"] == "legacy"
    assert provenance["prompt_text"] == "SYS"
    assert provenance["sections"][str(et)] == {"model": "sectioned"}


@pytest.mark.asyncio
async def test_add_tokens_sums_onto_the_row_not_a_stale_copy(db_session: AsyncSession) -> None:
    """Another writer (a sibling chunk) added tokens after this session loaded
    the run: the row-locked re-read sums onto the row's value, so neither
    write is lost, and sibling keys survive."""
    repo = ExtractionRunRepository(db_session)
    run = await _seed_run(db_session)
    assert run.results == {}, "precondition: the identity-mapped copy is empty"
    await db_session.execute(
        text(
            "UPDATE extraction_runs SET results = "
            """'{"tokens": {"prompt": 5, "completion": 1, "total": 6}, "kind": "x"}'::jsonb """
            "WHERE id = :id"
        ),
        {"id": run.id},
    )

    await repo.add_tokens(run.id, prompt=10, completion=2)

    results = await _reread_results(db_session, run.id)
    assert results["tokens"] == {"prompt": 15, "completion": 3, "total": 18}
    assert results["kind"] == "x"


@pytest.mark.asyncio
async def test_add_tokens_starts_from_zero(db_session: AsyncSession) -> None:
    repo = ExtractionRunRepository(db_session)
    run = await _seed_run(db_session)

    await repo.add_tokens(run.id, prompt=4, completion=3)

    results = await _reread_results(db_session, run.id)
    assert results["tokens"] == {"prompt": 4, "completion": 3, "total": 7}
