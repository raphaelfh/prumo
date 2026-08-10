"""template_field_service: BOLA chain, per-section name uniqueness,
cross-template move refusal, atomic reorder, and the RESTRICT delete
remap (slice B-7 task 2).

Every op re-verifies project -> template -> entity_type -> field in the
service with 404-not-403 semantics; the 0048 draft-marker trigger stamps
``config_draft_since`` on any service-side write (asserted once — the
typed endpoints inherit the B-4 draft contract for free).
"""

from __future__ import annotations

from uuid import UUID, uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.schemas.template_structure import (
    TemplateFieldCreateRequest,
    TemplateFieldMoveRequest,
    TemplateFieldReorderRequest,
    TemplateFieldSortOrderUpdate,
    TemplateFieldUpdateRequest,
)
from app.services.project_template_active_service import ProjectTemplateNotFoundError
from app.services.template_field_service import (
    CrossTemplateMoveError,
    DuplicateFieldNameError,
    DuplicateReorderIdsError,
    EntityTypeNotFoundError,
    FieldInUseError,
    FieldNotFoundError,
    _is_field_name_unique_violation,
    _pgcode,
    create_field,
    delete_field,
    move_field,
    reorder_fields,
    update_field,
)
from tests.integration.conftest import (
    SEED,
    clean_project_clones,
    clone_charms,
    get_config_draft_marker,
    set_config_draft_marker,
)

# =================== helpers ===================


def _create_payload(
    entity_type_id: UUID, name: str, **overrides: object
) -> TemplateFieldCreateRequest:
    base: dict[str, object] = {
        "entity_type_id": entity_type_id,
        "name": name,
        "label": name.replace("_", " ").title(),
        "field_type": "text",
        "sort_order": 5,
    }
    base.update(overrides)
    return TemplateFieldCreateRequest(**base)  # type: ignore[arg-type]


async def _charms_clone(db: AsyncSession) -> UUID:
    """A fresh CHARMS clone in the secondary project (multi-section)."""
    await clean_project_clones(db, SEED.secondary_project)
    clone = await clone_charms(db, SEED.secondary_project, SEED.primary_profile)
    return clone.project_template_id


async def _two_section_ids(db: AsyncSession, template_id: UUID) -> tuple[UUID, UUID]:
    rows = (
        await db.execute(
            text(
                "SELECT id FROM public.extraction_entity_types "
                "WHERE project_template_id = :tid ORDER BY sort_order, id LIMIT 2"
            ),
            {"tid": str(template_id)},
        )
    ).scalars()
    first, second = list(rows)
    return first, second


async def _field_row(db: AsyncSession, field_id: UUID) -> tuple[UUID, int] | None:
    row = (
        await db.execute(
            text("SELECT entity_type_id, sort_order FROM public.extraction_fields WHERE id = :fid"),
            {"fid": str(field_id)},
        )
    ).one_or_none()
    return None if row is None else (row[0], row[1])


# =================== create ===================


@pytest.mark.asyncio
async def test_create_field_returns_row_and_stamps_draft_marker(
    db_session: AsyncSession,
) -> None:
    """Happy path + the ONE draft-marker assertion (task 8): a service-side
    create fires the 0048 trigger, so endpoints inherit B-4 semantics."""
    await set_config_draft_marker(db_session, SEED.primary_template, None)

    read = await create_field(
        db_session,
        project_id=SEED.primary_project,
        template_id=SEED.primary_template,
        payload=_create_payload(
            SEED.primary_entity_type,
            "b7_service_create_probe",
            sort_order=7,
            description="probe",
            allowed_values=None,
        ),
    )
    assert read.entity_type_id == SEED.primary_entity_type
    assert read.name == "b7_service_create_probe"
    assert read.sort_order == 7, "client-supplied sort_order is honored (panel 10)"
    assert read.created_at is not None

    assert await _field_row(db_session, read.id) == (SEED.primary_entity_type, 7)
    assert await get_config_draft_marker(db_session, SEED.primary_template) is not None, (
        "a service-side create must stamp config_draft_since via the 0048 trigger"
    )


