"""template_section_service: typed section writes for the config editor
(B-7 task 3; update surface widened in B-8 task 2).

Covers the BOLA chain (template -> project, parent entity_type -> THIS
template), the ck_role_parent schema-level mirror, the D3 container
create rules (forced 'many' + entry_label defaulting), server-computed
sort_order, the one-model_container 23505 remap, the D5 update matrix
(label / entry_label / cardinality role rules + the many->one in-use
refusal), the delete RESTRICT 23503 remap, and the 0048 draft-marker
stamp/skip contract on section writes.

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
from app.schemas.template_structure import SectionCreateRequest, SectionUpdateRequest
from app.services.project_template_active_service import ProjectTemplateNotFoundError
from app.services.template_section_service import (
    OneContainerError,
    SectionCardinalityInUseError,
    SectionCardinalityRoleError,
    SectionEntryLabelRoleError,
    SectionInUseError,
    SectionNotFoundError,
    SectionParentRoleError,
    create_section,
    delete_section,
    update_section,
)
from tests.integration.conftest import (
    SEED,
    clean_project_clones,
    clone_charms,
    get_config_draft_marker,
    make_proposal,
    open_session,
    set_config_draft_marker,
)
from tests.integration.helpers.template_fixtures import (
    ARTICLE_ID,
    entity_id,
    field_id,
    fresh_charms,
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


async def _section_by_name(
    db: AsyncSession, template_id: uuid.UUID, name: str
) -> ExtractionEntityType:
    """A specific CHARMS section by its stable seed name (scoped to the
    clone under test, never cross-template)."""
    return (
        await db.execute(
            select(ExtractionEntityType).where(
                ExtractionEntityType.project_template_id == template_id,
                ExtractionEntityType.name == name,
            )
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


async def _insert_instance(
    db: AsyncSession,
    *,
    template_id: uuid.UUID,
    entity_type_id: uuid.UUID,
    parent_instance_id: uuid.UUID | None = None,
    label: str = "Entry",
    sort_order: int = 0,
) -> uuid.UUID:
    """A raw extraction instance in the SECONDARY project (article-less:
    the cardinality trigger short-circuits for 'many' sections, which is
    the only shape these tests insert)."""
    instance_id = uuid.uuid4()
    await db.execute(
        text(
            "INSERT INTO public.extraction_instances "
            "(id, project_id, template_id, entity_type_id, article_id, "
            " parent_instance_id, label, sort_order, created_by) "
            "VALUES (:id, :pid, :tid, :etid, NULL, :parent, :label, :so, :created_by)"
        ),
        {
            "id": str(instance_id),
            "pid": str(SEED.secondary_project),
            "tid": str(template_id),
            "etid": str(entity_type_id),
            "parent": str(parent_instance_id) if parent_instance_id else None,
            "label": label,
            "so": sort_order,
            "created_by": str(SEED.primary_profile),
        },
    )
    return instance_id


async def _instance_count(db: AsyncSession, entity_type_id: uuid.UUID) -> int:
    """Live ``extraction_instances`` rows for one section."""
    return (
        await db.execute(
            text("SELECT count(*) FROM public.extraction_instances WHERE entity_type_id = :etid"),
            {"etid": str(entity_type_id)},
        )
    ).scalar_one()


async def _update(
    db: AsyncSession,
    template_id: uuid.UUID,
    section_id: uuid.UUID,
    payload: SectionUpdateRequest,
):
    return await update_section(
        db,
        project_id=SEED.secondary_project,
        template_id=template_id,
        section_id=section_id,
        payload=payload,
    )


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


# =================== SCHEMA-LEVEL CONTAINER CREATE RULES (D3) ===================


class TestCreateRequestContainerRules:
    def test_container_with_cardinality_one_is_rejected(self) -> None:
        with pytest.raises(ValidationError, match="cardinality"):
            make_create(role="model_container", cardinality="one")

    def test_container_entry_label_defaults_to_model(self) -> None:
        req = make_create(role="model_container", cardinality="many")
        assert req.entry_label == "model"

    def test_container_blank_entry_label_defaults_to_model(self) -> None:
        req = make_create(role="model_container", cardinality="many", entry_label="   ")
        assert req.entry_label == "model"

    def test_container_explicit_entry_label_respected(self) -> None:
        req = make_create(role="model_container", cardinality="many", entry_label=" algorithm ")
        assert req.entry_label == "algorithm"

    def test_entry_label_on_a_non_repeating_study_section_is_rejected(self) -> None:
        with pytest.raises(ValidationError, match="entry_label"):
            make_create(entry_label="model")

    def test_entry_label_on_a_non_repeating_model_section_is_rejected(self) -> None:
        with pytest.raises(ValidationError, match="entry_label"):
            make_create(
                role="model_section",
                parent_entity_type_id=str(uuid.uuid4()),
                entry_label="model",
            )

    def test_entry_label_on_a_repeating_section_is_kept_trimmed(self) -> None:
        """Every repeating section is an entry group: the noun is legal on
        any ``cardinality='many'`` section, not only the container."""
        req = make_create(cardinality="many", entry_label=" predictor ")
        assert req.entry_label == "predictor"
        child = make_create(
            role="model_section",
            parent_entity_type_id=str(uuid.uuid4()),
            cardinality="many",
            entry_label="validation",
        )
        assert child.entry_label == "validation"

    def test_blank_entry_label_on_a_repeating_section_means_none(self) -> None:
        """Only the container has a 'model' default; elsewhere blank is unset."""
        assert make_create(cardinality="many", entry_label="   ").entry_label is None


# =================== SCHEMA-LEVEL UPDATE RULES (D5) ===================


class TestUpdateRequestRules:
    def test_label_is_trimmed_and_non_empty(self) -> None:
        assert SectionUpdateRequest(label="  Renamed  ").label == "Renamed"
        with pytest.raises(ValidationError):
            SectionUpdateRequest(label="   ")

    def test_at_least_one_field_required(self) -> None:
        with pytest.raises(ValidationError, match="at least one"):
            SectionUpdateRequest()

    def test_explicit_null_rejected(self) -> None:
        # Omission means "leave unchanged"; a null must never blank a column.
        with pytest.raises(ValidationError, match="label"):
            SectionUpdateRequest(label=None)

    def test_blank_entry_label_rejected(self) -> None:
        with pytest.raises(ValidationError):
            SectionUpdateRequest(entry_label="   ")

    def test_unknown_key_rejected(self) -> None:
        with pytest.raises(ValidationError):
            SectionUpdateRequest(label="X", role="study_section")  # type: ignore[call-arg]


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
    assert read.entry_label is None
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
async def test_create_container_carries_default_entry_label(db_session: AsyncSession) -> None:
    """D3 end-to-end: with the CHARMS container deleted, a new container
    created without an explicit noun lands with entry_label='model'."""
    template_id = await _fresh_clone(db_session)
    container_id = await _section_id_by_role(db_session, template_id, "model_container")
    await delete_section(
        db_session,
        project_id=SEED.secondary_project,
        template_id=template_id,
        section_id=container_id,
    )

    read = await create_section(
        db_session,
        project_id=SEED.secondary_project,
        template_id=template_id,
        payload=make_create(
            name="groups", label="Groups", cardinality="many", role="model_container"
        ),
    )

    assert read.entry_label == "model"
    row = await db_session.get(ExtractionEntityType, read.id)
    assert row is not None and row.entry_label == "model"


@pytest.mark.asyncio
async def test_create_container_carries_explicit_entry_label(db_session: AsyncSession) -> None:
    template_id = await _fresh_clone(db_session)
    container_id = await _section_id_by_role(db_session, template_id, "model_container")
    await delete_section(
        db_session,
        project_id=SEED.secondary_project,
        template_id=template_id,
        section_id=container_id,
    )

    read = await create_section(
        db_session,
        project_id=SEED.secondary_project,
        template_id=template_id,
        payload=make_create(
            name="algorithms",
            label="Algorithms",
            cardinality="many",
            role="model_container",
            entry_label="algorithm",
        ),
    )

    assert read.entry_label == "algorithm"
    row = await db_session.get(ExtractionEntityType, read.id)
    assert row is not None and row.entry_label == "algorithm"


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


# =================== UPDATE ===================


@pytest.mark.asyncio
async def test_update_label_happy(db_session: AsyncSession) -> None:
    template_id = await _fresh_clone(db_session)
    section_id = await _section_id_by_role(db_session, template_id, "study_section")

    read = await _update(
        db_session, template_id, section_id, SectionUpdateRequest(label="Renamed Section")
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
async def test_update_entry_label_on_container(db_session: AsyncSession) -> None:
    template_id = await _fresh_clone(db_session)
    container_id = await _section_id_by_role(db_session, template_id, "model_container")

    read = await _update(
        db_session, template_id, container_id, SectionUpdateRequest(entry_label="algorithm")
    )

    assert read.entry_label == "algorithm"
    stored = (
        await db_session.execute(
            select(ExtractionEntityType.entry_label).where(ExtractionEntityType.id == container_id)
        )
    ).scalar_one()
    assert stored == "algorithm"


@pytest.mark.asyncio
async def test_update_label_and_entry_label_together(db_session: AsyncSession) -> None:
    template_id = await _fresh_clone(db_session)
    container_id = await _section_id_by_role(db_session, template_id, "model_container")

    read = await _update(
        db_session,
        template_id,
        container_id,
        SectionUpdateRequest(label="Algorithms", entry_label="algorithm"),
    )

    assert read.label == "Algorithms"
    assert read.entry_label == "algorithm"


@pytest.mark.asyncio
async def test_update_entry_label_on_non_repeating_section_refused(
    db_session: AsyncSession,
) -> None:
    """D5: the entry noun names one entry of a repeating section — a section
    that does not repeat has nothing for it to name."""
    template_id = await _fresh_clone(db_session)
    study_id = await _section_id_by_role(db_session, template_id, "study_section")

    with pytest.raises(SectionEntryLabelRoleError):
        await _update(db_session, template_id, study_id, SectionUpdateRequest(entry_label="model"))


@pytest.mark.asyncio
async def test_update_entry_label_on_repeating_study_section_accepted(
    db_session: AsyncSession,
) -> None:
    """Unlocked from the container: any ``cardinality='many'`` section takes a noun."""
    template_id = await _fresh_clone(db_session)
    created = await create_section(
        db_session,
        project_id=SEED.secondary_project,
        template_id=template_id,
        payload=make_create(name="arms", label="Study arms", cardinality="many"),
    )
    assert created.entry_label is None

    read = await _update(
        db_session, template_id, created.id, SectionUpdateRequest(entry_label="arm")
    )
    assert read.entry_label == "arm"
    row = await db_session.get(ExtractionEntityType, created.id)
    assert row is not None and row.entry_label == "arm"


@pytest.mark.asyncio
async def test_update_cardinality_on_root_refused(db_session: AsyncSession) -> None:
    """D5: cardinality is editable ONLY on model_section — roots keep
    their create-time choice."""
    template_id = await _fresh_clone(db_session)
    study_id = await _section_id_by_role(db_session, template_id, "study_section")

    with pytest.raises(SectionCardinalityRoleError):
        await _update(db_session, template_id, study_id, SectionUpdateRequest(cardinality="many"))


@pytest.mark.asyncio
async def test_update_cardinality_on_container_refused(db_session: AsyncSession) -> None:
    """D5: a group always repeats — even a no-op 'many' write is refused
    by role, keeping the rule deterministic."""
    template_id = await _fresh_clone(db_session)
    container_id = await _section_id_by_role(db_session, template_id, "model_container")

    with pytest.raises(SectionCardinalityRoleError):
        await _update(
            db_session, template_id, container_id, SectionUpdateRequest(cardinality="many")
        )


@pytest.mark.asyncio
async def test_update_cardinality_one_to_many(db_session: AsyncSession) -> None:
    """one -> many is always free (renders MORE than before)."""
    template_id = await _fresh_clone(db_session)
    section = await _section_by_name(db_session, template_id, "model_development")
    assert section.cardinality == "one", "seed precondition"

    read = await _update(
        db_session, template_id, section.id, SectionUpdateRequest(cardinality="many")
    )

    assert read.cardinality == "many"
    assert section.cardinality == "many"


@pytest.mark.asyncio
async def test_update_cardinality_many_to_one_with_singletons(db_session: AsyncSession) -> None:
    """many -> one is free while every parent instance holds at most one
    entry of this section (nothing the run view renders is lost)."""
    template_id = await _fresh_clone(db_session)
    container = await _section_by_name(db_session, template_id, "prediction_models")
    section = await _section_by_name(db_session, template_id, "final_predictors")
    assert section.cardinality == "many", "seed precondition"

    parent_a = await _insert_instance(
        db_session, template_id=template_id, entity_type_id=container.id, label="Model A"
    )
    parent_b = await _insert_instance(
        db_session,
        template_id=template_id,
        entity_type_id=container.id,
        label="Model B",
        sort_order=1,
    )
    await _insert_instance(
        db_session,
        template_id=template_id,
        entity_type_id=section.id,
        parent_instance_id=parent_a,
    )
    await _insert_instance(
        db_session,
        template_id=template_id,
        entity_type_id=section.id,
        parent_instance_id=parent_b,
    )
    await db_session.flush()

    read = await _update(
        db_session, template_id, section.id, SectionUpdateRequest(cardinality="one")
    )
    assert read.cardinality == "one"


@pytest.mark.asyncio
async def test_update_cardinality_many_to_one_in_use_refused(db_session: AsyncSession) -> None:
    """D5: a parent instance with 2+ entries blocks many -> one —
    otherwise the completion gate counts instances the run view no
    longer renders and runs become un-completable. The error names the
    section so the config editor can say which."""
    template_id = await _fresh_clone(db_session)
    container = await _section_by_name(db_session, template_id, "prediction_models")
    section = await _section_by_name(db_session, template_id, "final_predictors")

    parent = await _insert_instance(
        db_session, template_id=template_id, entity_type_id=container.id, label="Model A"
    )
    await _insert_instance(
        db_session,
        template_id=template_id,
        entity_type_id=section.id,
        parent_instance_id=parent,
    )
    await _insert_instance(
        db_session,
        template_id=template_id,
        entity_type_id=section.id,
        parent_instance_id=parent,
        sort_order=1,
    )
    await db_session.flush()

    with pytest.raises(SectionCardinalityInUseError) as exc:
        await _update(db_session, template_id, section.id, SectionUpdateRequest(cardinality="one"))
    assert section.label in str(exc.value), "error must name the section"

    unchanged = (
        await db_session.execute(
            select(ExtractionEntityType.cardinality).where(ExtractionEntityType.id == section.id)
        )
    ).scalar_one()
    assert unchanged == "many", "the refusal must not write"


@pytest.mark.asyncio
async def test_noop_update_skips_draft_marker(db_session: AsyncSession) -> None:
    """Field-wise no-op contract: writing the current values back must
    not flush, so the 0048 trigger never stamps ``config_draft_since``;
    an actual change stamps it."""
    template_id = await _fresh_clone(db_session)
    container = await _section_by_name(db_session, template_id, "prediction_models")
    await set_config_draft_marker(db_session, template_id, None)

    read = await _update(
        db_session,
        template_id,
        container.id,
        SectionUpdateRequest(label=container.label, entry_label="model"),
    )
    assert read.label == container.label
    assert await get_config_draft_marker(db_session, template_id) is None, (
        "a no-op update must not stamp the draft marker"
    )

    await _update(db_session, template_id, container.id, SectionUpdateRequest(entry_label="algo"))
    assert await get_config_draft_marker(db_session, template_id) is not None, (
        "a real update must stamp the draft marker (0048 trigger)"
    )


@pytest.mark.asyncio
async def test_update_is_bola_guarded(db_session: AsyncSession) -> None:
    """Foreign-project template 404s; foreign-template section 404s —
    the section BOLA chain section -> template -> project holds."""
    template_id = await _fresh_clone(db_session)
    section_id = await _section_id_by_role(db_session, template_id, "study_section")

    # Template not owned by the path project.
    with pytest.raises(ProjectTemplateNotFoundError):
        await update_section(
            db_session,
            project_id=SEED.primary_project,
            template_id=template_id,
            section_id=section_id,
            payload=SectionUpdateRequest(label="X"),
        )

    # Section owned by ANOTHER template (the seeded primary one).
    with pytest.raises(SectionNotFoundError):
        await update_section(
            db_session,
            project_id=SEED.secondary_project,
            template_id=template_id,
            section_id=SEED.primary_entity_type,
            payload=SectionUpdateRequest(label="X"),
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
async def test_delete_sweeps_the_empty_instances_a_session_seeded(
    db_session: AsyncSession,
) -> None:
    """Opening an article's extraction form seeds ONE empty instance per
    top-level section. That row is scaffolding, not work — the delete
    sweeps it and succeeds.

    The regression this pins: the RESTRICT FK used to be the sole arbiter,
    so a single reviewer opening a single article made EVERY main section
    permanently un-deletable, and the refusal claimed extraction work
    referenced the section's fields when nothing did."""
    project_id, template_id, _ = await fresh_charms(db_session)
    section_id = await entity_id(db_session, template_id, "sample_size")
    await open_session(
        db_session,
        project_id=project_id,
        article_id=ARTICLE_ID,
        template_id=template_id,
        user_id=SEED.primary_profile,
    )
    assert await _instance_count(db_session, section_id) == 1

    result = await delete_section(
        db_session,
        project_id=project_id,
        template_id=template_id,
        section_id=section_id,
    )

    assert result.deleted is True
    assert await _instance_count(db_session, section_id) == 0
    gone = (
        await db_session.execute(
            select(ExtractionEntityType.id).where(ExtractionEntityType.id == section_id)
        )
    ).scalar_one_or_none()
    assert gone is None


