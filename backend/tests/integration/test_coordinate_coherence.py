"""Integration tests for coordinate_coherence helper."""

from uuid import uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.coordinate_coherence import (
    CoordinateMismatchError,
    assert_coords_coherent,
)
from app.services.run_lifecycle_service import RunLifecycleService


async def _coherent_triplet(db: AsyncSession):
    project_id = (await db.execute(text("SELECT id FROM public.projects LIMIT 1"))).scalar()
    article_id = (await db.execute(text("SELECT id FROM public.articles LIMIT 1"))).scalar()
    template_id = (await db.execute(text("SELECT id FROM public.project_extraction_templates LIMIT 1"))).scalar()
    profile_id = (await db.execute(text("SELECT id FROM public.profiles LIMIT 1"))).scalar()
    if not all((project_id, article_id, template_id, profile_id)):
        return None
    # Pick instance and field that match the same template.
    row = await db.execute(text("""
        SELECT i.id, f.id
        FROM public.extraction_instances i
        JOIN public.extraction_entity_types et ON et.id = i.entity_type_id
        JOIN public.extraction_fields f ON f.entity_type_id = et.id
        WHERE i.template_id = :tid
        LIMIT 1
    """), {"tid": template_id})
    pair = row.first()
    if pair is None:
        return None
    instance_id, field_id = pair

    lifecycle = RunLifecycleService(db)
    run = await lifecycle.create_run(
        project_id=project_id,
        article_id=article_id,
        project_template_id=template_id,
        user_id=profile_id,
    )
    return run.id, instance_id, field_id


@pytest.mark.asyncio
async def test_coherent_triplet_passes(db_session: AsyncSession) -> None:
    fx = await _coherent_triplet(db_session)
    if fx is None:
        pytest.skip("Need fixtures.")
    run_id, instance_id, field_id = fx
    # Should not raise
    await assert_coords_coherent(db_session, run_id=run_id, instance_id=instance_id, field_id=field_id)
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
    other_field_row = await db_session.execute(text("""
        SELECT f.id FROM public.extraction_fields f
        WHERE f.entity_type_id <> (
            SELECT entity_type_id FROM public.extraction_instances WHERE id = :iid
        )
        LIMIT 1
    """), {"iid": instance_id})
    other_field_id = other_field_row.scalar()
    if other_field_id is None:
        pytest.skip("Need >=2 entity_types with fields.")
    with pytest.raises(CoordinateMismatchError):
        await assert_coords_coherent(
            db_session, run_id=run_id, instance_id=instance_id, field_id=other_field_id
        )
    await db_session.rollback()