@pytest.mark.asyncio
async def test_create_field_duplicate_name_per_section_only(
    db_session: AsyncSession,
) -> None:
    """Uniqueness is PER SECTION: a sibling collision is refused, the same
    name in another section of the same template is legal."""
    with pytest.raises(DuplicateFieldNameError):
        await create_field(
            db_session,
            project_id=SEED.primary_project,
            template_id=SEED.primary_template,
            payload=_create_payload(SEED.primary_entity_type, "sample_size"),
        )

    clone_id = await _charms_clone(db_session)
    section_a, section_b = await _two_section_ids(db_session, clone_id)
    for section in (section_a, section_b):
        read = await create_field(
            db_session,
            project_id=SEED.secondary_project,
            template_id=clone_id,
            payload=_create_payload(section, "b7_same_name_two_sections"),
        )
        assert read.entity_type_id == section


@pytest.mark.asyncio
async def test_create_field_bola_chain(db_session: AsyncSession) -> None:
    """404 family at every hop: foreign project, foreign entity type,
    unknown entity type."""
    with pytest.raises(ProjectTemplateNotFoundError):
        await create_field(
            db_session,
            project_id=SEED.secondary_project,
            template_id=SEED.primary_template,
            payload=_create_payload(SEED.primary_entity_type, "b7_bola_probe"),
        )

    clone_id = await _charms_clone(db_session)
    foreign_section, _ = await _two_section_ids(db_session, clone_id)
    with pytest.raises(EntityTypeNotFoundError):
        await create_field(
            db_session,
            project_id=SEED.primary_project,
            template_id=SEED.primary_template,
            payload=_create_payload(foreign_section, "b7_bola_probe"),
        )

    with pytest.raises(EntityTypeNotFoundError):
        await create_field(
            db_session,
            project_id=SEED.primary_project,
            template_id=SEED.primary_template,
            payload=_create_payload(uuid4(), "b7_bola_probe"),
        )


# =================== update ===================


@pytest.mark.asyncio
async def test_update_field_applies_only_set_keys(db_session: AsyncSession) -> None:
    created = await create_field(
        db_session,
        project_id=SEED.primary_project,
        template_id=SEED.primary_template,
        payload=_create_payload(
            SEED.primary_entity_type, "b7_update_probe", description="original"
        ),
    )
    updated = await update_field(
        db_session,
        project_id=SEED.primary_project,
        template_id=SEED.primary_template,
        field_id=created.id,
        payload=TemplateFieldUpdateRequest(label="New Label", sort_order=42),
    )
    assert updated.label == "New Label"
    assert updated.sort_order == 42
    assert updated.description == "original", "unset keys must not be touched"
    assert updated.name == "b7_update_probe"


@pytest.mark.asyncio
async def test_update_field_duplicate_sibling_name_refused(
    db_session: AsyncSession,
) -> None:
    created = await create_field(
        db_session,
        project_id=SEED.primary_project,
        template_id=SEED.primary_template,
        payload=_create_payload(SEED.primary_entity_type, "b7_rename_probe"),
    )
    with pytest.raises(DuplicateFieldNameError):
        await update_field(
            db_session,
            project_id=SEED.primary_project,
            template_id=SEED.primary_template,
            field_id=created.id,
            payload=TemplateFieldUpdateRequest(name="sample_size"),
        )
    # Renaming to its own current name excludes self from the check.
    kept = await update_field(
        db_session,
        project_id=SEED.primary_project,
        template_id=SEED.primary_template,
        field_id=created.id,
        payload=TemplateFieldUpdateRequest(name="b7_rename_probe"),
    )
    assert kept.name == "b7_rename_probe"


