"""entry_hierarchy_service: one entry, any group, singleton children.

Unmocked against a real CHARMS clone, for the reason
``test_model_hierarchy_service`` was written: the endpoint success test
mocks the service, so a broken lookup inside it ships as a deterministic
500 on every click.

No entity type is constructed here. CHARMS already supplies both shapes
this suite needs — ``prediction_models`` is the root group and
``final_predictors`` (entry_label "predictor") the nested one — so the
slice writes no ``role`` anywhere, tests included.
"""

from __future__ import annotations

from uuid import UUID, uuid4

import pytest
from sqlalchemy import select, text, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction import (
    ExtractionCardinality,
    ExtractionEntityType,
    ExtractionField,
    ExtractionInstance,
)
from app.models.extraction_versioning import TemplateKind
from app.models.extraction_workflow import ExtractionReviewerDecision
from app.services.entity_key import key_of
from app.services.entry_hierarchy_service import (
    EntryHierarchyService,
    EntryKeyDuplicateError,
    EntryTargetNotFoundError,
    InvalidEntryTargetError,
)
from app.services.template_clone_service import TemplateCloneService
from tests.integration.conftest import (
    SEED,
    clean_project_clones,
    clone_charms,
    open_session,
)

PROBAST_GLOBAL_ID = UUID("00b00000-0000-0000-0000-000000000001")


async def _fresh_article(db: AsyncSession, project_id: UUID, title: str = "Entry article") -> UUID:
    article_id = uuid4()
    await db.execute(
        text(
            "INSERT INTO public.articles (id, project_id, title, row_version) "
            "VALUES (:id, :pid, :t, 1)"
        ),
        {"id": str(article_id), "pid": str(project_id), "t": title},
    )
    await db.flush()
    return article_id


async def _clone_with_article(db: AsyncSession) -> tuple[UUID, UUID]:
    """CHARMS clone + a fresh article in the secondary project.

    ``clone_charms`` is IDEMPOTENT on (project, global template) — a second
    call returns the SAME clone — so a test that needs two coordinates makes
    two ARTICLES, never two clones.
    """
    await clean_project_clones(db, SEED.secondary_project)
    clone = await clone_charms(db, SEED.secondary_project, SEED.primary_profile)
    article_id = await _fresh_article(db, SEED.secondary_project)
    return clone.project_template_id, article_id


async def _group(db: AsyncSession, template_id: UUID, *, name: str) -> ExtractionEntityType:
    """A seeded repeating section of the clone, by name.

    Ordered and ``.one()``: an unordered ``.first()`` is not a contract.
    """
    return (
        (
            await db.execute(
                select(ExtractionEntityType)
                .where(
                    ExtractionEntityType.project_template_id == template_id,
                    ExtractionEntityType.name == name,
                    ExtractionEntityType.cardinality == ExtractionCardinality.MANY.value,
                )
                .order_by(ExtractionEntityType.sort_order)
            )
        )
        .scalars()
        .one()
    )


async def _key_field(db: AsyncSession, entity_type_id: UUID) -> ExtractionField | None:
    return (
        (
            await db.execute(
                select(ExtractionField).where(
                    ExtractionField.entity_type_id == entity_type_id,
                    ExtractionField.is_entity_key.is_(True),
                )
            )
        )
        .scalars()
        .first()
    )


async def _qa_template_in(db: AsyncSession, project_id: UUID) -> UUID:
    clone = await TemplateCloneService(db).clone(
        project_id=project_id,
        global_template_id=PROBAST_GLOBAL_ID,
        user_id=SEED.primary_profile,
        kind=TemplateKind.QUALITY_ASSESSMENT,
    )
    return clone.project_template_id


@pytest.mark.asyncio
async def test_a_root_group_entry_is_created_with_its_singleton_children(
    db_session: AsyncSession,
) -> None:
    template_id, article_id = await _clone_with_article(db_session)
    group = await _group(db_session, template_id, name="prediction_models")
    assert await _key_field(db_session, group.id) is not None, (
        "PRECONDITION: prediction_models must declare an entry key"
    )

    singleton_children = {
        et.id: et.label
        for et in (
            await db_session.execute(
                select(ExtractionEntityType).where(
                    ExtractionEntityType.parent_entity_type_id == group.id,
                    ExtractionEntityType.cardinality == ExtractionCardinality.ONE.value,
                )
            )
        ).scalars()
    }
    assert singleton_children, "PRECONDITION: the group must have singleton children"

    result = await EntryHierarchyService(db_session).create_entry(
        project_id=SEED.secondary_project,
        article_id=article_id,
        template_id=template_id,
        entity_type_id=group.id,
        parent_instance_id=None,
        label="Cox Model",
        entity_key="Cox Model",
        user_id=SEED.primary_profile,
    )

    entry = await db_session.get(ExtractionInstance, result.instance_id)
    assert entry is not None
    assert entry.label == "Cox Model"
    assert entry.parent_instance_id is None
    assert key_of(entry) == "cox model"
    assert entry.metadata_["created_via"] == "manual"

    # Assert the WRITE, not the return value: one instance per singleton
    # child, parented to the new entry, each carrying provenance.
    written = (
        (
            await db_session.execute(
                select(ExtractionInstance).where(
                    ExtractionInstance.parent_instance_id == result.instance_id
                )
            )
        )
        .scalars()
        .all()
    )
    assert {i.entity_type_id for i in written} == set(singleton_children)
    assert all(i.metadata_.get("created_via") == "manual" for i in written)
    # Descendant label format: no trailing counter (the old path wrote " 1").
    some = written[0]
    assert some.label == f"Cox Model - {singleton_children[some.entity_type_id]}"


