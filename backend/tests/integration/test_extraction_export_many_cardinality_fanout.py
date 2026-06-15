"""Integration: many-cardinality sections fan out (no instance collapse).

Regression for the §6 ``study_instances.setdefault`` collapse: a study-role
entity_type with ``cardinality='many'`` materializes N instances per article,
but the resolver kept only the first and silently dropped the other N-1.
``ArticleDescriptor.section_instances`` must now carry the FULL ordered list
(by ``sort_order``) for every entity_type.

The descriptor resolvers read runs + instances + the entity_type role map;
they do not require published values. We therefore seed a FINALIZED run and N
ascending-``sort_order`` instances directly (raw SQL), scoped to the seed
project, and roll the transaction back at the end.
"""

from __future__ import annotations

from dataclasses import dataclass
from unittest.mock import MagicMock
from uuid import UUID, uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction import ExtractionCardinality, ExtractionEntityRole
from app.services.extraction_export_service import ExtractionExportService
from tests.integration.conftest import SEED

pytestmark = pytest.mark.asyncio


@dataclass(frozen=True)
class _ExportFixtureCtx:
    """Handles a test needs to drive the descriptor resolvers."""

    service: ExtractionExportService
    template_id: UUID
    project_id: UUID
    article_id: UUID
    many_entity_type_id: UUID
    ordered_instance_ids: list[UUID]


async def seeded_export_fixture(
    db: AsyncSession,
    *,
    section_role: ExtractionEntityRole,
    section_cardinality: ExtractionCardinality,
    instance_count: int,
) -> _ExportFixtureCtx:
    """Build a ``cardinality``-parametrized section + N instances + a
    FINALIZED run under the seeded project/template, all scoped by
    ``project_id``. Returns the context the descriptor assertions need.

    Reuses the autouse ``SEED`` graph's project/user/article/template/
    version so we only add the entity_type + instances + run for this test.
    The closing ``db.rollback()`` (caller's responsibility) drops them.
    """
    project_id = SEED.primary_project
    article_id = SEED.primary_article
    template_id = SEED.primary_template
    profile_id = SEED.primary_profile

    # Active version id for the seeded template — the run's NOT NULL
    # ``version_id`` FK. Scope by the seed template (it owns exactly one
    # active version from the conftest seed).
    version_id = (
        await db.execute(
            text(
                "SELECT id FROM public.extraction_template_versions "
                "WHERE project_template_id = :tid AND is_active = true "
                "LIMIT 1"
            ),
            {"tid": str(template_id)},
        )
    ).scalar()
    assert version_id is not None, "Seed template has no active version."

    # A fresh study-role entity_type with the requested cardinality. The
    # ``ck_extraction_entity_types_role_parent`` CHECK allows study_section
    # (and model_container) roots with no parent; nothing couples
    # study_section to cardinality='one', so 'many' is valid here.
    many_entity_type_id = uuid4()
    await db.execute(
        text(
            "INSERT INTO public.extraction_entity_types "
            "(id, project_template_id, name, label, cardinality, role, "
            " parent_entity_type_id, sort_order, is_required) "
            "VALUES (:id, :tid, :name, :label, :card, :role, NULL, 1, false)"
        ),
        {
            "id": str(many_entity_type_id),
            "tid": str(template_id),
            "name": f"arms_{many_entity_type_id.hex[:8]}",
            "label": "Treatment Arms",
            "card": section_cardinality.value,
            "role": section_role.value,
        },
    )

    # N instances for one article, ascending sort_order. For
    # cardinality='many' the instance-cardinality trigger short-circuits
    # (it only enforces 'one'), so all N rows persist.
    ordered_instance_ids: list[UUID] = []
    for sort_order in range(instance_count):
        instance_id = uuid4()
        ordered_instance_ids.append(instance_id)
        await db.execute(
            text(
                "INSERT INTO public.extraction_instances "
                "(id, project_id, template_id, entity_type_id, article_id, "
                " label, sort_order, status, created_by) "
                "VALUES (:id, :pid, :tid, :etid, :aid, :label, :so, "
                " 'pending', :created_by)"
            ),
            {
                "id": str(instance_id),
                "pid": str(project_id),
                "tid": str(template_id),
                "etid": str(many_entity_type_id),
                "aid": str(article_id),
                "label": f"Arm {sort_order + 1}",
                "so": sort_order,
                "created_by": str(profile_id),
            },
        )

    # A FINALIZED extraction run owns this article on this template. Drop
    # any leaked runs first (the surrounding suite commits runs in other
    # stages against the sentinel article+template).
    await db.execute(
        text(
            "DELETE FROM public.extraction_runs WHERE project_id = :pid "
            "AND article_id = :aid AND template_id = :tid"
        ),
        {"pid": str(project_id), "aid": str(article_id), "tid": str(template_id)},
    )
    await db.execute(
        text(
            "INSERT INTO public.extraction_runs "
            "(id, project_id, article_id, template_id, kind, version_id, "
            " stage, status, created_by) "
            "VALUES (gen_random_uuid(), :pid, :aid, :tid, 'extraction', "
            " :vid, 'finalized', 'completed', :created_by)"
        ),
        {
            "pid": str(project_id),
            "aid": str(article_id),
            "tid": str(template_id),
            "vid": str(version_id),
            "created_by": str(profile_id),
        },
    )

    service = ExtractionExportService(
        db=db,
        user_id=str(profile_id),
        storage=MagicMock(),
    )
    return _ExportFixtureCtx(
        service=service,
        template_id=template_id,
        project_id=project_id,
        article_id=article_id,
        many_entity_type_id=many_entity_type_id,
        ordered_instance_ids=ordered_instance_ids,
    )


async def test_many_cardinality_section_keeps_all_instances(
    db_session: AsyncSession,
) -> None:
    """A cardinality='many' study-role section must surface ALL its
    instances in ArticleDescriptor.section_instances (was collapsed to 1)."""
    if (
        await db_session.execute(
            text("SELECT 1 FROM public.profiles WHERE id = :id"),
            {"id": str(SEED.primary_profile)},
        )
    ).scalar() is None:
        pytest.skip("Missing fixtures.")

    ctx = await seeded_export_fixture(
        db_session,
        section_role=ExtractionEntityRole.STUDY_SECTION,
        section_cardinality=ExtractionCardinality.MANY,
        instance_count=3,
    )
    service = ctx.service
    descriptors, _omitted = await service._resolve_articles_for_consensus(
        template_id=ctx.template_id,
        project_id=ctx.project_id,
        candidate_ids=[ctx.article_id],
    )
    assert len(descriptors) == 1
    section_instances = descriptors[0].section_instances[ctx.many_entity_type_id]
    # All 3 instances preserved, in sort_order — NOT collapsed to 1.
    assert list(section_instances) == ctx.ordered_instance_ids
    assert len(section_instances) == 3

    await db_session.rollback()
