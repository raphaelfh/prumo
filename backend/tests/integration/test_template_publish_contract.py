"""The publish contract: what the manager saw is what gets published (B-9b2b).

The Publish sheet is computed lock-free, so between render and click the
projection can move. These tests exercise the three ways it moves and the one
way it must not be bypassed.

Deliberately a separate file from ``test_template_version_republish``: that one
owns the publish MACHINERY (v+1, re-pin, materialize, the many->one re-check),
this one owns the CONTRACT layered on top.
"""

from __future__ import annotations

from uuid import UUID

import pytest
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.template_change import ChangeTier, DiffStatus
from app.models.extraction_versioning import ExtractionTemplateVersion
from app.schemas.hitl_session import TemplateChangeAck
from app.services.template_version_read_service import get_template_config_diff
from app.services.template_version_service import (
    PublishDiffDriftedError,
    PublishMissingAcknowledgementError,
    TemplateVersionService,
)
from tests.integration.conftest import SEED, make_proposal, open_session
from tests.integration.helpers.template_fixtures import (
    ARTICLE_ID,
    delete_field,
    entity_id,
    field_id,
    force_narrow_baseline,
    fresh_charms,
)


async def _diff(db: AsyncSession, project_id: UUID, template_id: UUID):
    return await get_template_config_diff(db, project_id=project_id, template_id=template_id)


async def _publish(
    db: AsyncSession,
    project_id: UUID,
    template_id: UUID,
    *,
    fingerprint: str | None,
    acks: tuple[TemplateChangeAck, ...] = (),
    note: str | None = None,
):
    return await TemplateVersionService(db).republish(
        project_id=project_id,
        project_template_id=template_id,
        user_id=SEED.primary_profile,
        enforce_publish_contract=True,
        expected_fingerprint=fingerprint,
        acknowledged=acks,
        note=note,
    )


async def _delete_a_field(db: AsyncSession, template_id: UUID) -> str:
    """Remove a field with no recorded work — a DESTRUCTIVE row, ack-required."""
    target = await field_id(db, template_id, "sample_size", "epv_epp")
    await delete_field(db, target)
    return f"removed:field:{target}:-:-"


async def _record_a_value(db: AsyncSession, project_id: UUID, template_id: UUID) -> UUID:
    owner = await entity_id(db, template_id, "sample_size")
    target = await field_id(db, template_id, "sample_size", "number_of_participants")
    session = await open_session(
        db,
        project_id=project_id,
        article_id=ARTICLE_ID,
        template_id=template_id,
        user_id=SEED.primary_profile,
    )
    await make_proposal(
        db,
        run_id=session.run_id,
        instance_id=UUID(session.instances_by_entity_type[str(owner)]),
        field_id=target,
        user_id=SEED.primary_profile,
    )
    return target


@pytest.mark.asyncio
async def test_a_matching_fingerprint_and_ack_publishes(db_session: AsyncSession) -> None:
    """The happy path, and the only test here that asserts the note round trips.

    The note is the one field this slice persists; without an assertion it
    could be silently dropped and only surface when History tries to render
    it.
    """
    project_id, template_id, _ = await fresh_charms(db_session)
    row_id = await _delete_a_field(db_session, template_id)

    diff = await _diff(db_session, project_id, template_id)
    assert [r.id for r in diff.changes.destructive] == [row_id]

    result = await _publish(
        db_session,
        project_id,
        template_id,
        fingerprint=diff.fingerprint,
        acks=(TemplateChangeAck(id=row_id, tier=ChangeTier.DESTRUCTIVE),),
        note="Dropped the unused EPV/EPP field.",
    )

    assert result.changed is True
    stored = (
        await db_session.execute(
            select(ExtractionTemplateVersion.note).where(
                ExtractionTemplateVersion.id == result.version_id
            )
        )
    ).scalar_one()
    assert stored == "Dropped the unused EPV/EPP field."


