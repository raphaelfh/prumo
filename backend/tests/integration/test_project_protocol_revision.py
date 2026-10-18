"""``projects.protocol_revision`` counts real changes to the review protocol.

Both protocol writers bump it once, inside the row lock they already hold:
``update_details`` when eligibility, study design or review type changes, and
``set_ai_context`` when PICOTS or the "send to AI" switch changes. A no-op or
description-only write never bumps.
"""

from __future__ import annotations

import json
from typing import Any

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.schemas.project_details import ProjectDetailsExpected as E
from app.schemas.project_details import ProjectDetailsFields as F
from app.services.project_ai_context import StaleProtocolRevisionError, set_ai_context
from app.services.project_details_service import update_details
from tests.integration.conftest import SEED

_ELIGIBILITY = {"inclusion": ["adults"], "exclusion": ["children"], "notes": "old"}


async def _revision(db: AsyncSession) -> int:
    return (
        await db.execute(
            text("SELECT protocol_revision FROM public.projects WHERE id = :pid"),
            {"pid": str(SEED.primary_project)},
        )
    ).scalar_one()


async def _seed_row(db: AsyncSession, **cols: Any) -> None:
    """Pin the protocol columns to known values with raw SQL (no bump)."""
    await db.execute(
        text(
            "UPDATE public.projects SET"
            " eligibility_criteria = CAST(:elig AS jsonb),"
            " review_type = CAST(:rt AS review_type),"
            " description = :descr,"
            " picots_config_ai_review = CAST(:picots AS jsonb),"
            " settings = settings - 'ai_context'"
            " WHERE id = :pid"
        ),
        {
            "elig": json.dumps(cols.get("eligibility_criteria", _ELIGIBILITY)),
            "rt": cols.get("review_type", "interventional"),
            "descr": cols.get("description", "d"),
            "picots": json.dumps(cols.get("picots", {"population": {"description": "old"}})),
            "pid": str(SEED.primary_project),
        },
    )
    await db.flush()
    db.expire_all()


@pytest.mark.asyncio
async def test_new_column_defaults_to_one_and_rejects_zero(db_session: AsyncSession) -> None:
    assert await _revision(db_session) >= 1
    with pytest.raises(Exception, match="ck_projects_protocol_revision"):
        async with db_session.begin_nested():
            await db_session.execute(
                text("UPDATE public.projects SET protocol_revision = 0 WHERE id = :pid"),
                {"pid": str(SEED.primary_project)},
            )


@pytest.mark.asyncio
async def test_details_eligibility_bumps_once(db_session: AsyncSession) -> None:
    await _seed_row(db_session)
    start = await _revision(db_session)

    await update_details(
        db_session,
        project_id=SEED.primary_project,
        fields=F(eligibility_criteria={**_ELIGIBILITY, "notes": "new"}),
        expected=E(eligibility_criteria=_ELIGIBILITY),
    )

    assert await _revision(db_session) == start + 1


@pytest.mark.asyncio
async def test_details_review_type_bumps_once(db_session: AsyncSession) -> None:
    await _seed_row(db_session, review_type="interventional")
    start = await _revision(db_session)

    await update_details(
        db_session,
        project_id=SEED.primary_project,
        fields=F(review_type="diagnostic"),
        expected=E(review_type="interventional"),
    )

    assert await _revision(db_session) == start + 1


@pytest.mark.asyncio
async def test_details_description_only_does_not_bump(db_session: AsyncSession) -> None:
    await _seed_row(db_session, description="old")
    start = await _revision(db_session)

    change = await update_details(
        db_session,
        project_id=SEED.primary_project,
        fields=F(description="new"),
        expected=E(description="old"),
    )

    assert change.after == {"description": "new"}
    assert await _revision(db_session) == start


@pytest.mark.asyncio
async def test_details_same_value_does_not_bump(db_session: AsyncSession) -> None:
    await _seed_row(db_session)
    start = await _revision(db_session)

    await update_details(
        db_session,
        project_id=SEED.primary_project,
        fields=F(eligibility_criteria=_ELIGIBILITY),
        expected=E(eligibility_criteria=_ELIGIBILITY),
    )

    assert await _revision(db_session) == start


@pytest.mark.asyncio
async def test_ai_context_picots_bumps_once(db_session: AsyncSession) -> None:
    await _seed_row(db_session)
    start = await _revision(db_session)

    await set_ai_context(
        db_session,
        SEED.primary_project,
        picots={"population": {"description": "new"}},
        picots_enabled=None,
    )

    assert await _revision(db_session) == start + 1


@pytest.mark.asyncio
async def test_ai_context_same_picots_does_not_bump(db_session: AsyncSession) -> None:
    await _seed_row(db_session)
    start = await _revision(db_session)

    await set_ai_context(
        db_session,
        SEED.primary_project,
        picots={"population": {"description": "old"}},
        picots_enabled=None,
    )

    assert await _revision(db_session) == start


