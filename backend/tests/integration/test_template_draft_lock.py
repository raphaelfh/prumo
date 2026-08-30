"""The advisory editor lock on the config draft (B-9f).

Spec section 1: one server-persisted draft per template with an advisory
editor lock ("Draft · 6 changes · started Jul 30 by M. Costa · Take over").
Spec section 8: a typed 409 carrying holder identity.

"Advisory" is the load-bearing word. These tests pin the two properties
that keep it advisory rather than a mutex:

* an unattributed draft (``config_draft_by IS NULL``) is CLAIMABLE, so a
  draft opened before this column existed — or by a raw PostgREST write —
  never strands the template;
* a takeover always succeeds, so a laptop that went to sleep mid-draft
  cannot hold the template hostage.
"""

from __future__ import annotations

from uuid import UUID, uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.project_template_active_service import ProjectTemplateNotFoundError
from app.services.template_draft_lock_service import (
    DraftLockHeldError,
    claim_draft_lock,
    release_draft_lock,
    take_over_draft_lock,
)
from tests.integration.conftest import SEED
from tests.integration.helpers.template_fixtures import fresh_charms


async def _holder(db: AsyncSession, template_id: UUID):
    return (
        await db.execute(
            text("SELECT config_draft_by FROM public.project_extraction_templates WHERE id = :t"),
            {"t": str(template_id)},
        )
    ).scalar_one()


async def _seed_other_profile(db: AsyncSession) -> tuple[UUID, str | None]:
    """The SEED's second profile.

    ``profiles.id`` FKs to ``auth.users.id``, so a lock holder cannot be an
    invented uuid — it has to be a profile that really exists.
    """
    name = (
        await db.execute(
            text("SELECT full_name FROM public.profiles WHERE id = :id"),
            {"id": str(SEED.reviewer_profile)},
        )
    ).scalar_one()
    return SEED.reviewer_profile, name


@pytest.mark.asyncio
async def test_the_first_writer_claims_an_unheld_draft(db_session: AsyncSession) -> None:
    project_id, template_id, _ = await fresh_charms(db_session)

    await claim_draft_lock(
        db_session, project_id=project_id, template_id=template_id, user_id=SEED.primary_profile
    )

    assert await _holder(db_session, template_id) == SEED.primary_profile


@pytest.mark.asyncio
async def test_the_holder_can_keep_writing(db_session: AsyncSession) -> None:
    """Idempotent for the holder: every write re-claims, none refuses."""
    project_id, template_id, _ = await fresh_charms(db_session)

    await claim_draft_lock(
        db_session, project_id=project_id, template_id=template_id, user_id=SEED.primary_profile
    )
    await claim_draft_lock(
        db_session, project_id=project_id, template_id=template_id, user_id=SEED.primary_profile
    )

    assert await _holder(db_session, template_id) == SEED.primary_profile


@pytest.mark.asyncio
async def test_a_second_editor_is_refused_with_the_holder_named(
    db_session: AsyncSession,
) -> None:
    """The 409 has to identify the holder, or "Take over" is a blind click."""
    project_id, template_id, _ = await fresh_charms(db_session)
    other, other_name = await _seed_other_profile(db_session)
    await claim_draft_lock(
        db_session, project_id=project_id, template_id=template_id, user_id=other
    )

    with pytest.raises(DraftLockHeldError) as excinfo:
        await claim_draft_lock(
            db_session, project_id=project_id, template_id=template_id, user_id=SEED.primary_profile
        )

    details = excinfo.value.details or {}
    assert details.get("holder_id") == str(other)
    assert details.get("holder_name") == other_name
    # The holder must not be displaced by a refused write.
    assert await _holder(db_session, template_id) == other


@pytest.mark.asyncio
async def test_an_unattributed_draft_is_claimable(db_session: AsyncSession) -> None:
    """The state every pre-existing draft is in, and the anti-strand rule.

    A draft opened before this column existed — or by a raw PostgREST
    write, which 0049 still permits — has a timestamp but no holder. If
    that refused writes, those templates would be permanently unusable.
    """
    project_id, template_id, _ = await fresh_charms(db_session)
    await db_session.execute(
        text(
            "UPDATE public.project_extraction_templates "
            "SET config_draft_since = now(), config_draft_by = NULL WHERE id = :t"
        ),
        {"t": str(template_id)},
    )
    await db_session.flush()

    await claim_draft_lock(
        db_session, project_id=project_id, template_id=template_id, user_id=SEED.primary_profile
    )

    assert await _holder(db_session, template_id) == SEED.primary_profile


