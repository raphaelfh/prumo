"""template_section_service: typed section writes for the config editor
(B-7 task 3).

Covers the BOLA chain (template -> project, parent entity_type -> THIS
template), the ck_role_parent schema-level mirror, server-computed
sort_order, the one-model_container 23505 remap, the delete RESTRICT
23503 remap, and the 0048 draft-marker stamp on section writes.

The deferred ``trg_check_model_section_parent_role`` trigger fires only
at true COMMIT, which the SAVEPOINT-isolated ``db_session`` never
issues; its commit-time behavior (happy + abort) is covered by
``tests/integration/smoke_constraints/test_entity_role_parent.py``.
Here the service's Python pre-check (``SectionParentRoleError``)
enforces the same predicate deterministically at request time.
"""

from __future__ import annotations

import uuid

import pytest
from pydantic import ValidationError
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction import ExtractionEntityType
from app.schemas.template_structure import SectionCreateRequest, SectionRenameRequest
from app.services.project_template_active_service import ProjectTemplateNotFoundError
from app.services.template_section_service import (
    OneContainerError,
    SectionInUseError,
    SectionNotFoundError,
    SectionParentRoleError,
    create_section,
    delete_section,
    rename_section,
)
from tests.integration.conftest import (
    SEED,
    clean_project_clones,
    clone_charms,
    get_config_draft_marker,
    set_config_draft_marker,
)

# =================== HELPERS ===================


def make_create(**overrides: object) -> SectionCreateRequest:
    payload: dict[str, object] = {
        "name": "custom_section",
        "label": "Custom Section",
        "description": "A project-specific section.",
        "cardinality": "one",
        "role": "study_section",
        "parent_entity_type_id": None,
        "is_required": True,
    }
    payload.update(overrides)
    return SectionCreateRequest(**payload)  # type: ignore[arg-type]


async def _fresh_clone(db: AsyncSession) -> uuid.UUID:
    """CHARMS clone into the secondary project (savepoint-isolated)."""
    await clean_project_clones(db, SEED.secondary_project)
    clone = await clone_charms(db, SEED.secondary_project, SEED.primary_profile)
    return clone.project_template_id


async def _section_id_by_role(db: AsyncSession, template_id: uuid.UUID, role: str) -> uuid.UUID:
    return (
        await db.execute(
            select(ExtractionEntityType.id)
            .where(
                ExtractionEntityType.project_template_id == template_id,
                ExtractionEntityType.role == role,
            )
            .order_by(ExtractionEntityType.sort_order)
            .limit(1)
        )
    ).scalar_one()


async def _max_sort_order(db: AsyncSession, template_id: uuid.UUID) -> int:
    return (
        await db.execute(
            text(
                "SELECT COALESCE(MAX(sort_order), 0) FROM public.extraction_entity_types "
                "WHERE project_template_id = :tid"
            ),
            {"tid": str(template_id)},
        )
    ).scalar_one()


# =================== SCHEMA-LEVEL ck_role_parent MIRROR ===================
# Unit-style asserts (no DB): the Pydantic validator mirrors the DB's
# ck_extraction_entity_types_role_parent CHECK, so an invalid combination
# never reaches the service.


class TestCreateRequestRoleParentRules:
    def test_model_section_without_parent_is_rejected(self) -> None:
        with pytest.raises(ValidationError, match="parent_entity_type_id"):
            make_create(role="model_section", parent_entity_type_id=None)

    def test_study_section_with_parent_is_rejected(self) -> None:
        with pytest.raises(ValidationError, match="parent_entity_type_id"):
            make_create(role="study_section", parent_entity_type_id=str(uuid.uuid4()))

    def test_model_container_with_parent_is_rejected(self) -> None:
        with pytest.raises(ValidationError, match="parent_entity_type_id"):
            make_create(role="model_container", parent_entity_type_id=str(uuid.uuid4()))

    def test_role_is_required(self) -> None:
        payload = {"name": "sec_x", "label": "Sec X", "cardinality": "one"}
        with pytest.raises(ValidationError, match="role"):
            SectionCreateRequest(**payload)  # type: ignore[arg-type]

    def test_client_supplied_sort_order_is_rejected(self) -> None:
        # sort_order is server-computed for sections (kills the frontend
        # read-then-write race); extra="forbid" refuses the key outright.
        with pytest.raises(ValidationError, match="sort_order"):
            make_create(sort_order=99)

    def test_rename_label_is_trimmed_and_non_empty(self) -> None:
        assert SectionRenameRequest(label="  Renamed  ").label == "Renamed"
        with pytest.raises(ValidationError):
            SectionRenameRequest(label="   ")