@pytest.mark.asyncio
async def test_update_field_bola(db_session: AsyncSession) -> None:
    clone_id = await _charms_clone(db_session)
    section, _ = await _two_section_ids(db_session, clone_id)
    foreign_field = await create_field(
        db_session,
        project_id=SEED.secondary_project,
        template_id=clone_id,
        payload=_create_payload(section, "b7_foreign_field"),
    )
    with pytest.raises(FieldNotFoundError):
        await update_field(
            db_session,
            project_id=SEED.primary_project,
            template_id=SEED.primary_template,
            field_id=foreign_field.id,
            payload=TemplateFieldUpdateRequest(label="hijack"),
        )
    with pytest.raises(ProjectTemplateNotFoundError):
        await update_field(
            db_session,
            project_id=SEED.primary_project,
            template_id=clone_id,
            field_id=foreign_field.id,
            payload=TemplateFieldUpdateRequest(label="hijack"),
        )


# =================== delete ===================


@pytest.mark.asyncio
async def test_delete_field_happy(db_session: AsyncSession) -> None:
    created = await create_field(
        db_session,
        project_id=SEED.primary_project,
        template_id=SEED.primary_template,
        payload=_create_payload(SEED.primary_entity_type, "b7_delete_probe"),
    )
    result = await delete_field(
        db_session,
        project_id=SEED.primary_project,
        template_id=SEED.primary_template,
        field_id=created.id,
    )
    assert result.id == created.id
    assert result.deleted is True
    assert await _field_row(db_session, created.id) is None


@pytest.mark.asyncio
async def test_delete_field_in_use_maps_restrict_to_typed_error(
    db_session: AsyncSession,
) -> None:
    """A REAL 23503: a proposal record pins the seeded field through one of
    the five RESTRICT FKs; the service remaps to FieldInUseError."""
    version_id = (
        await db_session.execute(
            text(
                "SELECT id FROM public.extraction_template_versions "
                "WHERE project_template_id = :tid AND is_active"
            ),
            {"tid": str(SEED.primary_template)},
        )
    ).scalar_one()
    run_id = uuid4()
    await db_session.execute(
        text(
            "INSERT INTO public.extraction_runs "
            "(id, project_id, article_id, template_id, version_id, kind, stage, "
            " status, created_by) "
            "VALUES (:id, :pid, :aid, :tid, :vid, 'extraction', 'extract', "
            " 'completed', :cb)"
        ),
        {
            "id": str(run_id),
            "pid": str(SEED.primary_project),
            "aid": str(SEED.primary_article),
            "tid": str(SEED.primary_template),
            "vid": str(version_id),
            "cb": str(SEED.primary_profile),
        },
    )
    await db_session.execute(
        text(
            "INSERT INTO public.extraction_proposal_records "
            "(id, run_id, instance_id, field_id, source, proposed_value) "
            "VALUES (:id, :rid, :inst, :fid, 'ai', '{}'::jsonb)"
        ),
        {
            "id": str(uuid4()),
            "rid": str(run_id),
            "inst": str(SEED.primary_instance),
            "fid": str(SEED.primary_field),
        },
    )

    with pytest.raises(FieldInUseError):
        await delete_field(
            db_session,
            project_id=SEED.primary_project,
            template_id=SEED.primary_template,
            field_id=SEED.primary_field,
        )
    await db_session.rollback()
    assert await _field_row(db_session, SEED.primary_field) is not None


@pytest.mark.asyncio
async def test_delete_field_bola(db_session: AsyncSession) -> None:
    with pytest.raises(ProjectTemplateNotFoundError):
        await delete_field(
            db_session,
            project_id=SEED.secondary_project,
            template_id=SEED.primary_template,
            field_id=SEED.primary_field,
        )
    with pytest.raises(FieldNotFoundError):
        await delete_field(
            db_session,
            project_id=SEED.primary_project,
            template_id=SEED.primary_template,
            field_id=uuid4(),
        )


# =================== move ===================