@pytest.mark.asyncio
async def test_delete_section_holding_recorded_work_refused(
    db_session: AsyncSession,
) -> None:
    """One proposal under the section is real work — refused, and the
    section survives."""
    project_id, template_id, _ = await fresh_charms(db_session)
    section_id = await entity_id(db_session, template_id, "sample_size")
    target = await field_id(db_session, template_id, "sample_size", "number_of_participants")
    session = await open_session(
        db_session,
        project_id=project_id,
        article_id=ARTICLE_ID,
        template_id=template_id,
        user_id=SEED.primary_profile,
    )
    await make_proposal(
        db_session,
        run_id=session.run_id,
        instance_id=uuid.UUID(session.instances_by_entity_type[str(section_id)]),
        field_id=target,
        user_id=SEED.primary_profile,
    )

    with pytest.raises(SectionInUseError):
        await delete_section(
            db_session,
            project_id=project_id,
            template_id=template_id,
            section_id=section_id,
        )

    still_there = (
        await db_session.execute(
            select(ExtractionEntityType.id).where(ExtractionEntityType.id == section_id)
        )
    ).scalar_one_or_none()
    assert still_there is not None


@pytest.mark.asyncio
async def test_delete_group_sweeps_its_child_sections_instances(
    db_session: AsyncSession,
) -> None:
    """A repeating group cascades to its per-model sections, so the sweep
    must reach THEIR instances too — the child's own RESTRICT FK fires
    during that cascade otherwise."""
    template_id = await _fresh_clone(db_session)
    group_id = await _section_id_by_role(db_session, template_id, "model_container")
    child_id = (
        (
            await db_session.execute(
                select(ExtractionEntityType.id).where(
                    ExtractionEntityType.parent_entity_type_id == group_id
                )
            )
        )
        .scalars()
        .first()
    )
    assert child_id is not None
    group_instance = await _insert_instance(
        db_session, template_id=template_id, entity_type_id=group_id
    )
    await _insert_instance(
        db_session,
        template_id=template_id,
        entity_type_id=child_id,
        parent_instance_id=group_instance,
    )

    result = await delete_section(
        db_session,
        project_id=SEED.secondary_project,
        template_id=template_id,
        section_id=group_id,
    )

    assert result.deleted is True
    assert await _instance_count(db_session, child_id) == 0


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
