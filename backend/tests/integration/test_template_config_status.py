"""GET config-status (slices B-4 and B-9a): the Draft chip's read model.

``has_pending_changes`` mirrors the trigger-stamped marker;
``active_version`` mirrors the active version row. BOLA: foreign
templates 404, never leak draft timing.

B-9a adds ``pending_change_count`` — how many changes the open draft
carries, from ``diff_snapshots(active.schema_, live snapshot)``. It is
``None`` (unknowable, not zero) for a clean template, an unpublished one
(D8) and a pre-0026 "narrow" baseline (D5), and ``0`` for the real
marker-set-but-identical state a republish still has to clear.
"""

from __future__ import annotations

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.repositories.extraction_template_version_repository import (
    ExtractionTemplateVersionRepository,
)
from app.schemas.hitl_session import TemplateConfigStatusRead
from app.services import template_version_read_service
from app.services.project_template_active_service import ProjectTemplateNotFoundError
from app.services.template_instruction_service import set_template_instruction
from app.services.template_version_read_service import get_template_config_status
from tests.integration.conftest import SEED, set_config_draft_marker


async def _publish_primary(db: AsyncSession) -> None:
    """Publish the live tree, so the baseline is the wide builder's own
    output (the seeded v1 snapshot is ``{"entity_types": []}`` — narrow)."""
    from app.services.template_version_service import TemplateVersionService

    await TemplateVersionService(db).republish(
        project_id=SEED.primary_project,
        project_template_id=SEED.primary_template,
        user_id=SEED.primary_profile,
    )


async def _status(db: AsyncSession) -> TemplateConfigStatusRead:
    return await get_template_config_status(
        db, project_id=SEED.primary_project, template_id=SEED.primary_template
    )


async def _edit_primary_field_label(db: AsyncSession, suffix: str) -> None:
    """One live config edit — the 0048 trigger stamps the draft marker."""
    await db.execute(
        text("UPDATE public.extraction_fields SET label = label || :suffix WHERE id = :fid"),
        {"fid": str(SEED.primary_field), "suffix": suffix},
    )
    await db.flush()


@pytest.mark.asyncio
async def test_status_flips_with_edit_and_publish(db_session: AsyncSession) -> None:
    from app.services.template_version_service import TemplateVersionService

    await set_config_draft_marker(db_session, SEED.primary_template, None)
    clean = await get_template_config_status(
        db_session,
        project_id=SEED.primary_project,
        template_id=SEED.primary_template,
    )
    assert clean.has_pending_changes is False
    assert clean.project_template_id == SEED.primary_template

    # A live config edit stamps the marker (DB trigger).
    await db_session.execute(
        text("UPDATE public.extraction_fields SET label = label || ' (b4)' WHERE id = :fid"),
        {"fid": str(SEED.primary_field)},
    )
    await db_session.flush()
    pending = await get_template_config_status(
        db_session,
        project_id=SEED.primary_project,
        template_id=SEED.primary_template,
    )
    assert pending.has_pending_changes is True

    published = await TemplateVersionService(db_session).republish(
        project_id=SEED.primary_project,
        project_template_id=SEED.primary_template,
        user_id=SEED.primary_profile,
    )
    after = await get_template_config_status(
        db_session,
        project_id=SEED.primary_project,
        template_id=SEED.primary_template,
    )
    assert after.has_pending_changes is False
    assert after.active_version == published.version


@pytest.mark.asyncio
async def test_status_is_bola_guarded(db_session: AsyncSession) -> None:
    with pytest.raises(ProjectTemplateNotFoundError):
        await get_template_config_status(
            db_session,
            project_id=SEED.secondary_project,
            template_id=SEED.primary_template,
        )


@pytest.mark.asyncio
async def test_count_reports_one_change_against_a_wide_baseline(
    db_session: AsyncSession,
) -> None:
    """A modern (wide) baseline + one label edit ⇒ exactly one change.

    This is the case the narrow gate must NOT swallow: handing
    ``snapshot_is_narrow`` the snapshot dict instead of its
    ``entity_types`` list reads narrow for every template on earth, and
    the count silently degrades to ``None`` here (D5).
    """
    await _publish_primary(db_session)
    published = await _status(db_session)
    assert published.has_pending_changes is False
    assert published.pending_change_count is None

    await _edit_primary_field_label(db_session, " (b9a)")

    pending = await _status(db_session)
    assert pending.has_pending_changes is True
    assert pending.pending_change_count == 1


@pytest.mark.asyncio
async def test_narrow_baseline_suppresses_the_count(db_session: AsyncSession) -> None:
    """Pre-0026 baseline ⇒ ``None``, even though a real edit is pending (D5)."""
    await _publish_primary(db_session)
    active = await ExtractionTemplateVersionRepository(db_session).get_active(SEED.primary_template)
    assert active is not None
    # A pre-0017 shape: the entity type carries no ``role``, so the whole
    # snapshot is untrustworthy as a diff baseline.
    active.schema_ = {
        "entity_types": [
            {"id": str(SEED.primary_entity_type), "label": "Participants", "fields": []}
        ]
    }
    await db_session.flush()

    await _edit_primary_field_label(db_session, " (narrow)")

    status = await _status(db_session)
    assert status.has_pending_changes is True
    assert status.pending_change_count is None


