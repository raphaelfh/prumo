"""The one stage/lock oracle for run writes: ``open_run_for_write``.

Every write prologue (proposal, decision, consensus, AI landing, kickoff)
goes through this function, so its contract is tested once, as a table:

- stage x expect -> the run, or ``RunWriteError(reason="stage")``;
- the coordinate cases of the former ``assert_coords_coherent`` ->
  ``RunWriteError(reason="coordinate")`` (missing instance, field from
  another entity type, instance from another article — #79);
- a missing run -> ``RunWriteError(reason="missing")``;
- the row is read FOR UPDATE and refreshed from the locked row, so a stage
  flipped by another transaction is seen (the TOCTOU class the lock closes).
"""

from __future__ import annotations

import asyncio
from uuid import UUID, uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.core.config import settings
from app.models.extraction import ExtractionRun, ExtractionRunStage
from app.services.extraction_run_write import (
    RunWriteError,
    assert_instance_in_coordinate,
    open_run_for_write,
)
from app.services.run_lifecycle_service import RunLifecycleService
from tests.integration.conftest import SEED

_ALL_STAGES = [stage.value for stage in ExtractionRunStage]


async def _run_in_stage(db: AsyncSession, stage: str) -> ExtractionRun:
    """A run on the seed coordinate parked in ``stage`` (set directly: the
    table needs every stage, including the ones no forward edge reaches)."""
    run = await RunLifecycleService(db).create_run(
        project_id=SEED.primary_project,
        article_id=SEED.primary_article,
        project_template_id=SEED.primary_template,
        user_id=SEED.primary_profile,
    )
    await db.execute(
        text("UPDATE public.extraction_runs SET stage = :stage WHERE id = :id"),
        {"stage": stage, "id": run.id},
    )
    await db.flush()
    return run


# --------------------------------------------------------------------------
# stage x expect
# --------------------------------------------------------------------------


@pytest.mark.parametrize("stage", _ALL_STAGES)
@pytest.mark.parametrize(
    ("expect_name", "expect"),
    [
        ("extract", ExtractionRunStage.EXTRACT.only()),
        ("consensus", ExtractionRunStage.CONSENSUS.only()),
        ("live", ExtractionRunStage.live()),
    ],
)
async def test_stage_gate(
    db_session: AsyncSession, stage: str, expect_name: str, expect: frozenset[str]
) -> None:
    run = await _run_in_stage(db_session, stage)

    if stage in expect:
        opened = await open_run_for_write(db_session, run.id, expect=expect)
        assert opened is run
        assert opened.stage == stage
        return

    with pytest.raises(RunWriteError) as raised:
        await open_run_for_write(db_session, run.id, expect=expect)
    assert raised.value.reason == "stage"
    assert raised.value.run_id == run.id
    assert raised.value.stage == stage
    # The message names the refused stage and the expected one(s): the
    # endpoints surface it verbatim (``"not 'consensus'"`` is asserted there).
    if expect_name == "live":
        assert "not one of" in str(raised.value)
    else:
        assert f"not '{expect_name}'" in str(raised.value)


async def test_stage_gate_reads_the_locked_row_not_the_identity_map(
    db_session: AsyncSession,
) -> None:
    """A run object loaded before the stage flipped is judged on the row, not itself."""
    # ``_run_in_stage`` flips the row with SQL: the identity-map object is stale.
    run = await _run_in_stage(db_session, ExtractionRunStage.EXTRACT.value)
    assert run.stage == ExtractionRunStage.PENDING.value
    opened = await open_run_for_write(db_session, run.id, expect=ExtractionRunStage.EXTRACT.only())
    assert opened is run
    assert run.stage == ExtractionRunStage.EXTRACT.value, "refreshed from the locked row"

    # And the other way: a stale 'extract' must not pass once the row moved on.
    await db_session.execute(
        text("UPDATE public.extraction_runs SET stage = 'consensus' WHERE id = :id"),
        {"id": run.id},
    )
    with pytest.raises(RunWriteError) as raised:
        await open_run_for_write(db_session, run.id, expect=ExtractionRunStage.EXTRACT.only())
    assert raised.value.reason == "stage"
    assert raised.value.stage == ExtractionRunStage.CONSENSUS.value
    assert run.stage == ExtractionRunStage.CONSENSUS.value


async def test_missing_run(db_session: AsyncSession) -> None:
    run_id = uuid4()
    with pytest.raises(RunWriteError) as raised:
        await open_run_for_write(db_session, run_id, expect=ExtractionRunStage.live())
    assert raised.value.reason == "missing"
    assert raised.value.run_id == run_id
    assert raised.value.stage is None
    assert f"Run {run_id} not found" in str(raised.value)


# --------------------------------------------------------------------------
# coordinate coherence
# --------------------------------------------------------------------------


async def test_coherent_coordinate_passes(db_session: AsyncSession) -> None:
    run = await _run_in_stage(db_session, ExtractionRunStage.EXTRACT.value)
    opened = await open_run_for_write(
        db_session,
        run.id,
        expect=ExtractionRunStage.EXTRACT.only(),
        instance_id=SEED.primary_instance,
        field_id=SEED.primary_field,
    )
    assert opened is run


async def _other_entity_field(db: AsyncSession) -> UUID | None:
    return (
        await db.execute(
            text(
                """
                SELECT f.id FROM public.extraction_fields f
                WHERE f.entity_type_id <> (
                    SELECT entity_type_id FROM public.extraction_instances WHERE id = :iid
                )
                LIMIT 1
                """
            ),
            {"iid": SEED.primary_instance},
        )
    ).scalar()