@pytest.mark.asyncio
async def test_an_unacknowledged_destructive_row_refuses(db_session: AsyncSession) -> None:
    """A correct fingerprint is not consent — the row still needs its tick."""
    project_id, template_id, _ = await fresh_charms(db_session)
    row_id = await _delete_a_field(db_session, template_id)
    diff = await _diff(db_session, project_id, template_id)

    with pytest.raises(PublishMissingAcknowledgementError) as excinfo:
        await _publish(db_session, project_id, template_id, fingerprint=diff.fingerprint)

    assert excinfo.value.details == {"row_ids": [row_id]}


@pytest.mark.asyncio
async def test_an_empty_ack_list_refuses_rather_than_skipping(
    db_session: AsyncSession,
) -> None:
    """Enforcement is driven by the flag, never by what the client sent.

    Inferring "check only if they sent acks" would make the contract
    opt-in from the caller — the exact bypass this design exists to close.
    """
    project_id, template_id, _ = await fresh_charms(db_session)
    await _delete_a_field(db_session, template_id)
    diff = await _diff(db_session, project_id, template_id)

    with pytest.raises(PublishMissingAcknowledgementError):
        await _publish(db_session, project_id, template_id, fingerprint=diff.fingerprint, acks=())


@pytest.mark.asyncio
async def test_a_missing_fingerprint_refuses_when_a_diff_is_computable(
    db_session: AsyncSession,
) -> None:
    """No fingerprint for an available diff means a sheet nobody looked at."""
    project_id, template_id, _ = await fresh_charms(db_session)
    await _delete_a_field(db_session, template_id)

    with pytest.raises(PublishDiffDriftedError) as excinfo:
        await _publish(db_session, project_id, template_id, fingerprint=None)

    fresh = await _diff(db_session, project_id, template_id)
    assert excinfo.value.details == {"fingerprint": fresh.fingerprint}


@pytest.mark.asyncio
async def test_a_tier_escalation_between_render_and_publish_refuses(
    db_session: AsyncSession,
) -> None:
    """The headline case: nobody edited the template, yet the sheet is stale.

    A reviewer recorded one answer, which flips the field_type row
    SEMANTIC -> DESTRUCTIVE. The manager's ack — taken when the row was
    SEMANTIC — no longer matches, and the fingerprint moved too, so the
    publish refuses instead of shipping a destructive change nobody
    confirmed.
    """
    project_id, template_id, _ = await fresh_charms(db_session)
    target = await field_id(db_session, template_id, "sample_size", "number_of_participants")
    await db_session.execute(
        text("UPDATE public.extraction_fields SET field_type = 'text' WHERE id = :fid"),
        {"fid": str(target)},
    )
    await db_session.flush()

    rendered = await _diff(db_session, project_id, template_id)
    row_id = f"modified:field:{target}:field_type:-"
    assert [r.id for r in rendered.changes.semantic] == [row_id]
    assert rendered.changes.destructive == []

    # ... a reviewer answers that field while the sheet is open.
    assert await _record_a_value(db_session, project_id, template_id) == target

    with pytest.raises(PublishDiffDriftedError):
        await _publish(
            db_session,
            project_id,
            template_id,
            fingerprint=rendered.fingerprint,
            acks=(TemplateChangeAck(id=row_id, tier=ChangeTier.SEMANTIC),),
        )

    escalated = await _diff(db_session, project_id, template_id)
    assert [r.id for r in escalated.changes.destructive] == [row_id], (
        "the row must have escalated with the tree untouched"
    )