# =================== CREATE ===================


@pytest.mark.asyncio
async def test_create_study_section_happy(db_session: AsyncSession) -> None:
    template_id = await _fresh_clone(db_session)
    max_before = await _max_sort_order(db_session, template_id)

    read = await create_section(
        db_session,
        project_id=SEED.secondary_project,
        template_id=template_id,
        payload=make_create(),
    )

    assert read.project_template_id == template_id
    assert read.name == "custom_section"
    assert read.label == "Custom Section"
    assert read.description == "A project-specific section."
    assert read.cardinality == "one"
    assert read.role == "study_section"
    assert read.parent_entity_type_id is None
    assert read.is_required is True
    assert read.sort_order == max_before + 1
    assert read.created_at is not None

    row = await db_session.get(ExtractionEntityType, read.id)
    assert row is not None and row.project_template_id == template_id
    assert row.template_id is None, "a section write must stay in the project lineage"


@pytest.mark.asyncio
async def test_create_stamps_config_draft_marker(db_session: AsyncSession) -> None:
    """B-4 contract: a section write is a draft edit — the 0048 trigger
    stamps ``config_draft_since`` on the owning template."""
    template_id = await _fresh_clone(db_session)
    await set_config_draft_marker(db_session, template_id, None)

    await create_section(
        db_session,
        project_id=SEED.secondary_project,
        template_id=template_id,
        payload=make_create(),
    )

    assert await get_config_draft_marker(db_session, template_id) is not None, (
        "create_section must stamp the draft marker (0048 trigger)"
    )


@pytest.mark.asyncio
async def test_create_model_section_under_container(db_session: AsyncSession) -> None:
    template_id = await _fresh_clone(db_session)
    container_id = await _section_id_by_role(db_session, template_id, "model_container")

    read = await create_section(
        db_session,
        project_id=SEED.secondary_project,
        template_id=template_id,
        payload=make_create(
            name="custom_model_section",
            label="Custom Model Section",
            role="model_section",
            parent_entity_type_id=container_id,
        ),
    )

    assert read.role == "model_section"
    assert read.parent_entity_type_id == container_id


@pytest.mark.asyncio
async def test_create_model_section_under_non_container_parent_refused(
    db_session: AsyncSession,
) -> None:
    """The service pre-checks the parent role, surfacing the deferred
    trigger's predicate as a typed request-time error."""
    template_id = await _fresh_clone(db_session)
    study_id = await _section_id_by_role(db_session, template_id, "study_section")

    with pytest.raises(SectionParentRoleError):
        await create_section(
            db_session,
            project_id=SEED.secondary_project,
            template_id=template_id,
            payload=make_create(
                name="bad_model_section",
                role="model_section",
                parent_entity_type_id=study_id,
            ),
        )


@pytest.mark.asyncio
async def test_create_second_model_container_refused(db_session: AsyncSession) -> None:
    """The CHARMS clone already has its container: the partial unique
    index fires (23505) and the service remaps it to OneContainerError."""
    template_id = await _fresh_clone(db_session)

    with pytest.raises(OneContainerError):
        await create_section(
            db_session,
            project_id=SEED.secondary_project,
            template_id=template_id,
            payload=make_create(
                name="second_container",
                label="Second Container",
                cardinality="many",
                role="model_container",
            ),
        )
    await db_session.rollback()


@pytest.mark.asyncio
async def test_sort_order_is_server_computed_and_increasing(db_session: AsyncSession) -> None:
    template_id = await _fresh_clone(db_session)

    first = await create_section(
        db_session,
        project_id=SEED.secondary_project,
        template_id=template_id,
        payload=make_create(name="first_extra"),
    )
    second = await create_section(
        db_session,
        project_id=SEED.secondary_project,
        template_id=template_id,
        payload=make_create(name="second_extra"),
    )

    assert second.sort_order == first.sort_order + 1