@pytest.mark.asyncio
async def test_a_duplicate_key_is_refused_with_the_typed_409(
    db_session: AsyncSession,
) -> None:
    template_id, article_id = await _clone_with_article(db_session)
    group = await _group(db_session, template_id, name="prediction_models")
    assert await _key_field(db_session, group.id) is not None, (
        "PRECONDITION: without a key field the duplicate check is skipped and "
        "this test would fail with a bare DID NOT RAISE naming nothing"
    )
    service = EntryHierarchyService(db_session)
    common = {
        "project_id": SEED.secondary_project,
        "article_id": article_id,
        "template_id": template_id,
        "entity_type_id": group.id,
        "parent_instance_id": None,
        "user_id": SEED.primary_profile,
    }
    first = await service.create_entry(label="Cox Model", entity_key="Cox Model", **common)
    stamped = await db_session.get(ExtractionInstance, first.instance_id)
    assert stamped is not None and key_of(stamped) == "cox model"

    # Normalization folds case and whitespace — this IS the same entity.
    with pytest.raises(EntryKeyDuplicateError) as exc:
        await service.create_entry(label="cox   model", entity_key="cox   model", **common)
    assert exc.value.status_code == 409
    assert exc.value.code == "ENTRY_KEY_DUPLICATE"


@pytest.mark.asyncio
async def test_a_nested_group_entry_lands_under_its_parent(
    db_session: AsyncSession,
) -> None:
    """The §13 B2 happy path for a nested group."""
    template_id, article_id = await _clone_with_article(db_session)
    root = await _group(db_session, template_id, name="prediction_models")
    nested = await _group(db_session, template_id, name="final_predictors")
    assert nested.parent_entity_type_id == root.id, (
        "PRECONDITION: final_predictors must be nested under prediction_models"
    )
    service = EntryHierarchyService(db_session)
    common = {
        "project_id": SEED.secondary_project,
        "article_id": article_id,
        "template_id": template_id,
        "user_id": SEED.primary_profile,
    }
    parent = await service.create_entry(
        entity_type_id=root.id,
        parent_instance_id=None,
        label="Cox Model",
        entity_key="Cox Model",
        **common,
    )
    nested_key = await _key_field(db_session, nested.id)
    child = await service.create_entry(
        entity_type_id=nested.id,
        parent_instance_id=parent.instance_id,
        label="Age",
        entity_key="Age" if nested_key else None,
        **common,
    )
    row = await db_session.get(ExtractionInstance, child.instance_id)
    assert row is not None
    assert row.parent_instance_id == parent.instance_id
    assert row.entity_type_id == nested.id


@pytest.mark.asyncio
async def test_a_nested_group_requires_its_parent_entry(db_session: AsyncSession) -> None:
    template_id, article_id = await _clone_with_article(db_session)
    nested = await _group(db_session, template_id, name="final_predictors")
    with pytest.raises(InvalidEntryTargetError):
        await EntryHierarchyService(db_session).create_entry(
            project_id=SEED.secondary_project,
            article_id=article_id,
            template_id=template_id,
            entity_type_id=nested.id,
            parent_instance_id=None,
            label="Age",
            entity_key=None,
            user_id=SEED.primary_profile,
        )


@pytest.mark.asyncio
async def test_a_root_group_refuses_a_parent(db_session: AsyncSession) -> None:
    template_id, article_id = await _clone_with_article(db_session)
    root = await _group(db_session, template_id, name="prediction_models")
    service = EntryHierarchyService(db_session)
    common = {
        "project_id": SEED.secondary_project,
        "article_id": article_id,
        "template_id": template_id,
        "user_id": SEED.primary_profile,
    }
    first = await service.create_entry(
        entity_type_id=root.id,
        parent_instance_id=None,
        label="Cox Model",
        entity_key="Cox Model",
        **common,
    )
    with pytest.raises(InvalidEntryTargetError):
        await service.create_entry(
            entity_type_id=root.id,
            parent_instance_id=first.instance_id,
            label="Nested by mistake",
            entity_key="Nested by mistake",
            **common,
        )


