"""Integration tests for ``TemplateCloneService``.

Covers the heal path for existing clones. The contract (revised when
templates became user-editable):

* **Zero-state** (live structure empty) → rebuild from the global
  template. A clone born empty is unusable; factory state is strictly
  better.
* **Non-empty drift** (live counts != active snapshot counts) → publish
  the LIVE structure as a new active version (self-heal the snapshot).
  Never wipe: with editable templates, a count mismatch is
  indistinguishable from a deliberate edit whose republish failed, and
  the old wipe-and-rebuild-from-global path destroyed user
  customizations (and 500'd on the RESTRICT FK whenever instances
  existed). Live is authoritative.

The production CHARMS project ``bc055915`` (live=1 vs snapshot=14 after
an out-of-band loss) now self-heals the *snapshot* to match live rather
than resurrecting factory structure; true structure recovery is an
explicit re-import after deleting the template.
"""

from __future__ import annotations

from uuid import UUID, uuid4

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
async def test_clone_copies_llm_template_instruction(db_session: AsyncSession) -> None:
    """Imports are born with the framework-tuned default (spec §4): the
    global's instruction is copied onto the project clone AND frozen into
    the v1 snapshot."""
    project_id = SEED.secondary_project
    user_id = SEED.primary_profile
    await _clean_project_clones(db_session, project_id)
    await db_session.execute(
        text(
            "UPDATE public.extraction_templates_global "
            "SET llm_template_instruction = 'Framework default text.' "
            "WHERE id = :gid"
        ),
        {"gid": str(CHARMS_GLOBAL_ID)},
    )

    result = await TemplateCloneService(db_session).clone(
        project_id=project_id,
        global_template_id=CHARMS_GLOBAL_ID,
        user_id=user_id,
        kind=TemplateKind.EXTRACTION,
    )

    project_value = (
        await db_session.execute(
            text(
                "SELECT llm_template_instruction "
                "FROM public.project_extraction_templates WHERE id = :tid"
            ),
            {"tid": str(result.project_template_id)},
        )
    ).scalar_one()
    assert project_value == "Framework default text."

    v1_schema = (
        await db_session.execute(
            text("SELECT schema FROM public.extraction_template_versions WHERE id = :vid"),
            {"vid": str(result.version_id)},
        )
    ).scalar_one()
    assert v1_schema["llm_template_instruction"] == "Framework default text."
    await db_session.rollback()


@pytest.mark.asyncio
async def test_clone_selfheals_snapshot_from_live_on_drift(
    db_session: AsyncSession,
) -> None:
    """Non-empty drift publishes LIVE as the new snapshot — never wipes.

    bc055915-shaped state: 14 entity types in the snapshot but only 1
    live. Re-cloning must keep the 1 live entity type (a count mismatch
    is indistinguishable from a deliberate edit whose republish failed)
    and roll the active snapshot forward to match live.
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

    initial = await service.clone(
        project_id=project_id,
        global_template_id=CHARMS_GLOBAL_ID,
        user_id=user_id,
        kind=TemplateKind.EXTRACTION,
    )
    project_template_id = initial.project_template_id
    assert initial.entity_type_count == 14

    # Simulate the drift: delete all but one entity_type from the live
    # tables, leaving the snapshot intact (snapshot=14, live=1).
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

    healed = await service.clone(
        project_id=project_id,
        global_template_id=CHARMS_GLOBAL_ID,
        user_id=user_id,
        kind=TemplateKind.EXTRACTION,
    )

    assert healed.project_template_id == project_template_id, (
        "Heal must reuse the existing clone, not fork a new one."
    )
    assert healed.entity_type_count == 1, (
        "Non-empty drift must NOT resurrect factory structure — live is "
        "authoritative once templates are user-editable."
    )

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
    assert len(live_after) == 1, "re-clone must not wipe or rebuild live structure"

    active = (
        await db_session.execute(
            select(ExtractionTemplateVersion).where(
                ExtractionTemplateVersion.project_template_id == project_template_id,
                ExtractionTemplateVersion.is_active.is_(True),
            )
        )
    ).scalar_one()
    snapshot_ets = (active.schema_ or {}).get("entity_types", [])
    assert len(snapshot_ets) == 1, "active snapshot must be re-published from live"
    assert active.version == 2, "self-heal publishes a NEW version, never mutates v1"
    assert active.id == healed.version_id

    await db_session.rollback()


@pytest.mark.asyncio
async def test_reclone_selfheals_unsnapshotted_edit_without_wiping(
    db_session: AsyncSession,
) -> None:
    """A live edit whose republish call was lost (e.g. network blip after
    the PostgREST write) must survive a re-import: the heal publishes the
    live structure instead of treating the mismatch as corruption."""
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

    initial = await service.clone(
        project_id=project_id,
        global_template_id=CHARMS_GLOBAL_ID,
        user_id=user_id,
        kind=TemplateKind.EXTRACTION,
    )

    et_id = (
        await db_session.execute(
            select(ExtractionEntityType.id)
            .where(ExtractionEntityType.project_template_id == initial.project_template_id)
            .order_by(ExtractionEntityType.sort_order)
            .limit(1)
        )
    ).scalar_one()
    field_id = uuid4()
    await db_session.execute(
        text(
            "INSERT INTO public.extraction_fields "
            "(id, entity_type_id, name, label, field_type, is_required, sort_order) "
            "VALUES (:id, :et, 'orphan_edit', 'Orphan edit', 'text', false, 999)"
        ),
        {"id": str(field_id), "et": str(et_id)},
    )
    await db_session.flush()

    recloned = await service.clone(
        project_id=project_id,
        global_template_id=CHARMS_GLOBAL_ID,
        user_id=user_id,
        kind=TemplateKind.EXTRACTION,
    )
    assert recloned.project_template_id == initial.project_template_id

    survived = (
        await db_session.execute(
            text("SELECT 1 FROM public.extraction_fields WHERE id = :id"),
            {"id": str(field_id)},
        )
    ).scalar()
    assert survived == 1, "unsnapshotted edit was wiped by the heal"

    active = (
        await db_session.execute(
            select(ExtractionTemplateVersion).where(
                ExtractionTemplateVersion.project_template_id == initial.project_template_id,
                ExtractionTemplateVersion.is_active.is_(True),
            )
        )
    ).scalar_one()
    snapshot_field_names = {
        f["name"]
        for et in (active.schema_ or {}).get("entity_types", [])
        for f in et.get("fields", [])
    }
    assert "orphan_edit" in snapshot_field_names, (
        "heal must publish the live structure so the drift is repaired"
    )

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