@pytest.mark.asyncio
async def test_move_field_cross_section_happy(db_session: AsyncSession) -> None:
    clone_id = await _charms_clone(db_session)
    section_a, section_b = await _two_section_ids(db_session, clone_id)
    created = await create_field(
        db_session,
        project_id=SEED.secondary_project,
        template_id=clone_id,
        payload=_create_payload(section_a, "b7_move_probe"),
    )
    moved = await move_field(
        db_session,
        project_id=SEED.secondary_project,
        template_id=clone_id,
        field_id=created.id,
        payload=TemplateFieldMoveRequest(entity_type_id=section_b, sort_order=3),
    )
    assert moved.entity_type_id == section_b
    assert moved.sort_order == 3
    assert await _field_row(db_session, created.id) == (section_b, 3)


@pytest.mark.asyncio
async def test_move_field_same_section_reposition_allowed(
    db_session: AsyncSession,
) -> None:
    """dest == current section: the sibling-uniqueness check must exclude
    the field itself or every same-section move would self-collide."""
    created = await create_field(
        db_session,
        project_id=SEED.primary_project,
        template_id=SEED.primary_template,
        payload=_create_payload(SEED.primary_entity_type, "b7_selfmove_probe"),
    )
    moved = await move_field(
        db_session,
        project_id=SEED.primary_project,
        template_id=SEED.primary_template,
        field_id=created.id,
        payload=TemplateFieldMoveRequest(entity_type_id=SEED.primary_entity_type, sort_order=11),
    )
    assert moved.entity_type_id == SEED.primary_entity_type
    assert moved.sort_order == 11


@pytest.mark.asyncio
async def test_move_field_foreign_destination_refused(
    db_session: AsyncSession,
) -> None:
    """The security core (panel 1/4): a destination outside THIS template is
    refused — and a nonexistent destination gets the SAME error, so the
    response is no existence oracle."""
    clone_id = await _charms_clone(db_session)
    foreign_section, _ = await _two_section_ids(db_session, clone_id)

    for destination in (foreign_section, uuid4()):
        with pytest.raises(CrossTemplateMoveError):
            await move_field(
                db_session,
                project_id=SEED.primary_project,
                template_id=SEED.primary_template,
                field_id=SEED.primary_field,
                payload=TemplateFieldMoveRequest(entity_type_id=destination, sort_order=0),
            )
    row = await _field_row(db_session, SEED.primary_field)
    assert row is not None and row[0] == SEED.primary_entity_type, (
        "a refused move must leave the field in place"
    )


@pytest.mark.asyncio
async def test_move_field_duplicate_name_in_destination_refused(
    db_session: AsyncSession,
) -> None:
    clone_id = await _charms_clone(db_session)
    section_a, section_b = await _two_section_ids(db_session, clone_id)
    mover = await create_field(
        db_session,
        project_id=SEED.secondary_project,
        template_id=clone_id,
        payload=_create_payload(section_a, "b7_dup_probe"),
    )
    await create_field(
        db_session,
        project_id=SEED.secondary_project,
        template_id=clone_id,
        payload=_create_payload(section_b, "b7_dup_probe"),
    )
    with pytest.raises(DuplicateFieldNameError):
        await move_field(
            db_session,
            project_id=SEED.secondary_project,
            template_id=clone_id,
            field_id=mover.id,
            payload=TemplateFieldMoveRequest(entity_type_id=section_b, sort_order=0),
        )
    assert await _field_row(db_session, mover.id) == (section_a, 5)


# =================== reorder ===================


@pytest.mark.asyncio
async def test_reorder_multi_section_batch_atomic(db_session: AsyncSession) -> None:
    """One batch spanning TWO sections is legal (panel 4 — a cross-section
    move renumbers both sections in a single call)."""
    clone_id = await _charms_clone(db_session)
    section_a, section_b = await _two_section_ids(db_session, clone_id)
    ids = [
        (
            await create_field(
                db_session,
                project_id=SEED.secondary_project,
                template_id=clone_id,
                payload=_create_payload(section, name, sort_order=0),
            )
        ).id
        for section, name in (
            (section_a, "b7_reorder_a1"),
            (section_a, "b7_reorder_a2"),
            (section_b, "b7_reorder_b1"),
        )
    ]
    response = await reorder_fields(
        db_session,
        project_id=SEED.secondary_project,
        template_id=clone_id,
        payload=TemplateFieldReorderRequest(
            updates=[
                TemplateFieldSortOrderUpdate(id=ids[0], sort_order=20),
                TemplateFieldSortOrderUpdate(id=ids[1], sort_order=10),
                TemplateFieldSortOrderUpdate(id=ids[2], sort_order=30),
            ]
        ),
    )
    assert response.updated_count == 3
    for field_id, expected in zip(ids, (20, 10, 30), strict=True):
        row = await _field_row(db_session, field_id)
        assert row is not None and row[1] == expected