@pytest.mark.asyncio
async def test_an_entry_under_another_articles_parent_is_refused(
    db_session: AsyncSession,
) -> None:
    """The client-supplied parent id is the classic BOLA vector.

    ONE clone (``clone_charms`` is idempotent), TWO articles — what refuses
    the write is the article half of ``get_in_coordinate``.
    """
    template_id, article_a = await _clone_with_article(db_session)
    article_b = await _fresh_article(db_session, SEED.secondary_project, "Second article")
    root = await _group(db_session, template_id, name="prediction_models")
    nested = await _group(db_session, template_id, name="final_predictors")
    service = EntryHierarchyService(db_session)

    other = await service.create_entry(
        project_id=SEED.secondary_project,
        article_id=article_b,
        template_id=template_id,
        entity_type_id=root.id,
        parent_instance_id=None,
        label="Other article's model",
        entity_key="Other article's model",
        user_id=SEED.primary_profile,
    )
    with pytest.raises(EntryTargetNotFoundError) as exc:
        await service.create_entry(
            project_id=SEED.secondary_project,
            article_id=article_a,
            template_id=template_id,
            entity_type_id=nested.id,
            parent_instance_id=other.instance_id,
            label="Age",
            entity_key=None,
            user_id=SEED.primary_profile,
        )
    # Name the guard that fired: every other refusal on this path raises a
    # different message, so a green here cannot be borrowed from one of them.
    assert str(exc.value) == "Parent entry not found"


@pytest.mark.asyncio
async def test_a_singleton_section_has_no_entries(db_session: AsyncSession) -> None:
    template_id, article_id = await _clone_with_article(db_session)
    singleton = (
        (
            await db_session.execute(
                select(ExtractionEntityType)
                .where(
                    ExtractionEntityType.project_template_id == template_id,
                    ExtractionEntityType.cardinality == ExtractionCardinality.ONE.value,
                )
                .order_by(ExtractionEntityType.sort_order)
                .limit(1)
            )
        )
        .scalars()
        .one()
    )
    with pytest.raises(InvalidEntryTargetError):
        await EntryHierarchyService(db_session).create_entry(
            project_id=SEED.secondary_project,
            article_id=article_id,
            template_id=template_id,
            entity_type_id=singleton.id,
            parent_instance_id=None,
            label="Nope",
            entity_key=None,
            user_id=SEED.primary_profile,
        )


@pytest.mark.asyncio
async def test_a_foreign_article_is_refused_before_any_write(
    db_session: AsyncSession,
) -> None:
    template_id, _ = await _clone_with_article(db_session)
    group = await _group(db_session, template_id, name="prediction_models")

    def _project_instances():
        return select(ExtractionInstance.id).where(
            ExtractionInstance.project_id == SEED.secondary_project
        )

    before = set((await db_session.execute(_project_instances())).scalars())
    with pytest.raises(EntryTargetNotFoundError) as exc:
        await EntryHierarchyService(db_session).create_entry(
            project_id=SEED.secondary_project,
            article_id=uuid4(),
            template_id=template_id,
            entity_type_id=group.id,
            parent_instance_id=None,
            label="Cox Model",
            entity_key="Cox Model",
            user_id=SEED.primary_profile,
        )
    # It refused for the ARTICLE, not incidentally for the template.
    assert "Article" in str(exc.value)
    after = set((await db_session.execute(_project_instances())).scalars())
    assert after == before


@pytest.mark.asyncio
async def test_a_quality_assessment_template_is_refused(db_session: AsyncSession) -> None:
    """The retired service bound template KIND.

    Dropping that bind would let a quality-assessment template accept
    extraction entries: rows written against a template whose runs the
    decision lookup filters out, so no audit trail lands either.
    """
    template_id, article_id = await _clone_with_article(db_session)
    group = await _group(db_session, template_id, name="prediction_models")
    qa_template_id = await _qa_template_in(db_session, SEED.secondary_project)
    assert qa_template_id != template_id, "PRECONDITION: a distinct QA template"

    with pytest.raises(EntryTargetNotFoundError) as exc:
        await EntryHierarchyService(db_session).create_entry(
            project_id=SEED.secondary_project,
            article_id=article_id,
            template_id=qa_template_id,
            entity_type_id=group.id,
            parent_instance_id=None,
            label="Cox Model",
            entity_key="Cox Model",
            user_id=SEED.primary_profile,
        )
    # It must refuse at the TEMPLATE bind, naming the template. Asserting only
    # the exception type passes with the kind bind DELETED, because the
    # section bind then refuses the same id a step later with the same type —
    # verified by mutation, 2026-09-05.
    assert str(exc.value) == "Template not found", (
        "the refusal must come from the template kind bind, not incidentally "
        "from the section bind one step later"
    )


