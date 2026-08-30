"""Integration tests for ``TemplateCloneService``.

Covers the heal path for existing clones. The contract (revised when
templates became user-editable):

* **Zero-state** (live structure empty) → rebuild from the global
  template. A clone born empty is unusable; factory state is strictly
  better. Refused only when the live ``llm_template_instruction`` differs
  from the pinned one: the rebuild never resets that column and republish
  snapshots it live, so healing would publish unapproved prompt text —
  and session-open reaches this branch as any project MEMBER.
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

from datetime import UTC, datetime
from uuid import uuid4

import pytest
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction import (
    ExtractionEntityType,
    ExtractionTemplateGlobal,
    TemplateKind,
)
from app.models.extraction_versioning import ExtractionTemplateVersion
from app.services.template_clone_service import TemplateCloneService
from tests.integration.conftest import (
    CHARMS_GLOBAL_ID,
    SEED,
    clean_project_clones,
    get_config_draft_marker,
    set_config_draft_marker,
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

    await clean_project_clones(db_session, project_id)

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
    await clean_project_clones(db_session, project_id)
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
async def test_clone_carries_entry_label(db_session: AsyncSession) -> None:
    """B-8: the container's entry noun survives the global -> project
    copy and is frozen into the v1 snapshot."""
    project_id = SEED.secondary_project
    user_id = SEED.primary_profile
    await clean_project_clones(db_session, project_id)

    result = await TemplateCloneService(db_session).clone(
        project_id=project_id,
        global_template_id=CHARMS_GLOBAL_ID,
        user_id=user_id,
        kind=TemplateKind.EXTRACTION,
    )

    container = (
        await db_session.execute(
            select(ExtractionEntityType).where(
                ExtractionEntityType.project_template_id == result.project_template_id,
                ExtractionEntityType.role == "model_container",
            )
        )
    ).scalar_one()
    assert container.entry_label == "model", "clone must carry the global's entry_label"

    v1_schema = (
        await db_session.execute(
            text("SELECT schema FROM public.extraction_template_versions WHERE id = :vid"),
            {"vid": str(result.version_id)},
        )
    ).scalar_one()
    snapshot_container = next(
        et for et in v1_schema["entity_types"] if et["role"] == "model_container"
    )
    assert snapshot_container["entry_label"] == "model"
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

    await clean_project_clones(db_session, project_id)
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
    # B-4: the raw-SQL delete stamped the draft marker; a marker-NULL
    # drift is the LOST-REPUBLISH shape this test simulates (a pending
    # draft now 409s instead — covered separately below).
    await set_config_draft_marker(db_session, project_template_id, None)

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

    await clean_project_clones(db_session, project_id)
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
    # B-4: the raw-SQL insert stamped the draft marker; reset to NULL to
    # simulate the lost-republish shape (marker-set drift 409s instead).
    await set_config_draft_marker(db_session, initial.project_template_id, None)

    # The global gains a rule key while the clone is drifted.
    global_tpl = await db_session.get(ExtractionTemplateGlobal, CHARMS_GLOBAL_ID)
    assert global_tpl is not None
    global_tpl.schema_ = {"scope_rules": {}}
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

    # The schema_ refresh sits after the republish block precisely so every
    # heal path reaches it. Moving it into the aligned-only path would leave
    # a drifted clone stuck on the rules it was cloned with.
    persisted = (
        await db_session.execute(
            text('SELECT "schema" FROM public.project_extraction_templates WHERE id = :id'),
            {"id": str(initial.project_template_id)},
        )
    ).scalar_one()
    assert persisted == {"scope_rules": {}}, "drift heal must refresh schema_ too"

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

    await clean_project_clones(db_session, project_id)
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


# ---------------------------------------------------------------------------
# B-4: re-import vs the config draft marker. The 409 protects exactly one
# thing — the drift heal silently PUBLISHING a pending draft. Zero-state
# rebuilds regardless of marker (documented factory recovery: delete-all +
# re-import); the aligned path publishes nothing, so the draft survives.
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_reimport_with_pending_draft_and_drift_raises(
    db_session: AsyncSession,
) -> None:
    """Marker set + count drift → typed refusal, structure untouched."""
    from app.services.template_clone_service import PendingConfigDraftError

    project_id = SEED.secondary_project
    user_id = SEED.primary_profile
    await clean_project_clones(db_session, project_id)
    service = TemplateCloneService(db_session)
    initial = await service.clone(
        project_id=project_id,
        global_template_id=CHARMS_GLOBAL_ID,
        user_id=user_id,
        kind=TemplateKind.EXTRACTION,
    )

    # A real (trigger-stamped) structural edit: add a field.
    et_id = (
        await db_session.execute(
            select(ExtractionEntityType.id)
            .where(ExtractionEntityType.project_template_id == initial.project_template_id)
            .limit(1)
        )
    ).scalar_one()
    await db_session.execute(
        text(
            "INSERT INTO public.extraction_fields "
            "(id, entity_type_id, name, label, field_type, is_required, sort_order) "
            "VALUES (:id, :et, 'draft_field', 'Draft field', 'text', false, 999)"
        ),
        {"id": str(uuid4()), "et": str(et_id)},
    )
    await db_session.flush()
    assert await get_config_draft_marker(db_session, initial.project_template_id) is not None

    live_fields_before = (
        await db_session.execute(
            text(
                "SELECT count(*) FROM public.extraction_fields f "
                "JOIN public.extraction_entity_types e ON f.entity_type_id = e.id "
                "WHERE e.project_template_id = :tid"
            ),
            {"tid": str(initial.project_template_id)},
        )
    ).scalar_one()

    with pytest.raises(PendingConfigDraftError):
        await service.clone(
            project_id=project_id,
            global_template_id=CHARMS_GLOBAL_ID,
            user_id=user_id,
            kind=TemplateKind.EXTRACTION,
        )

    live_fields_after = (
        await db_session.execute(
            text(
                "SELECT count(*) FROM public.extraction_fields f "
                "JOIN public.extraction_entity_types e ON f.entity_type_id = e.id "
                "WHERE e.project_template_id = :tid"
            ),
            {"tid": str(initial.project_template_id)},
        )
    ).scalar_one()
    assert live_fields_after == live_fields_before, "the refusal must touch nothing"
    active = (
        await db_session.execute(
            select(ExtractionTemplateVersion.id).where(
                ExtractionTemplateVersion.project_template_id == initial.project_template_id,
                ExtractionTemplateVersion.is_active.is_(True),
            )
        )
    ).scalar_one()
    assert active == initial.version_id, "no publish may happen on refusal"

    await db_session.rollback()


@pytest.mark.asyncio
async def test_reimport_aligned_with_pending_draft_succeeds(
    db_session: AsyncSession,
) -> None:
    """Aligned counts + marker set → re-activation succeeds and the
    draft SURVIVES (nothing publishes on this path)."""
    project_id = SEED.secondary_project
    user_id = SEED.primary_profile
    await clean_project_clones(db_session, project_id)
    service = TemplateCloneService(db_session)
    initial = await service.clone(
        project_id=project_id,
        global_template_id=CHARMS_GLOBAL_ID,
        user_id=user_id,
        kind=TemplateKind.EXTRACTION,
    )

    await set_config_draft_marker(db_session, initial.project_template_id, datetime.now(UTC))

    again = await service.clone(
        project_id=project_id,
        global_template_id=CHARMS_GLOBAL_ID,
        user_id=user_id,
        kind=TemplateKind.EXTRACTION,
    )
    assert again.created is False
    assert again.project_template_id == initial.project_template_id
    assert await get_config_draft_marker(db_session, initial.project_template_id) is not None, (
        "the aligned path publishes nothing — the pending draft must survive"
    )

    await db_session.rollback()


@pytest.mark.asyncio
async def test_reimport_zero_state_with_marker_still_heals(
    db_session: AsyncSession,
) -> None:
    """Delete-everything + re-import is the documented factory-recovery
    workflow — the zero-state heal runs regardless of the marker, and the
    publish leaves it NULL."""
    project_id = SEED.secondary_project
    user_id = SEED.primary_profile
    await clean_project_clones(db_session, project_id)
    service = TemplateCloneService(db_session)
    initial = await service.clone(
        project_id=project_id,
        global_template_id=CHARMS_GLOBAL_ID,
        user_id=user_id,
        kind=TemplateKind.EXTRACTION,
    )

    # A delete-all through the live tables stamps the marker (trigger).
    await db_session.execute(
        text("DELETE FROM public.extraction_entity_types WHERE project_template_id = :tid"),
        {"tid": str(initial.project_template_id)},
    )
    await db_session.flush()
    assert await get_config_draft_marker(db_session, initial.project_template_id) is not None

    healed = await service.clone(
        project_id=project_id,
        global_template_id=CHARMS_GLOBAL_ID,
        user_id=user_id,
        kind=TemplateKind.EXTRACTION,
    )
    assert healed.project_template_id == initial.project_template_id
    assert healed.entity_type_count > 0, "factory restore must rebuild structure"
    assert await get_config_draft_marker(db_session, initial.project_template_id) is None, (
        "the heal's publish clears the marker"
    )

    await db_session.rollback()


@pytest.mark.asyncio
async def test_locked_recheck_catches_stamp_after_precheck(
    db_session: AsyncSession,
) -> None:
    """The authoritative 409 lives INSIDE republish's locked section: a
    marker committed after clone's unlocked pre-check still refuses."""
    from app.services.template_clone_service import PendingConfigDraftError
    from app.services.template_version_service import TemplateVersionService

    project_id = SEED.secondary_project
    user_id = SEED.primary_profile
    await clean_project_clones(db_session, project_id)
    initial = await TemplateCloneService(db_session).clone(
        project_id=project_id,
        global_template_id=CHARMS_GLOBAL_ID,
        user_id=user_id,
        kind=TemplateKind.EXTRACTION,
    )

    # Simulate the TOCTOU: the marker lands AFTER a pre-check would have
    # passed. Calling republish with the flag and the marker set is
    # exactly the state the locked re-check must refuse.
    await set_config_draft_marker(db_session, initial.project_template_id, datetime.now(UTC))
    with pytest.raises(PendingConfigDraftError):
        await TemplateVersionService(db_session).republish(
            project_id=project_id,
            project_template_id=initial.project_template_id,
            user_id=user_id,
            fail_if_pending_draft=True,
        )

    await db_session.rollback()