@pytest.mark.asyncio
async def test_reorder_duplicate_ids_rejected(db_session: AsyncSession) -> None:
    with pytest.raises(DuplicateReorderIdsError):
        await reorder_fields(
            db_session,
            project_id=SEED.primary_project,
            template_id=SEED.primary_template,
            payload=TemplateFieldReorderRequest(
                updates=[
                    TemplateFieldSortOrderUpdate(id=SEED.primary_field, sort_order=1),
                    TemplateFieldSortOrderUpdate(id=SEED.primary_field, sort_order=2),
                ]
            ),
        )


@pytest.mark.asyncio
async def test_reorder_foreign_or_unknown_id_is_404(db_session: AsyncSession) -> None:
    """The ONE joined ownership query: any id outside THIS template's
    sections fails the match-count and nothing is written."""
    clone_id = await _charms_clone(db_session)
    section_a, _ = await _two_section_ids(db_session, clone_id)
    own_field = await create_field(
        db_session,
        project_id=SEED.secondary_project,
        template_id=clone_id,
        payload=_create_payload(section_a, "b7_reorder_bola", sort_order=1),
    )
    for intruder in (SEED.primary_field, uuid4()):
        with pytest.raises(FieldNotFoundError):
            await reorder_fields(
                db_session,
                project_id=SEED.secondary_project,
                template_id=clone_id,
                payload=TemplateFieldReorderRequest(
                    updates=[
                        TemplateFieldSortOrderUpdate(id=own_field.id, sort_order=99),
                        TemplateFieldSortOrderUpdate(id=intruder, sort_order=98),
                    ]
                ),
            )
    assert await _field_row(db_session, own_field.id) == (section_a, 1), (
        "a refused batch must write nothing"
    )


@pytest.mark.asyncio
async def test_reorder_bola_foreign_project(db_session: AsyncSession) -> None:
    with pytest.raises(ProjectTemplateNotFoundError):
        await reorder_fields(
            db_session,
            project_id=SEED.secondary_project,
            template_id=SEED.primary_template,
            payload=TemplateFieldReorderRequest(
                updates=[TemplateFieldSortOrderUpdate(id=SEED.primary_field, sort_order=1)]
            ),
        )


# =================== 0050 DB backstop ===================


@pytest.mark.asyncio
async def test_duplicate_name_db_backstop_fires_without_service(
    db_session: AsyncSession,
) -> None:
    """A raw INSERT dodging the service's read-time check hits migration
    0050's unique index, and the remap predicate is keyed to the REAL
    constraint name the DB raises — the backstop holds for writers that
    bypass ``create_field`` (residual PostgREST writes, racing clients)."""
    with pytest.raises(IntegrityError) as excinfo:
        await db_session.execute(
            text(
                "INSERT INTO public.extraction_fields "
                "(id, entity_type_id, name, label, field_type, is_required) "
                "VALUES (gen_random_uuid(), :et, 'sample_size', 'Sample Size', "
                "'text', false)"
            ),
            {"et": str(SEED.primary_entity_type)},
        )
    await db_session.rollback()

    assert _pgcode(excinfo.value) == "23505"
    assert _is_field_name_unique_violation(excinfo.value), (
        "the 23505 remap must key on uq_extraction_fields_entity_type_name "
        "exactly as the DB names it"
    )