@pytest.mark.asyncio
async def test_take_over_always_wins(db_session: AsyncSession) -> None:
    """A sleeping laptop must never hold a template hostage."""
    project_id, template_id, _ = await fresh_charms(db_session)
    other, other_name = await _seed_other_profile(db_session)
    await claim_draft_lock(
        db_session, project_id=project_id, template_id=template_id, user_id=other
    )

    result = await take_over_draft_lock(
        db_session, project_id=project_id, template_id=template_id, user_id=SEED.primary_profile
    )

    assert result.previous_holder_id == other
    assert await _holder(db_session, template_id) == SEED.primary_profile


@pytest.mark.asyncio
async def test_the_displaced_holder_is_refused_on_their_next_write(
    db_session: AsyncSession,
) -> None:
    """The whole point of the conditional claim: no lost-update window.

    The displaced editor learns at their next write, not at takeover time —
    there is no push channel. Nothing they wrote is lost: there is exactly
    ONE draft, so their earlier edits are already in it.
    """
    project_id, template_id, _ = await fresh_charms(db_session)
    other, other_name = await _seed_other_profile(db_session)
    await claim_draft_lock(
        db_session, project_id=project_id, template_id=template_id, user_id=other
    )
    await take_over_draft_lock(
        db_session, project_id=project_id, template_id=template_id, user_id=SEED.primary_profile
    )

    with pytest.raises(DraftLockHeldError):
        await claim_draft_lock(
            db_session, project_id=project_id, template_id=template_id, user_id=other
        )


@pytest.mark.asyncio
async def test_releasing_clears_the_holder(db_session: AsyncSession) -> None:
    """Publish and Discard end the draft, so they end the lock with it."""
    project_id, template_id, _ = await fresh_charms(db_session)
    await claim_draft_lock(
        db_session, project_id=project_id, template_id=template_id, user_id=SEED.primary_profile
    )

    await release_draft_lock(db_session, template_id=template_id)

    assert await _holder(db_session, template_id) is None


@pytest.mark.asyncio
async def test_an_unknown_template_refuses_rather_than_silently_passing(
    db_session: AsyncSession,
) -> None:
    """A claim that matched no row must never read as "lock acquired".

    It now refuses as NOT-FOUND rather than HELD. Both refuse, but "held"
    was a small lie with a real cost: it is a 409 that names a holder, so an
    unknown — or foreign — template answered differently from a missing one.
    """
    project_id, _, _ = await fresh_charms(db_session)
    with pytest.raises(ProjectTemplateNotFoundError):
        await claim_draft_lock(
            db_session,
            project_id=project_id,
            template_id=uuid4(),
            user_id=SEED.primary_profile,
        )


@pytest.mark.asyncio
async def test_a_template_outside_the_project_refuses_as_not_found(
    db_session: AsyncSession,
) -> None:
    """The scope is in the claim's WHERE, so a foreign template is
    indistinguishable from a missing one — and its row is never touched."""
    _, template_id, _ = await fresh_charms(db_session)

    with pytest.raises(ProjectTemplateNotFoundError):
        await claim_draft_lock(
            db_session,
            project_id=SEED.primary_project,
            template_id=template_id,
            user_id=SEED.primary_profile,
        )

    assert await _holder(db_session, template_id) is None


@pytest.mark.asyncio
async def test_take_over_refuses_a_template_outside_the_project(
    db_session: AsyncSession,
) -> None:
    """Take-over is unconditional about the HOLDER, never about the project.

    ``project_id`` used to be optional here with a hand-rolled ownership
    SELECT; it is now required and routed through ``owned_template``, so a
    foreign template refuses exactly like a missing one — and the seizing
    UPDATE never matches it.
    """
    _, template_id, _ = await fresh_charms(db_session)
    other, _ = await _seed_other_profile(db_session)
    await claim_draft_lock(
        db_session,
        project_id=SEED.secondary_project,
        template_id=template_id,
        user_id=other,
    )

    with pytest.raises(ProjectTemplateNotFoundError):
        await take_over_draft_lock(
            db_session,
            project_id=SEED.primary_project,
            template_id=template_id,
            user_id=SEED.primary_profile,
        )

    assert await _holder(db_session, template_id) == other
