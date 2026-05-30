"""Integration tests for ``TemplateCloneService``.

Specifically covers the heal path: when a project_extraction_templates
row exists but its live structure (entity_types + fields) drifts from
the immutable snapshot in ``extraction_template_versions.schema``,
re-invoking ``clone`` rebuilds the structure to match.

The current heal trigger only fires when live count = 0 ("clone was
born empty"). This file pins down the broader contract: any drift
between snapshot and live, including partial state (some entity_types
present but fewer than the snapshot), triggers heal. The repro is the
production CHARMS project ``bc055915`` whose clone has 1 entity_type
live but 14 in the snapshot — pre-fix, the heal stays silent.
"""

from __future__ import annotations

from uuid import UUID

import pytest
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction import (
    ExtractionEntityType,
    TemplateKind,
)
from app.models.extraction_versioning import ExtractionTemplateVersion
from app.services.template_clone_service import TemplateCloneService
from tests.integration.conftest import SEED

CHARMS_GLOBAL_ID = UUID("000c0000-0000-0000-0000-000000000001")


async def _clean_project_clones(db: AsyncSession, project_id: UUID) -> None:
    """Wipe all extraction templates / clones for the test project so each
    test starts from a clean slate. CASCADE clears entity_types + fields
    + version snapshots + instances tied to the templates."""
    await db.execute(
        text("DELETE FROM public.project_extraction_templates WHERE project_id = :pid"),
        {"pid": str(project_id)},
    )


@pytest.mark.asyncio
async def test_clone_creates_full_structure_when_fresh(db_session: AsyncSession) -> None:
    """Baseline: a fresh clone copies every entity_type + field from the
    global template. Pins down what 'aligned' looks like."""
    if (
        await db_session.execute(
            text("SELECT 1 FROM public.profiles WHERE id = :id"),
            {"id": str(SEED.primary_profile)},
        )
    ).scalar() is None:
        pytest.skip("Missing fixtures.")
    project_id = SEED.secondary_project
    user_id = SEED.primary_profile

    await _clean_project_clones(db_session, project_id)

    result = await TemplateCloneService(db_session).clone(
        project_id=project_id,
        global_template_id=CHARMS_GLOBAL_ID,
        user_id=user_id,
        kind=TemplateKind.EXTRACTION,
    )
    assert result.created is True
    assert result.entity_type_count == 14, (
        f"CHARMS global has 14 entity_types; fresh clone produced {result.entity_type_count}."
    )
    assert result.field_count > 0
    await db_session.rollback()


@pytest.mark.asyncio
async def test_clone_heals_partial_structure_drift_against_snapshot(
    db_session: AsyncSession,
) -> None:
    """H3 — Invariant I-3: a clone whose live entity_type count drifts
    from its active version snapshot triggers heal on re-clone.

    Repros production bug (project bc055915): the clone has 14 entity
    types in the snapshot but only 1 in the live tables. The current
    heal only fires on zero-state, so the drift goes undetected.
    """
    if (
        await db_session.execute(
            text("SELECT 1 FROM public.profiles WHERE id = :id"),
            {"id": str(SEED.primary_profile)},
        )
    ).scalar() is None:
        pytest.skip("Missing fixtures.")
    project_id = SEED.secondary_project
    user_id = SEED.primary_profile

    await _clean_project_clones(db_session, project_id)
    service = TemplateCloneService(db_session)

    # 1. Initial healthy clone.
    initial = await service.clone(
        project_id=project_id,
        global_template_id=CHARMS_GLOBAL_ID,
        user_id=user_id,
        kind=TemplateKind.EXTRACTION,
    )
    project_template_id = initial.project_template_id
    snapshot_et_count = initial.entity_type_count
    snapshot_field_count = initial.field_count
    assert snapshot_et_count == 14

    # 2. Simulate the production drift: delete all but one entity_type
    #    (and its fields) from the live tables, leaving the snapshot
    #    intact. Mirrors the bc055915 state (snapshot=14, live=1).
    keep_et_id = (
        await db_session.execute(
            select(ExtractionEntityType.id)
            .where(ExtractionEntityType.project_template_id == project_template_id)
            .order_by(ExtractionEntityType.sort_order)
            .limit(1)
        )
    ).scalar_one()
    await db_session.execute(
        text(
            "DELETE FROM public.extraction_entity_types "
            "WHERE project_template_id = :tid AND id != :keep"
        ),
        {"tid": str(project_template_id), "keep": str(keep_et_id)},
    )
    await db_session.flush()

    live_et_count = (
        (
            await db_session.execute(
                select(ExtractionEntityType).where(
                    ExtractionEntityType.project_template_id == project_template_id
                )
            )
        )
        .scalars()
        .all()
    )
    assert len(live_et_count) == 1, "drift simulation expected exactly 1 live entity_type"

    # 3. Re-clone with the same (project, global_template_id). Heal must
    #    detect the drift and rebuild the live structure to match the
    #    snapshot. Without the H3 fix, this is a no-op and the drift
    #    persists.
    healed = await service.clone(
        project_id=project_id,
        global_template_id=CHARMS_GLOBAL_ID,
        user_id=user_id,
        kind=TemplateKind.EXTRACTION,
    )

    assert healed.project_template_id == project_template_id, (
        "Heal must reuse the existing clone, not fork a new one."
    )
    assert healed.entity_type_count == snapshot_et_count, (
        f"After heal, live entity_type count ({healed.entity_type_count}) "
        f"must match snapshot ({snapshot_et_count}). Drift not detected."
    )
    assert healed.field_count == snapshot_field_count

    # Defence-in-depth: the live table count must also match the report.
    live_after = (
        (
            await db_session.execute(
                select(ExtractionEntityType).where(
                    ExtractionEntityType.project_template_id == project_template_id
                )
            )
        )
        .scalars()
        .all()
    )
    assert len(live_after) == snapshot_et_count

    await db_session.rollback()


@pytest.mark.asyncio
async def test_clone_is_noop_when_aligned(db_session: AsyncSession) -> None:
    """Re-cloning an aligned template is a no-op: no extra rows, no
    rewritten structure. Idempotency at the heal boundary."""
    if (
        await db_session.execute(
            text("SELECT 1 FROM public.profiles WHERE id = :id"),
            {"id": str(SEED.primary_profile)},
        )
    ).scalar() is None:
        pytest.skip("Missing fixtures.")
    project_id = SEED.secondary_project
    user_id = SEED.primary_profile

    await _clean_project_clones(db_session, project_id)
    service = TemplateCloneService(db_session)

    first = await service.clone(
        project_id=project_id,
        global_template_id=CHARMS_GLOBAL_ID,
        user_id=user_id,
        kind=TemplateKind.EXTRACTION,
    )
    second = await service.clone(
        project_id=project_id,
        global_template_id=CHARMS_GLOBAL_ID,
        user_id=user_id,
        kind=TemplateKind.EXTRACTION,
    )

    assert second.created is False
    assert second.project_template_id == first.project_template_id
    assert second.entity_type_count == first.entity_type_count
    assert second.field_count == first.field_count

    # Snapshot version should not roll forward — heal only updates the
    # snapshot when it actually rebuilt structure.
    version_ids = (
        (
            await db_session.execute(
                select(ExtractionTemplateVersion.id).where(
                    ExtractionTemplateVersion.project_template_id == first.project_template_id,
                    ExtractionTemplateVersion.is_active.is_(True),
                )
            )
        )
        .scalars()
        .all()
    )
    assert len(version_ids) == 1
    assert version_ids[0] == first.version_id

    await db_session.rollback()
