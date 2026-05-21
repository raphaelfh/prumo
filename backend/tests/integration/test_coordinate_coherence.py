"""Integration tests for coordinate_coherence helper."""

from uuid import UUID, uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.article import Article
from app.models.extraction import ExtractionField, ExtractionInstance
from app.models.project import Project, ProjectMember
from app.services.coordinate_coherence import (
    CoordinateMismatchError,
    assert_coords_coherent,
)
from app.services.run_lifecycle_service import RunLifecycleService
from tests.factories import TemplateFactory


async def _coherent_triplet(db: AsyncSession):
    profile_id = (await db.execute(text("SELECT id FROM public.profiles LIMIT 1"))).scalar()
    if profile_id is None:
        return None
    # Pick an existing instance and field whose article/template already line up.
    row = await db.execute(
        text("""
        SELECT i.project_id, i.article_id, i.template_id, i.id, f.id
        FROM public.extraction_instances i
        JOIN public.extraction_entity_types et ON et.id = i.entity_type_id
        JOIN public.extraction_fields f ON f.entity_type_id = et.id
        WHERE i.article_id IS NOT NULL
        LIMIT 1
        """),
    )
    pair = row.first()
    if pair is None:
        return None
    project_id, article_id, template_id, instance_id, field_id = pair

    lifecycle = RunLifecycleService(db)
    run = await lifecycle.create_run(
        project_id=project_id,
        article_id=article_id,
        project_template_id=template_id,
        user_id=profile_id,
    )
    return run.id, instance_id, field_id


async def _cross_article_fixture(
    db: AsyncSession,
) -> tuple[UUID, UUID, UUID, UUID] | None:
    profile_id = (await db.execute(text("SELECT id FROM public.profiles LIMIT 1"))).scalar()
    if profile_id is None:
        return None

    project_id = uuid4()
    run_article_id = uuid4()
    other_article_id = uuid4()
    db.add(Project(id=project_id, name="coord-coherence-project", created_by_id=profile_id))
    db.add(ProjectMember(project_id=project_id, user_id=profile_id, role="manager"))
    db.add_all(
        [
            Article(id=run_article_id, project_id=project_id, title="Run article"),
            Article(id=other_article_id, project_id=project_id, title="Other article"),
        ]
    )
    factory = TemplateFactory(db, project_id, profile_id)
    template_id = await factory.create(name="coord-coherence-template")
    entity_type_id = await factory.add_study_section(template_id, name="study")
    field = ExtractionField(
        entity_type_id=entity_type_id,
        name="outcome",
        label="Outcome",
        field_type="text",
    )
    db.add(field)
    await db.flush()

    other_article_instance = ExtractionInstance(
        project_id=project_id,
        article_id=other_article_id,
        template_id=template_id,
        entity_type_id=entity_type_id,
        label="Other article instance",
        created_by=profile_id,
    )
    db.add(other_article_instance)
    await db.flush()

    run = await RunLifecycleService(db).create_run(
        project_id=project_id,
        article_id=run_article_id,
        project_template_id=template_id,
        user_id=profile_id,
    )
    return run.id, other_article_instance.id, field.id, run_article_id


@pytest.mark.asyncio
async def test_coherent_triplet_passes(db_session: AsyncSession) -> None:
    fx = await _coherent_triplet(db_session)
    if fx is None:
        pytest.skip("Need fixtures.")
    run_id, instance_id, field_id = fx
    # Should not raise
    await assert_coords_coherent(
        db_session, run_id=run_id, instance_id=instance_id, field_id=field_id
    )
    await db_session.rollback()


@pytest.mark.asyncio
async def test_nonexistent_run_raises(db_session: AsyncSession) -> None:
    fx = await _coherent_triplet(db_session)
    if fx is None:
        pytest.skip("Need fixtures.")
    _, instance_id, field_id = fx
    with pytest.raises(CoordinateMismatchError):
        await assert_coords_coherent(
            db_session, run_id=uuid4(), instance_id=instance_id, field_id=field_id
        )
    await db_session.rollback()


@pytest.mark.asyncio
async def test_nonexistent_instance_raises(db_session: AsyncSession) -> None:
    fx = await _coherent_triplet(db_session)
    if fx is None:
        pytest.skip("Need fixtures.")
    run_id, _, field_id = fx
    with pytest.raises(CoordinateMismatchError):
        await assert_coords_coherent(
            db_session, run_id=run_id, instance_id=uuid4(), field_id=field_id
        )
    await db_session.rollback()


@pytest.mark.asyncio
async def test_field_from_different_entity_type_raises(db_session: AsyncSession) -> None:
    fx = await _coherent_triplet(db_session)
    if fx is None:
        pytest.skip("Need fixtures.")
    run_id, instance_id, _ = fx
    # Pick a field whose entity_type differs from the instance's
    other_field_row = await db_session.execute(
        text("""
        SELECT f.id FROM public.extraction_fields f
        WHERE f.entity_type_id <> (
            SELECT entity_type_id FROM public.extraction_instances WHERE id = :iid
        )
        LIMIT 1
    """),
        {"iid": instance_id},
    )
    other_field_id = other_field_row.scalar()
    if other_field_id is None:
        pytest.skip("Need >=2 entity_types with fields.")
    with pytest.raises(CoordinateMismatchError):
        await assert_coords_coherent(
            db_session, run_id=run_id, instance_id=instance_id, field_id=other_field_id
        )
    await db_session.rollback()


@pytest.mark.asyncio
async def test_instance_from_different_article_raises(db_session: AsyncSession) -> None:
    fx = await _cross_article_fixture(db_session)
    if fx is None:
        pytest.skip("Need a profile fixture.")
    run_id, other_article_instance_id, field_id, _ = fx

    with pytest.raises(CoordinateMismatchError):
        await assert_coords_coherent(
            db_session,
            run_id=run_id,
            instance_id=other_article_instance_id,
            field_id=field_id,
        )
    await db_session.rollback()