@pytest.mark.asyncio
async def test_a_keyless_group_is_created_from_a_label_alone(
    db_session: AsyncSession,
) -> None:
    """§3 invariant 6 — the human path never refuses for want of a key."""
    template_id, article_id = await _clone_with_article(db_session)
    root = await _group(db_session, template_id, name="prediction_models")
    # Capture BEFORE expiry: reading root.id afterwards triggers a refresh.
    root_id = root.id
    assert await _key_field(db_session, root_id) is not None, (
        "PRECONDITION: the group must start keyed for this test to mean anything"
    )
    cleared = await db_session.execute(
        update(ExtractionField)
        .where(ExtractionField.entity_type_id == root_id)
        .values(is_entity_key=False)
    )
    assert cleared.rowcount > 0
    await db_session.flush()
    db_session.expire_all()

    result = await EntryHierarchyService(db_session).create_entry(
        project_id=SEED.secondary_project,
        article_id=article_id,
        template_id=template_id,
        entity_type_id=root_id,
        parent_instance_id=None,
        label="Unkeyed model",
        entity_key=None,
        user_id=SEED.primary_profile,
    )
    entry = await db_session.get(ExtractionInstance, result.instance_id)
    assert entry is not None
    assert entry.label == "Unkeyed model"
    assert key_of(entry) is None


@pytest.mark.asyncio
async def test_a_keyed_group_refuses_a_missing_key(db_session: AsyncSession) -> None:
    template_id, article_id = await _clone_with_article(db_session)
    group = await _group(db_session, template_id, name="prediction_models")
    with pytest.raises(InvalidEntryTargetError):
        await EntryHierarchyService(db_session).create_entry(
            project_id=SEED.secondary_project,
            article_id=article_id,
            template_id=template_id,
            entity_type_id=group.id,
            parent_instance_id=None,
            label="Cox Model",
            entity_key=None,
            user_id=SEED.primary_profile,
        )


@pytest.mark.asyncio
async def test_the_key_value_is_recorded_as_this_reviewers_decision(
    db_session: AsyncSession,
) -> None:
    template_id, article_id = await _clone_with_article(db_session)
    session = await open_session(
        db_session,
        project_id=SEED.secondary_project,
        article_id=article_id,
        template_id=template_id,
        user_id=SEED.primary_profile,
    )
    group = await _group(db_session, template_id, name="prediction_models")
    key_field = await _key_field(db_session, group.id)
    assert key_field is not None, "PRECONDITION: the group must declare a key"

    result = await EntryHierarchyService(db_session).create_entry(
        project_id=SEED.secondary_project,
        article_id=article_id,
        template_id=template_id,
        entity_type_id=group.id,
        parent_instance_id=None,
        label="Cox Model",
        entity_key="Cox Model",
        user_id=SEED.primary_profile,
    )
    decision = (
        (
            await db_session.execute(
                select(ExtractionReviewerDecision).where(
                    ExtractionReviewerDecision.run_id == session.run_id,
                    ExtractionReviewerDecision.instance_id == result.instance_id,
                    ExtractionReviewerDecision.field_id == key_field.id,
                )
            )
        )
        .scalars()
        .first()
    )
    assert decision is not None
    assert decision.value == {"value": "Cox Model"}
    assert decision.reviewer_id == SEED.primary_profile


@pytest.mark.asyncio
async def test_a_keyless_group_records_no_decision(db_session: AsyncSession) -> None:
    template_id, article_id = await _clone_with_article(db_session)
    session = await open_session(
        db_session,
        project_id=SEED.secondary_project,
        article_id=article_id,
        template_id=template_id,
        user_id=SEED.primary_profile,
    )
    root = await _group(db_session, template_id, name="prediction_models")
    root_id = root.id
    await db_session.execute(
        update(ExtractionField)
        .where(ExtractionField.entity_type_id == root_id)
        .values(is_entity_key=False)
    )
    await db_session.flush()
    db_session.expire_all()

    result = await EntryHierarchyService(db_session).create_entry(
        project_id=SEED.secondary_project,
        article_id=article_id,
        template_id=template_id,
        entity_type_id=root_id,
        parent_instance_id=None,
        label="Unkeyed",
        entity_key=None,
        user_id=SEED.primary_profile,
    )
    rows = (
        (
            await db_session.execute(
                select(ExtractionReviewerDecision).where(
                    ExtractionReviewerDecision.run_id == session.run_id,
                    ExtractionReviewerDecision.instance_id == result.instance_id,
                )
            )
        )
        .scalars()
        .all()
    )
    assert rows == []