@pytest.mark.asyncio
async def test_ai_context_toggle_bumps_once(db_session: AsyncSession) -> None:
    await _seed_row(db_session)  # switch absent = ON
    start = await _revision(db_session)

    await set_ai_context(db_session, SEED.primary_project, picots=None, picots_enabled=False)
    assert await _revision(db_session) == start + 1

    await set_ai_context(db_session, SEED.primary_project, picots=None, picots_enabled=False)
    assert await _revision(db_session) == start + 1


@pytest.mark.asyncio
async def test_ai_context_both_halves_bump_once(db_session: AsyncSession) -> None:
    await _seed_row(db_session)
    start = await _revision(db_session)

    await set_ai_context(
        db_session,
        SEED.primary_project,
        picots={"population": {"description": "new"}},
        picots_enabled=False,
    )

    assert await _revision(db_session) == start + 1


@pytest.mark.asyncio
async def test_slot_updates_replace_only_the_named_slots(db_session: AsyncSession) -> None:
    await _seed_row(
        db_session,
        picots={"population": {"description": "old"}, "outcomes": {"description": "kept"}},
    )
    start = await _revision(db_session)
    new_population = {"description": "new", "inclusion": ["adults"], "exclusion": []}

    result = await set_ai_context(
        db_session,
        SEED.primary_project,
        picots=None,
        picots_enabled=None,
        slot_updates={"population": new_population},
    )

    stored = (
        await db_session.execute(
            text("SELECT picots_config_ai_review FROM public.projects WHERE id = :pid"),
            {"pid": str(SEED.primary_project)},
        )
    ).scalar_one()
    assert stored == {"population": new_population, "outcomes": {"description": "kept"}}
    assert result["revision"] == start + 1
    assert await _revision(db_session) == start + 1


@pytest.mark.asyncio
async def test_slot_updates_with_the_same_value_do_not_bump(db_session: AsyncSession) -> None:
    await _seed_row(db_session, picots={"population": {"description": "old"}})
    start = await _revision(db_session)

    await set_ai_context(
        db_session,
        SEED.primary_project,
        picots=None,
        picots_enabled=None,
        slot_updates={"population": {"description": "old"}},
    )

    assert await _revision(db_session) == start


@pytest.mark.asyncio
async def test_slot_updates_over_a_non_mapping_row_start_from_empty(
    db_session: AsyncSession,
) -> None:
    await _seed_row(db_session, picots="junk")

    await set_ai_context(
        db_session,
        SEED.primary_project,
        picots=None,
        picots_enabled=None,
        slot_updates={"timing": {"description": "30 days"}},
    )

    stored = (
        await db_session.execute(
            text("SELECT picots_config_ai_review FROM public.projects WHERE id = :pid"),
            {"pid": str(SEED.primary_project)},
        )
    ).scalar_one()
    assert stored == {"timing": {"description": "30 days"}}


@pytest.mark.asyncio
async def test_picots_and_slot_updates_together_raise(db_session: AsyncSession) -> None:
    with pytest.raises(ValueError, match="mutually exclusive"):
        await set_ai_context(
            db_session,
            SEED.primary_project,
            picots={"population": {"description": "x"}},
            picots_enabled=None,
            slot_updates={"population": {"description": "y"}},
        )


@pytest.mark.asyncio
async def test_stale_expected_revision_raises_under_the_lock_and_writes_nothing(
    db_session: AsyncSession,
) -> None:
    await _seed_row(db_session)
    start = await _revision(db_session)

    with pytest.raises(StaleProtocolRevisionError) as info:
        await set_ai_context(
            db_session,
            SEED.primary_project,
            picots=None,
            picots_enabled=False,
            expected_revision=start + 1,
            slot_updates={"population": {"description": "new"}},
        )

    assert info.value.status_code == 409
    assert info.value.details is not None
    assert info.value.details["current_revision"] == start
    assert info.value.details["current"]["revision"] == start
    assert info.value.details["current"]["picots_enabled"] is True
    assert info.value.details["current"]["picots"]["population"]["description"] == "old"
    await db_session.flush()
    db_session.expire_all()
    assert await _revision(db_session) == start
    settings = (
        await db_session.execute(
            text("SELECT settings FROM public.projects WHERE id = :pid"),
            {"pid": str(SEED.primary_project)},
        )
    ).scalar_one()
    assert "ai_context" not in (settings or {})


@pytest.mark.asyncio
async def test_matching_expected_revision_writes_and_bumps(db_session: AsyncSession) -> None:
    await _seed_row(db_session)
    start = await _revision(db_session)

    result = await set_ai_context(
        db_session,
        SEED.primary_project,
        picots=None,
        picots_enabled=False,
        expected_revision=start,
    )

    assert result["revision"] == start + 1
    assert result["picots_enabled"] is False