@pytest.mark.asyncio
async def test_a_refusal_leaves_the_draft_marker_set(db_session: AsyncSession) -> None:
    """Placement guard: the contract check runs BEFORE the marker is cleared.

    If it ran after, a refused publish would leave the template looking
    clean — no Draft chip, no Publish button — with the edits still live.
    """
    project_id, template_id, _ = await fresh_charms(db_session)
    await _delete_a_field(db_session, template_id)
    await db_session.execute(
        text(
            "UPDATE public.project_extraction_templates "
            "SET config_draft_since = now() WHERE id = :tid"
        ),
        {"tid": str(template_id)},
    )
    await db_session.flush()

    # A CORRECT fingerprint, so the refusal comes from the deeper ack check
    # rather than short-circuiting on drift — the marker must survive either.
    diff = await _diff(db_session, project_id, template_id)
    with pytest.raises(PublishMissingAcknowledgementError):
        await _publish(db_session, project_id, template_id, fingerprint=diff.fingerprint)

    marker = (
        await db_session.execute(
            text(
                "SELECT config_draft_since FROM public.project_extraction_templates WHERE id = :tid"
            ),
            {"tid": str(template_id)},
        )
    ).scalar_one()
    assert marker is not None, "a refused publish must not clear the draft marker"


@pytest.mark.asyncio
async def test_a_note_on_a_noop_publish_is_not_recorded_and_says_so(
    db_session: AsyncSession,
) -> None:
    """The no-op hole, pinned rather than papered over.

    A draft whose edits cancel out (A->B->A) still has its marker set, so
    Publish is a legitimate action — it clears the marker. But there is no
    new version row for a note to land on, and rewriting the CURRENT row's
    note would attribute prose to a version someone else published.

    So the note is not recorded, and that is knowable rather than silent:
    ``changed=False`` is exactly the signal, and the Publish sheet tells
    the manager instead of swallowing what they typed. A fourth refusal
    code would block a publish the manager is entitled to make.
    """
    project_id, template_id, _ = await fresh_charms(db_session)
    before = await _diff(db_session, project_id, template_id)
    assert before.status is DiffStatus.AVAILABLE
    assert before.changes.destructive == []

    result = await _publish(
        db_session,
        project_id,
        template_id,
        fingerprint=before.fingerprint,
        note="This prose has nowhere to live.",
    )

    assert result.changed is False, "nothing changed, so no version was spawned"
    stored = (
        await db_session.execute(
            select(ExtractionTemplateVersion.note).where(
                ExtractionTemplateVersion.id == result.version_id
            )
        )
    ).scalar_one()
    assert stored is None, "the pre-existing version's note must not be rewritten"


@pytest.mark.asyncio
async def test_callers_that_do_not_opt_in_are_unaffected(db_session: AsyncSession) -> None:
    """D3's zero blast radius, asserted rather than assumed.

    The clone/restore callers publish with no fingerprint and no acks. If
    enforcement were inferred from the arguments instead of the flag, this
    would refuse and three production paths would break.
    """
    project_id, template_id, _ = await fresh_charms(db_session)
    await _delete_a_field(db_session, template_id)

    result = await TemplateVersionService(db_session).republish(
        project_id=project_id,
        project_template_id=template_id,
        user_id=SEED.primary_profile,
    )

    assert result.changed is True


@pytest.mark.asyncio
async def test_an_undiffable_baseline_cannot_be_gated(db_session: AsyncSession) -> None:
    """Stated in the plan as a known bound, so pinned here rather than assumed.

    A narrow pre-0026 baseline yields no diff, so there are no rows and no
    acks to require. It self-heals: the version written here is built from
    LIVE rows, so the NEXT publish has a wide baseline and is fully gated.
    """
    project_id, template_id, _ = await fresh_charms(db_session)
    section = await entity_id(db_session, template_id, "sample_size")
    await force_narrow_baseline(db_session, template_id, section)
    await _delete_a_field(db_session, template_id)

    assert (await _diff(db_session, project_id, template_id)).status is DiffStatus.BASELINE_TOO_OLD
    result = await _publish(db_session, project_id, template_id, fingerprint=None)
    assert result.changed is True

    healed = await _diff(db_session, project_id, template_id)
    assert healed.status is DiffStatus.AVAILABLE, "the next publish must be gated"