@pytest.mark.asyncio
async def test_reimport_refreshes_schema_from_global(db_session: AsyncSession) -> None:
    """Re-import re-syncs the template-level ``schema_`` from the global.

    Clone creation copies ``schema_`` by value, so a clone made before the
    global gained a rule key (PROBAST+AI 2.1.0's ``scope_rules``) could
    never receive it — the heal republishes structure but historically
    left ``schema_`` alone. The rules READ the structure rather than being
    it, so the refresh must NOT rebuild or roll the live structure.
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

    await clean_project_clones(db_session, project_id)
    service = TemplateCloneService(db_session)

    first = await service.clone(
        project_id=project_id,
        global_template_id=CHARMS_GLOBAL_ID,
        user_id=user_id,
        kind=TemplateKind.EXTRACTION,
    )

    # The global gains a rule key after the clone already exists.
    global_tpl = await db_session.get(ExtractionTemplateGlobal, CHARMS_GLOBAL_ID)
    assert global_tpl is not None
    global_tpl.schema_ = {"scope_rules": {"classifier": {"section": "s", "field": "f"}}}
    await db_session.flush()

    second = await service.clone(
        project_id=project_id,
        global_template_id=CHARMS_GLOBAL_ID,
        user_id=user_id,
        kind=TemplateKind.EXTRACTION,
    )

    assert second.project_template_id == first.project_template_id
    # Read back through SQL, not the identity map: the ORM attribute would
    # look right even if the assignment never reached the row.
    persisted = (
        await db_session.execute(
            text('SELECT "schema" FROM public.project_extraction_templates WHERE id = :id'),
            {"id": str(first.project_template_id)},
        )
    ).scalar_one()
    assert persisted == {"scope_rules": {"classifier": {"section": "s", "field": "f"}}}

    # Rules only. Structure is untouched and the version does not roll.
    assert second.entity_type_count == first.entity_type_count
    assert second.field_count == first.field_count
    assert second.version_id == first.version_id

    await db_session.rollback()


async def _zero_state_with_instruction_draft(
    db: AsyncSession, instruction: str
) -> tuple[TemplateCloneService, object]:
    """A CHARMS clone driven to zero state with ``instruction`` staged but
    unpublished — the exact shape the zero-state guard discriminates on.
    Structure is emptied through the live table so the 0048 trigger stamps
    the marker, as delete-every-section does in production."""
    from app.services.template_instruction_service import set_template_instruction

    project_id = SEED.secondary_project
    await clean_project_clones(db, project_id)
    service = TemplateCloneService(db)
    initial = await service.clone(
        project_id=project_id,
        global_template_id=CHARMS_GLOBAL_ID,
        user_id=SEED.primary_profile,
        kind=TemplateKind.EXTRACTION,
    )
    await db.execute(
        text("DELETE FROM public.extraction_entity_types WHERE project_template_id = :tid"),
        {"tid": str(initial.project_template_id)},
    )
    await set_template_instruction(
        db,
        project_id=project_id,
        template_id=initial.project_template_id,
        llm_template_instruction=instruction,
    )
    await db.flush()
    return service, initial


@pytest.mark.asyncio
async def test_reimport_zero_state_with_instruction_draft_refuses(
    db_session: AsyncSession,
) -> None:
    """Zero state + an UNPUBLISHED instruction draft → refuse.

    The rebuild resets structure from the global but never the
    ``llm_template_instruction`` column, and ``republish`` snapshots that
    column LIVE — so healing here publishes prompt text no one approved.
    Sibling of the drift-branch refusal above; the clone endpoint renders
    both as 409. Distinct from ``..._with_marker_still_heals``: there the
    marker is a delete-trigger byproduct with the instruction untouched.
    """
    from app.services.template_clone_service import PendingConfigDraftError

    draft_text = "UNPUBLISHED DRAFT — must never reach a prompt"
    service, initial = await _zero_state_with_instruction_draft(db_session, draft_text)

    with pytest.raises(PendingConfigDraftError):
        await service.clone(
            project_id=SEED.secondary_project,
            global_template_id=CHARMS_GLOBAL_ID,
            user_id=SEED.primary_profile,
            kind=TemplateKind.EXTRACTION,
        )

    assert await get_config_draft_marker(db_session, initial.project_template_id) is not None, (
        "a refusal must leave the draft marker standing (the Draft chip is the manager's signal)"
    )
    active_id, active_schema = (
        await db_session.execute(
            select(ExtractionTemplateVersion.id, ExtractionTemplateVersion.schema_).where(
                ExtractionTemplateVersion.project_template_id == initial.project_template_id,
                ExtractionTemplateVersion.is_active.is_(True),
            )
        )
    ).one()
    assert active_id == initial.version_id, "no publish may happen on refusal"
    assert draft_text not in str(active_schema), "the draft must not reach the active snapshot"

    await db_session.rollback()


@pytest.mark.asyncio
async def test_zero_state_heal_resumes_once_the_draft_is_published(
    db_session: AsyncSession,
) -> None:
    """The refusal is recoverable, so the 409's advice is actionable:
    once the manager publishes, the zero-state heal runs as before."""
    from app.services.template_version_service import TemplateVersionService

    project_id = SEED.secondary_project
    user_id = SEED.primary_profile
    service, initial = await _zero_state_with_instruction_draft(
        db_session, "now deliberately published"
    )

    # The documented exit: Publish, then re-import.
    await TemplateVersionService(db_session).republish(
        project_id=project_id,
        project_template_id=initial.project_template_id,
        user_id=user_id,
    )

    healed = await service.clone(
        project_id=project_id,
        global_template_id=CHARMS_GLOBAL_ID,
        user_id=user_id,
        kind=TemplateKind.EXTRACTION,
    )
    assert healed.entity_type_count > 0, "factory restore must rebuild structure once published"
    assert await get_config_draft_marker(db_session, initial.project_template_id) is None

    await db_session.rollback()


@pytest.mark.asyncio
async def test_zero_state_heals_when_only_the_pinned_instruction_is_missing(
    db_session: AsyncSession,
) -> None:
    """live != pinned but NO marker → heal anyway.

    The legacy shape the two-condition guard exists for: a clone published
    before snapshots carried ``llm_template_instruction`` reads live !=
    pinned forever, with nothing actually staged. Content alone would
    refuse it permanently and strand the template in zero state.

    This is also what pins the guard's POSITION: it only survives because
    the check runs before the rebuild's inserts stamp the marker. Move it
    after them and the ``marker is None`` early-out becomes unreachable,
    and this test goes red.
    """
    project_id = SEED.secondary_project
    user_id = SEED.primary_profile
    await clean_project_clones(db_session, project_id)
    service = TemplateCloneService(db_session)
    initial = await service.clone(
        project_id=project_id,
        global_template_id=CHARMS_GLOBAL_ID,
        user_id=user_id,
        kind=TemplateKind.EXTRACTION,
    )

    # Pre-key baseline: the active snapshot never carried the instruction,
    # while the live column does (the clone copied it from the global).
    await db_session.execute(
        text(
            "UPDATE public.extraction_template_versions "
            "SET schema = schema - 'llm_template_instruction' WHERE id = :vid"
        ),
        {"vid": str(initial.version_id)},
    )
    live = (
        await db_session.execute(
            text(
                "SELECT llm_template_instruction "
                "FROM public.project_extraction_templates WHERE id = :tid"
            ),
            {"tid": str(initial.project_template_id)},
        )
    ).scalar_one()
    assert live, "CHARMS clones carry an instruction — otherwise this proves nothing"

    await db_session.execute(
        text("DELETE FROM public.extraction_entity_types WHERE project_template_id = :tid"),
        {"tid": str(initial.project_template_id)},
    )
    # Clear AFTER emptying: the delete stamps the marker via the 0048 trigger.
    await set_config_draft_marker(db_session, initial.project_template_id, None)

    healed = await service.clone(
        project_id=project_id,
        global_template_id=CHARMS_GLOBAL_ID,
        user_id=user_id,
        kind=TemplateKind.EXTRACTION,
    )
    assert healed.entity_type_count > 0, (
        "no marker means nothing is staged — a content-only guard would strand this template"
    )

    await db_session.rollback()