@pytest.mark.asyncio
async def test_clean_template_builds_no_snapshot(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """No marker ⇒ ``None`` without paying for a snapshot build (D7)."""
    await _publish_primary(db_session)

    def _forbidden(*_args: object, **_kwargs: object) -> None:
        raise AssertionError("a clean template must not build the live snapshot")

    monkeypatch.setattr(
        template_version_read_service, "build_template_version_snapshot", _forbidden
    )

    status = await _status(db_session)
    assert status.has_pending_changes is False
    assert status.pending_change_count is None


@pytest.mark.asyncio
async def test_unpublished_template_has_no_count(db_session: AsyncSession) -> None:
    """No active version ⇒ no baseline ⇒ ``None`` (D8), not a crash."""
    # The 0004 active-version invariant is a DEFERRABLE INITIALLY DEFERRED
    # constraint trigger, so this never-committed transaction can hold the
    # unpublished shape the status read must survive.
    await db_session.execute(
        text(
            "UPDATE public.extraction_template_versions SET is_active = false "
            "WHERE project_template_id = :tid"
        ),
        {"tid": str(SEED.primary_template)},
    )
    await _edit_primary_field_label(db_session, " (unpublished)")

    status = await _status(db_session)
    assert status.active_version is None
    assert status.has_pending_changes is True
    assert status.pending_change_count is None


@pytest.mark.asyncio
async def test_noop_edit_chain_counts_zero(db_session: AsyncSession) -> None:
    """A→B→A: the marker is set (unconditional triggers) but the tree is
    identical, so the count is ``0`` — the state the chip renders as a
    bare badge and Publish still has to clear."""
    await _publish_primary(db_session)

    await _edit_primary_field_label(db_session, " (tmp)")
    await db_session.execute(
        text(
            "UPDATE public.extraction_fields SET label = replace(label, ' (tmp)', '') "
            "WHERE id = :fid"
        ),
        {"fid": str(SEED.primary_field)},
    )
    await db_session.flush()

    status = await _status(db_session)
    assert status.has_pending_changes is True
    assert status.pending_change_count == 0


@pytest.mark.asyncio
async def test_discard_available_tracks_the_restorability_gate(
    db_session: AsyncSession,
) -> None:
    """B-9c1 D12: the Discard button has to know before the click.

    True for a wide baseline (with or without an open draft — a drifted
    marker-NULL template is discardable), false for the pre-0026 narrow
    baseline the endpoint refuses with 409."""
    await _publish_primary(db_session)
    assert (await _status(db_session)).discard_available is True

    await _edit_primary_field_label(db_session, " (b9c1)")
    assert (await _status(db_session)).discard_available is True

    active = await ExtractionTemplateVersionRepository(db_session).get_active(SEED.primary_template)
    assert active is not None
    active.schema_ = {
        "entity_types": [
            {"id": str(SEED.primary_entity_type), "label": "Participants", "fields": []}
        ]
    }
    await db_session.flush()

    assert (await _status(db_session)).discard_available is False


@pytest.mark.asyncio
async def test_empty_baseline_yields_a_real_count(db_session: AsyncSession) -> None:
    """B-9c2 D2: the count gate follows ``baseline_is_restorable``, not
    ``snapshot_is_narrow``.

    ``snapshot_is_narrow`` calls an EMPTY list narrow by design (so the run
    view falls back to live rows), but an empty published baseline is a
    perfectly honest diff baseline — every live node reads as added — and
    ``discard_available`` already says so. The invariant the Discard dialog
    rests on: ``discard_available`` ⇒ the count is an int."""
    active = await ExtractionTemplateVersionRepository(db_session).get_active(SEED.primary_template)
    assert active is not None
    active.schema_ = {"entity_types": []}
    await db_session.flush()

    await _edit_primary_field_label(db_session, " (empty baseline)")

    status = await _status(db_session)
    assert status.discard_available is True
    assert status.has_pending_changes is True
    assert isinstance(status.pending_change_count, int)
    assert status.pending_change_count > 0


@pytest.mark.asyncio
async def test_discard_unavailable_without_a_published_version(
    db_session: AsyncSession,
) -> None:
    """No baseline, nothing to discard back to — the endpoint 404s (D12)."""
    await db_session.execute(
        text(
            "UPDATE public.extraction_template_versions SET is_active = false "
            "WHERE project_template_id = :tid"
        ),
        {"tid": str(SEED.primary_template)},
    )
    await db_session.flush()

    assert (await _status(db_session)).discard_available is False


@pytest.mark.asyncio
async def test_instruction_only_draft_counts_one(db_session: AsyncSession) -> None:
    """The instruction PUT stamps the marker without touching a single
    structural row; the diff still sees it (D4's exception)."""
    await _publish_primary(db_session)

    await set_template_instruction(
        db_session,
        project_id=SEED.primary_project,
        template_id=SEED.primary_template,
        llm_template_instruction="Focus on the paediatric subgroup.",
    )

    status = await _status(db_session)
    assert status.has_pending_changes is True
    assert status.pending_change_count == 1