# =================== RENAME ===================


@pytest.mark.asyncio
async def test_rename_happy(db_session: AsyncSession) -> None:
    template_id = await _fresh_clone(db_session)
    section_id = await _section_id_by_role(db_session, template_id, "study_section")

    read = await rename_section(
        db_session,
        project_id=SEED.secondary_project,
        template_id=template_id,
        section_id=section_id,
        payload=SectionRenameRequest(label="Renamed Section"),
    )

    assert read.id == section_id
    assert read.label == "Renamed Section"
    stored = (
        await db_session.execute(
            select(ExtractionEntityType.label).where(ExtractionEntityType.id == section_id)
        )
    ).scalar_one()
    assert stored == "Renamed Section"


@pytest.mark.asyncio
async def test_rename_is_bola_guarded(db_session: AsyncSession) -> None:
    """Foreign-project template 404s; foreign-template section 404s —
    the section BOLA chain section -> template -> project holds."""
    template_id = await _fresh_clone(db_session)
    section_id = await _section_id_by_role(db_session, template_id, "study_section")

    # Template not owned by the path project.
    with pytest.raises(ProjectTemplateNotFoundError):
        await rename_section(
            db_session,
            project_id=SEED.primary_project,
            template_id=template_id,
            section_id=section_id,
            payload=SectionRenameRequest(label="X"),
        )

    # Section owned by ANOTHER template (the seeded primary one).
    with pytest.raises(SectionNotFoundError):
        await rename_section(
            db_session,
            project_id=SEED.secondary_project,
            template_id=template_id,
            section_id=SEED.primary_entity_type,
            payload=SectionRenameRequest(label="X"),
        )


# =================== DELETE ===================


@pytest.mark.asyncio
async def test_delete_happy(db_session: AsyncSession) -> None:
    """A fresh clone has no instances, so a study section deletes clean
    (its fields go with it via the DB cascade)."""
    template_id = await _fresh_clone(db_session)
    section_id = await _section_id_by_role(db_session, template_id, "study_section")

    result = await delete_section(
        db_session,
        project_id=SEED.secondary_project,
        template_id=template_id,
        section_id=section_id,
    )

    assert result.id == section_id
    assert result.deleted is True
    gone = (
        await db_session.execute(
            select(ExtractionEntityType.id).where(ExtractionEntityType.id == section_id)
        )
    ).scalar_one_or_none()
    assert gone is None


@pytest.mark.asyncio
async def test_delete_section_with_instances_refused(db_session: AsyncSession) -> None:
    """The seeded primary entity type carries an extraction instance —
    the RESTRICT FK fires (23503) and the service remaps it to
    SectionInUseError."""
    with pytest.raises(SectionInUseError):
        await delete_section(
            db_session,
            project_id=SEED.primary_project,
            template_id=SEED.primary_template,
            section_id=SEED.primary_entity_type,
        )
    await db_session.rollback()

    still_there = (
        await db_session.execute(
            select(ExtractionEntityType.id).where(
                ExtractionEntityType.id == SEED.primary_entity_type
            )
        )
    ).scalar_one_or_none()
    assert still_there is not None


# =================== CREATE BOLA ===================


@pytest.mark.asyncio
async def test_create_is_bola_guarded(db_session: AsyncSession) -> None:
    template_id = await _fresh_clone(db_session)

    # Template not owned by the path project.
    with pytest.raises(ProjectTemplateNotFoundError):
        await create_section(
            db_session,
            project_id=SEED.primary_project,
            template_id=template_id,
            payload=make_create(),
        )

    # Parent entity type owned by ANOTHER template: the panel-5 chain
    # (entity_type -> template -> project) refuses it as a 404, never
    # leaking existence.
    with pytest.raises(SectionNotFoundError):
        await create_section(
            db_session,
            project_id=SEED.secondary_project,
            template_id=template_id,
            payload=make_create(
                name="cross_template_child",
                role="model_section",
                parent_entity_type_id=SEED.primary_entity_type,
            ),
        )
