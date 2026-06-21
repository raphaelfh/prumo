"""Integration: snapshot section reader against real local Supabase (spec §5.1)."""

from __future__ import annotations

from uuid import UUID

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction import ExtractionEntityRole
from app.repositories.extraction_template_version_repository import (
    ExtractionTemplateVersionRepository,
)
from app.services.exports.extraction_snapshot_reader import load_export_sections


async def _seeded_template_id(db: AsyncSession) -> UUID:
    project_id = (
        await db.execute(
            text(
                "SELECT p.id FROM public.projects p WHERE EXISTS (SELECT 1 FROM public.project_extraction_templates t JOIN public.extraction_entity_types et ON et.project_template_id = t.id JOIN public.extraction_fields f ON f.entity_type_id = et.id JOIN public.extraction_instances i ON i.template_id = t.id WHERE t.project_id = p.id) ORDER BY p.id LIMIT 1"
            )
        )
    ).scalar()
    template_id = (
        await db.execute(
            text(
                "SELECT id FROM public.project_extraction_templates "
                "WHERE kind = 'extraction' AND project_id = :pid LIMIT 1"
            ),
            {"pid": project_id},
        )
    ).scalar()
    if template_id is None:
        pytest.skip("No seeded extraction template")
    return UUID(str(template_id))


@pytest.mark.asyncio
async def test_load_export_sections_reads_active_version_snapshot(
    db_session: AsyncSession,
) -> None:
    template_id = await _seeded_template_id(db_session)
    version = await ExtractionTemplateVersionRepository(db_session).get_active(template_id)
    assert version is not None, "seeded template must have an active version"

    sections = await load_export_sections(db_session, version_id=version.id)

    assert sections, "active version snapshot must yield sections"
    # Ordered by sort_order, ascending.
    orders = [s.sort_order for s in sections]
    assert orders == sorted(orders)
    # Every section carries a real role + cardinality from the snapshot.
    for s in sections:
        assert isinstance(s.role, ExtractionEntityRole)
        assert s.cardinality is not None
    # At least one study section exists in the seeded CHARMS template.
    assert any(s.role is ExtractionEntityRole.STUDY_SECTION for s in sections)
    # Field metadata threads through (label + field_id present on every field).
    a_field = next((f for s in sections for f in s.fields), None)
    assert a_field is not None
    assert a_field.label


@pytest.mark.asyncio
async def test_obsolete_field_reported_when_run_pinned_to_older_version(
    db_session: AsyncSession,
) -> None:
    from uuid import uuid4

    from app.models.extraction_versioning import ExtractionTemplateVersion
    from app.services.extraction_export_service import (
        ArticleDescriptor,
        ExtractionExportService,
    )

    template_id = await _seeded_template_id(db_session)
    project_id = (
        await db_session.execute(
            text("SELECT project_id FROM public.project_extraction_templates WHERE id = :tid"),
            {"tid": str(template_id)},
        )
    ).scalar()
    article_id = (
        await db_session.execute(
            text("SELECT id FROM public.articles WHERE project_id = :pid LIMIT 1"),
            {"pid": project_id},
        )
    ).scalar()
    if article_id is None:
        pytest.skip("No seeded article in project")
    published_by = (
        await db_session.execute(
            text(
                "SELECT pm.user_id FROM public.project_members pm WHERE pm.role = 'manager' AND EXISTS (SELECT 1 FROM public.project_extraction_templates t JOIN public.extraction_entity_types et ON et.project_template_id = t.id JOIN public.extraction_fields f ON f.entity_type_id = et.id JOIN public.extraction_instances i ON i.template_id = t.id WHERE t.project_id = pm.project_id) ORDER BY pm.user_id LIMIT 1"
            )
        )
    ).scalar()
    assert published_by is not None, "seed graph must carry at least one profile"

    kept_fid = str(uuid4())
    removed_fid = str(uuid4())
    et_id = str(uuid4())

    def _et(fields: list[dict]) -> dict:
        return {
            "id": et_id,
            "name": "s",
            "label": "S",
            "description": None,
            "parent_entity_type_id": None,
            "cardinality": "one",
            "role": "study_section",
            "sort_order": 0,
            "is_required": False,
            "fields": fields,
        }

    def _f(fid: str, label: str) -> dict:
        return {
            "id": fid,
            "name": label.lower(),
            "label": label,
            "description": None,
            "field_type": "text",
            "is_required": False,
            "allowed_values": None,
            "unit": None,
            "sort_order": 0,
            "llm_description": None,
            "allow_other": False,
        }

    older = ExtractionTemplateVersion(
        project_template_id=UUID(str(template_id)),
        version=9001,
        schema_={"entity_types": [_et([_f(kept_fid, "Kept"), _f(removed_fid, "Dropped")])]},
        is_active=False,
        published_by=published_by,
    )
    db_session.add(older)
    await db_session.flush()

    article = ArticleDescriptor(
        article_id=UUID(str(article_id)),
        header_label="Gaca, 2011",
        run_id=uuid4(),
        run_stage=None,
        version_id=older.id,
        model_instances=(),
        section_instances={},
    )
    svc = ExtractionExportService(
        db=db_session,
        user_id=str(uuid4()),
        storage=None,  # type: ignore[arg-type]
    )
    out = await svc._compute_obsolete_fields_per_article(
        articles=(article,),
        anchor_field_ids={UUID(kept_fid)},  # anchor has only the kept field
    )
    assert out == {UUID(str(article_id)): ["Dropped"]}
