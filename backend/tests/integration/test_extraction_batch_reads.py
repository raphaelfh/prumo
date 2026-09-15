"""Reads are owner-only, member-only, 7 days, and derived (spec §7.1-7.2)."""

from __future__ import annotations

from datetime import UTC, datetime

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.extraction_batch_service import (
    BatchNotFoundError,
    ExtractionBatchService,
    owned_batch,
)
from tests.integration.conftest import SEED
from tests.integration.helpers.batch_fixtures import make_article, make_batch


@pytest.mark.asyncio
async def test_owner_reads_detail_with_derived_counts(db_session: AsyncSession) -> None:
    a = await make_article(db_session, SEED.primary_project, "First")
    b = await make_article(db_session, SEED.primary_project, "Second")
    batch_id = await make_batch(
        db_session,
        owner_id=SEED.primary_profile,
        project_id=SEED.primary_project,
        template_id=SEED.primary_template,
        article_ids=[a, b],
    )
    await db_session.execute(
        text(
            "UPDATE public.extraction_batch_items SET status='skipped', reason_code='RUN_FINALIZED' "
            "WHERE batch_id=:b AND article_id=:a"
        ),
        {"b": str(batch_id), "a": str(b)},
    )

    detail = await ExtractionBatchService(db_session).detail(
        SEED.primary_profile, batch_id, now=datetime.now(UTC)
    )

    assert detail.state == "active"
    assert (detail.counts.total, detail.counts.queued, detail.counts.skipped) == (2, 1, 1)
    assert [i.title for i in detail.items] == ["First", "Second"]
    assert detail.items[1].reason_code == "RUN_FINALIZED"
    assert detail.project_name and detail.template_name and detail.kind


@pytest.mark.asyncio
async def test_foreign_and_missing_batches_are_indistinguishable(db_session: AsyncSession) -> None:
    a = await make_article(db_session, SEED.primary_project)
    batch_id = await make_batch(
        db_session,
        owner_id=SEED.primary_profile,
        project_id=SEED.primary_project,
        template_id=SEED.primary_template,
        article_ids=[a],
    )
    with pytest.raises(BatchNotFoundError) as foreign:
        await owned_batch(db_session, owner_id=SEED.reviewer_profile, batch_id=batch_id)
    with pytest.raises(BatchNotFoundError) as missing:
        await owned_batch(db_session, owner_id=SEED.primary_profile, batch_id=SEED.primary_article)
    assert str(foreign.value) == str(missing.value)


@pytest.mark.asyncio
async def test_an_owner_who_left_the_project_loses_the_batch(db_session: AsyncSession) -> None:
    a = await make_article(db_session, SEED.primary_project)
    batch_id = await make_batch(
        db_session,
        owner_id=SEED.outsider_profile,
        project_id=SEED.primary_project,
        template_id=SEED.primary_template,
        article_ids=[a],
    )
    with pytest.raises(BatchNotFoundError):
        await owned_batch(db_session, owner_id=SEED.outsider_profile, batch_id=batch_id)


@pytest.mark.asyncio
async def test_list_is_seven_days_newest_first_and_filters_active(db_session: AsyncSession) -> None:
    a = await make_article(db_session, SEED.primary_project)
    old = await make_batch(
        db_session,
        owner_id=SEED.primary_profile,
        project_id=SEED.primary_project,
        template_id=SEED.primary_template,
        article_ids=[a],
    )
    await db_session.execute(
        text(
            "UPDATE public.extraction_batches SET created_at = now() - interval '8 days' WHERE id=:id"
        ),
        {"id": str(old)},
    )
    finished = await make_batch(
        db_session,
        owner_id=SEED.primary_profile,
        project_id=SEED.primary_project,
        template_id=SEED.primary_template,
        article_ids=[a],
        created_at=datetime.now(UTC),
    )
    await db_session.execute(
        text("UPDATE public.extraction_batch_items SET status='skipped' WHERE batch_id=:b"),
        {"b": str(finished)},
    )
    active = await make_batch(
        db_session,
        owner_id=SEED.primary_profile,
        project_id=SEED.primary_project,
        template_id=SEED.primary_template,
        article_ids=[a],
    )
    await db_session.execute(
        text(
            "UPDATE public.extraction_batches SET created_at = now() + interval '1 second' WHERE id=:id"
        ),
        {"id": str(active)},
    )

    service = ExtractionBatchService(db_session)
    now = datetime.now(UTC)
    everything = await service.list_for_owner(
        SEED.primary_profile, project_id=None, active_only=False, now=now
    )
    only_active = await service.list_for_owner(
        SEED.primary_profile, project_id=SEED.primary_project, active_only=True, now=now
    )

    ids = [s.id for s in everything]
    assert old not in ids
    assert ids.index(active) < ids.index(finished)
    assert [s.id for s in only_active] == [active]
    assert (
        await service.list_for_owner(
            SEED.reviewer_profile, project_id=None, active_only=False, now=now
        )
        == []
    )