async def test_unknown_instance_is_a_coordinate_refusal(db_session: AsyncSession) -> None:
    run = await _run_in_stage(db_session, ExtractionRunStage.EXTRACT.value)
    with pytest.raises(RunWriteError) as raised:
        await open_run_for_write(
            db_session,
            run.id,
            expect=ExtractionRunStage.EXTRACT.only(),
            instance_id=uuid4(),
            field_id=SEED.primary_field,
        )
    assert raised.value.reason == "coordinate"


async def test_field_from_another_entity_type_is_a_coordinate_refusal(
    db_session: AsyncSession,
) -> None:
    other_field_id = await _other_entity_field(db_session)
    assert other_field_id is not None, "seed graph needs >= 2 entity types with fields"
    run = await _run_in_stage(db_session, ExtractionRunStage.EXTRACT.value)
    with pytest.raises(RunWriteError) as raised:
        await open_run_for_write(
            db_session,
            run.id,
            expect=ExtractionRunStage.EXTRACT.only(),
            instance_id=SEED.primary_instance,
            field_id=other_field_id,
        )
    assert raised.value.reason == "coordinate"


async def test_instance_from_another_article_is_a_coordinate_refusal(
    db_session: AsyncSession,
) -> None:
    """#79: same project + template, only ``article_id`` differs — still refused."""
    article_b_id = uuid4()
    await db_session.execute(
        text(
            "INSERT INTO public.articles (id, project_id, title, row_version) "
            "VALUES (:id, :pid, :title, 1)"
        ),
        {"id": article_b_id, "pid": SEED.primary_project, "title": "Article B (#79)"},
    )
    run_b = await RunLifecycleService(db_session).create_run(
        project_id=SEED.primary_project,
        article_id=article_b_id,
        project_template_id=SEED.primary_template,
        user_id=SEED.primary_profile,
    )
    with pytest.raises(RunWriteError) as raised:
        await open_run_for_write(
            db_session,
            run_b.id,
            expect=ExtractionRunStage.live(),
            instance_id=SEED.primary_instance,
            field_id=SEED.primary_field,
        )
    assert raised.value.reason == "coordinate"


async def test_stage_is_gated_before_the_coordinate(db_session: AsyncSession) -> None:
    """Order matters for the HTTP status: a wrong stage is 400, a bad id is 422."""
    run = await _run_in_stage(db_session, ExtractionRunStage.FINALIZED.value)
    with pytest.raises(RunWriteError) as raised:
        await open_run_for_write(
            db_session,
            run.id,
            expect=ExtractionRunStage.EXTRACT.only(),
            instance_id=uuid4(),
            field_id=SEED.primary_field,
        )
    assert raised.value.reason == "stage"


async def test_instance_id_and_field_id_travel_together(db_session: AsyncSession) -> None:
    run = await _run_in_stage(db_session, ExtractionRunStage.EXTRACT.value)
    with pytest.raises(TypeError):
        await open_run_for_write(
            db_session,
            run.id,
            expect=ExtractionRunStage.EXTRACT.only(),
            instance_id=SEED.primary_instance,
        )


# --------------------------------------------------------------------------
# kickoff surface: an instance against an explicit coordinate (no run yet)
# --------------------------------------------------------------------------


async def test_instance_in_coordinate(db_session: AsyncSession) -> None:
    await assert_instance_in_coordinate(
        db_session,
        instance_id=SEED.primary_instance,
        project_id=SEED.primary_project,
        article_id=SEED.primary_article,
        template_id=SEED.primary_template,
    )
    with pytest.raises(RunWriteError) as raised:
        await assert_instance_in_coordinate(
            db_session,
            instance_id=SEED.primary_instance,
            project_id=SEED.secondary_project,
            article_id=SEED.primary_article,
            template_id=SEED.primary_template,
        )
    assert raised.value.reason == "coordinate"
    assert raised.value.run_id is None


# --------------------------------------------------------------------------
# the lock
# --------------------------------------------------------------------------


async def test_open_run_for_write_blocks_on_a_concurrent_row_lock(
    db_session_real: AsyncSession,
) -> None:
    """Without FOR UPDATE this completes promptly and the test FAILS.

    ``db_session_real`` because a second engine must see the committed row;
    the SAVEPOINT fixture deliberately hides it.
    """
    run = await RunLifecycleService(db_session_real).create_run(
        project_id=SEED.primary_project,
        article_id=SEED.primary_article,
        project_template_id=SEED.primary_template,
        user_id=SEED.primary_profile,
    )
    await db_session_real.commit()
    run_id = run.id

    engine2 = create_async_engine(settings.async_database_url, echo=False, pool_pre_ping=True)
    sessions2 = async_sessionmaker(engine2, class_=AsyncSession, expire_on_commit=False)
    try:
        async with sessions2() as session2:
            await session2.execute(
                text("SELECT id FROM public.extraction_runs WHERE id = :rid FOR UPDATE"),
                {"rid": run_id},
            )
            with pytest.raises((asyncio.TimeoutError, TimeoutError)):
                await asyncio.wait_for(
                    open_run_for_write(db_session_real, run_id, expect=ExtractionRunStage.live()),
                    timeout=1.5,
                )
            await session2.rollback()
    finally:
        await engine2.dispose()
        await db_session_real.rollback()
        await db_session_real.execute(
            text("DELETE FROM public.extraction_runs WHERE id = :rid"), {"rid": run_id}
        )
        await db_session_real.commit()
