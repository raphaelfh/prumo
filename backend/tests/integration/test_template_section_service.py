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
Here the service's Python pre-check (``SectionParentMustRepeatError``)
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
    SectionCardinalityInUseError,
    SectionEntryLabelCardinalityError,
    SectionInUseError,
    SectionNotFoundError,
    SectionOwnsChildrenError,
    SectionParentMustRepeatError,
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


async def _first_section(
    db: AsyncSession, template_id: uuid.UUID, *, nested: bool, repeats: bool
) -> uuid.UUID:
    """The template's first section of a given SHAPE, by sort order.

    Was keyed on `role`; 0069 removed it. `nested` replaces
    model_section-vs-root and `repeats` replaces container-vs-study.
    """
    parent = ExtractionEntityType.parent_entity_type_id
    return (
        await db.execute(
            select(ExtractionEntityType.id)
            .where(
                ExtractionEntityType.project_template_id == template_id,
                parent.is_not(None) if nested else parent.is_(None),
                ExtractionEntityType.cardinality == ("many" if repeats else "one"),
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


# =================== SCHEMA-LEVEL CREATE RULES ===================
# Unit-style asserts (no DB). The role/parent mirror that used to live here
# is gone with 0069: whether a named parent may own children is "does it
# repeat", which needs the parent ROW, so it is the SERVICE's rule and is
# covered by `test_a_parent_that_does_not_repeat_is_refused` below. What
# stays at this boundary is what the request alone can decide.


class TestCreateRequestRules:
    def test_client_supplied_sort_order_is_rejected(self) -> None:
        # sort_order is server-computed for sections (kills the frontend
        # read-then-write race); extra="forbid" refuses the key outright.
        with pytest.raises(ValidationError, match="sort_order"):
            make_create(sort_order=99)

    def test_a_parent_may_be_named_without_any_role(self) -> None:
        """`role` was REQUIRED and had to agree with the parent. A nested
        section is now just one that names a parent."""
        parent = str(uuid.uuid4())
        assert make_create(parent_entity_type_id=parent).parent_entity_type_id == uuid.UUID(parent)


# =================== SCHEMA-LEVEL ENTRY-NOUN CREATE RULES ===================

# Was parametrized over the three roles. The shapes that matter now are
# root vs nested — a repeating section carries a noun wherever it sits.
_SHAPES = [
    pytest.param({}, id="root"),
    pytest.param({"parent_entity_type_id": str(uuid.uuid4())}, id="nested"),
]


class TestCreateRequestEntryLabelRules:
    @pytest.mark.parametrize("shape", _SHAPES)
    @pytest.mark.parametrize(
        ("entry_label", "message"),
        [
            pytest.param(None, "required on a repeating section", id="absent"),
            pytest.param("", "at least 1 character", id="empty"),
            pytest.param("   ", "at least 1 character", id="blank"),
        ],
    )
    def test_repeating_section_without_entry_label_is_rejected(
        self, shape: dict[str, str], entry_label: str | None, message: str
    ) -> None:
        """A repeating section is created WITH its noun: an absent noun trips
        the model rule and a blank one the ``SectionEntryLabel`` shape —
        refused, never 'unset'. 0069 makes the same rule a CHECK."""
        with pytest.raises(ValidationError, match=message):
            make_create(cardinality="many", entry_label=entry_label, **shape)

    @pytest.mark.parametrize("shape", _SHAPES)
    def test_entry_label_is_kept_trimmed_wherever_the_section_sits(
        self, shape: dict[str, str]
    ) -> None:
        """Every repeating section is an entry group — root or nested."""
        assert make_create(cardinality="many", entry_label=" predictor ", **shape).entry_label == (
            "predictor"
        )

    @pytest.mark.parametrize("shape", _SHAPES)
    def test_entry_label_on_a_non_repeating_section_is_rejected(
        self, shape: dict[str, str]
    ) -> None:
        with pytest.raises(ValidationError, match="only valid for a repeating"):
            make_create(entry_label="model", **shape)


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

    def test_description_is_trimmed_and_a_blank_one_is_kept_as_a_clear(self) -> None:
        # The section description is the section's AI instruction; unlike a
        # label, emptying it is a legitimate edit (the service clears it).
        assert SectionUpdateRequest(description="  Guide  ").description == "Guide"
        assert SectionUpdateRequest(description="   ").description == ""

    def test_description_over_500_characters_rejected(self) -> None:
        with pytest.raises(ValidationError, match="description"):
            SectionUpdateRequest(description="x" * 501)

    def test_null_description_rejected(self) -> None:
        with pytest.raises(ValidationError, match="description"):
            SectionUpdateRequest(description=None)

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
    assert read.parent_entity_type_id is None
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
    container_id = await _first_section(db_session, template_id, nested=False, repeats=True)

    read = await create_section(
        db_session,
        project_id=SEED.secondary_project,
        template_id=template_id,
        payload=make_create(
            name="custom_model_section",
            label="Custom Model Section",
            parent_entity_type_id=container_id,
        ),
    )

    assert read.parent_entity_type_id is not None
    assert read.parent_entity_type_id == container_id


@pytest.mark.asyncio
async def test_create_model_section_under_non_container_parent_refused(
    db_session: AsyncSession,
) -> None:
    """The service pre-checks the parent role, surfacing the deferred
    trigger's predicate as a typed request-time error."""
    template_id = await _fresh_clone(db_session)
    study_id = await _first_section(db_session, template_id, nested=False, repeats=False)

    with pytest.raises(SectionParentMustRepeatError):
        await create_section(
            db_session,
            project_id=SEED.secondary_project,
            template_id=template_id,
            payload=make_create(
                name="bad_model_section",
                parent_entity_type_id=study_id,
            ),
        )


@pytest.mark.asyncio
async def test_a_second_root_group_is_now_created(db_session: AsyncSession) -> None:
    """Was `test_create_second_model_container_refused`.

    The CHARMS clone already has a root group, and 0016's partial unique
    index turned a second one into a 23505 the service remapped to
    `OneContainerError`. 0069 drops that index — several root groups per
    template is the point of the train — so this asserts the create SUCCEEDS
    rather than that an exception stopped being raised.
    """
    template_id = await _fresh_clone(db_session)

    read = await create_section(
        db_session,
        project_id=SEED.secondary_project,
        template_id=template_id,
        payload=make_create(
            name="second_container",
            label="Second Container",
            cardinality="many",
            entry_label="arm",
        ),
    )

    assert read.parent_entity_type_id is None
    assert read.cardinality == "many"


@pytest.mark.asyncio
async def test_create_container_carries_explicit_entry_label(db_session: AsyncSession) -> None:
    template_id = await _fresh_clone(db_session)
    container_id = await _first_section(db_session, template_id, nested=False, repeats=True)
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
    section_id = await _first_section(db_session, template_id, nested=False, repeats=False)

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
    container_id = await _first_section(db_session, template_id, nested=False, repeats=True)

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
    container_id = await _first_section(db_session, template_id, nested=False, repeats=True)

    read = await _update(
        db_session,
        template_id,
        container_id,
        SectionUpdateRequest(label="Algorithms", entry_label="algorithm"),
    )

    assert read.label == "Algorithms"
    assert read.entry_label == "algorithm"


@pytest.mark.asyncio
async def test_update_description_on_any_shape(db_session: AsyncSession) -> None:
    """The description is the section's AI instruction (sent with every
    extraction of the section; the identification instruction of a
    repeating one) — editable after creation on every SHAPE, where before
    only label / entry_label / cardinality were."""
    template_id = await _fresh_clone(db_session)
    for nested, repeats in ((False, False), (False, True), (True, False)):
        section_id = await _first_section(db_session, template_id, nested=nested, repeats=repeats)

        read = await _update(
            db_session,
            template_id,
            section_id,
            SectionUpdateRequest(description="  One entry per reported model.  "),
        )

        assert read.description == "One entry per reported model."
        stored = (
            await db_session.execute(
                select(ExtractionEntityType.description).where(
                    ExtractionEntityType.id == section_id
                )
            )
        ).scalar_one()
        assert stored == "One entry per reported model."


@pytest.mark.asyncio
async def test_update_blank_description_clears_it(db_session: AsyncSession) -> None:
    template_id = await _fresh_clone(db_session)
    section_id = await _first_section(db_session, template_id, nested=False, repeats=False)
    await _update(db_session, template_id, section_id, SectionUpdateRequest(description="Guide"))

    read = await _update(db_session, template_id, section_id, SectionUpdateRequest(description=""))

    assert read.description is None
    stored = (
        await db_session.execute(
            select(ExtractionEntityType.description).where(ExtractionEntityType.id == section_id)
        )
    ).scalar_one()
    assert stored is None


@pytest.mark.asyncio
async def test_noop_description_update_skips_draft_marker(db_session: AsyncSession) -> None:
    """Writing the current description back (or blank onto an empty one) is
    a no-op like any other field: no flush, no 0048 stamp."""
    template_id = await _fresh_clone(db_session)
    container = await _section_by_name(db_session, template_id, "prediction_models")
    await set_config_draft_marker(db_session, template_id, None)

    await _update(
        db_session,
        template_id,
        container.id,
        SectionUpdateRequest(description=container.description or ""),
    )

    assert await get_config_draft_marker(db_session, template_id) is None


@pytest.mark.asyncio
async def test_update_entry_label_on_non_repeating_section_refused(
    db_session: AsyncSession,
) -> None:
    """D5: the entry noun names one entry of a repeating section — a section
    that does not repeat has nothing for it to name."""
    template_id = await _fresh_clone(db_session)
    study_id = await _first_section(db_session, template_id, nested=False, repeats=False)

    with pytest.raises(SectionEntryLabelCardinalityError):
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
        payload=make_create(
            name="arms", label="Study arms", cardinality="many", entry_label="participant"
        ),
    )
    assert created.entry_label == "participant"

    read = await _update(
        db_session, template_id, created.id, SectionUpdateRequest(entry_label="arm")
    )
    assert read.entry_label == "arm"
    row = await db_session.get(ExtractionEntityType, created.id)
    assert row is not None and row.entry_label == "arm"


@pytest.mark.asyncio
async def test_a_root_singleton_may_now_start_repeating(db_session: AsyncSession) -> None:
    """Was `test_update_cardinality_on_root_refused`.

    D5 allowed the edit only on a `model_section`, so a root kept its
    create-time choice forever. Cardinality is editable on any section now
    (spec §5) — a manager turning "Outcomes" into a group is the point.
    The noun is required in the same PATCH, because 0069's CHECK refuses a
    repeating section without one.
    """
    template_id = await _fresh_clone(db_session)
    study_id = await _first_section(db_session, template_id, nested=False, repeats=False)

    read = await _update(
        db_session,
        template_id,
        study_id,
        SectionUpdateRequest(cardinality="many", entry_label="outcome"),
    )

    assert read.cardinality == "many"
    assert read.entry_label == "outcome"


@pytest.mark.asyncio
async def test_turning_a_section_into_a_group_without_a_noun_is_refused(
    db_session: AsyncSession,
) -> None:
    """The readable half of 0069's `ck_..._noun_on_repeating`.

    The CHECK is the backstop; refusing here names the section, so the
    manager is told WHICH one needs a word.
    """
    template_id = await _fresh_clone(db_session)
    study_id = await _first_section(db_session, template_id, nested=False, repeats=False)

    with pytest.raises(SectionEntryLabelCardinalityError, match="needs a word for one entry"):
        await _update(db_session, template_id, study_id, SectionUpdateRequest(cardinality="many"))


@pytest.mark.asyncio
async def test_a_group_that_owns_children_may_not_stop_repeating(
    db_session: AsyncSession,
) -> None:
    """Was `test_update_cardinality_on_container_refused`, which refused by
    ROLE — even a no-op 'many' write. The rule that actually protects data
    is the one about children: they are filled once per ENTRY, so a section
    that stops repeating would leave them hanging off nothing.
    """
    template_id = await _fresh_clone(db_session)
    container_id = await _first_section(db_session, template_id, nested=False, repeats=True)

    with pytest.raises(SectionOwnsChildrenError, match="owns sections"):
        await _update(
            db_session, template_id, container_id, SectionUpdateRequest(cardinality="one")
        )


@pytest.mark.asyncio
async def test_update_cardinality_one_to_many(db_session: AsyncSession) -> None:
    """one -> many is free (renders MORE than before) — with its noun.

    0069 requires a repeating section to carry the word for one entry, so
    the PATCH that turns a section into a group carries it too.
    """
    template_id = await _fresh_clone(db_session)
    section = await _section_by_name(db_session, template_id, "model_development")
    assert section.cardinality == "one", "seed precondition"

    read = await _update(
        db_session,
        template_id,
        section.id,
        SectionUpdateRequest(cardinality="many", entry_label="stage"),
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
    section_id = await _first_section(db_session, template_id, nested=False, repeats=False)

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
    section_id = await _first_section(db_session, template_id, nested=False, repeats=False)

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
    group_id = await _first_section(db_session, template_id, nested=False, repeats=True)
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
                parent_entity_type_id=SEED.primary_entity_type,
            ),
        )
