"""Integration: article identity — project-scoped "Surname Year" labels (§6, D2)
and the resolved descriptor's doi/pmid/template_version/keyed labels."""

from __future__ import annotations

import json
from datetime import UTC, datetime
from uuid import UUID, uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction import ExtractionCardinality
from app.services.extraction_export_service import ExportMode, ExtractionExportService
from tests.integration.conftest import SEED
from tests.integration.test_extraction_export_many_cardinality_fanout import (
    seeded_export_fixture,
)

pytestmark = pytest.mark.asyncio


async def _insert_article(db: AsyncSession, *, created_at: datetime) -> UUID:
    aid = uuid4()
    await db.execute(
        text(
            "INSERT INTO public.articles "
            "(id, project_id, title, row_version, authors, publication_year, created_at) "
            "VALUES (:id, :pid, :title, 1, :authors, 2020, :created_at)"
        ),
        {
            "id": str(aid),
            "pid": str(SEED.secondary_project),
            "title": f"Identity {aid.hex[:8]}",
            "authors": ["Zyxsmith, A"],
            "created_at": created_at,
        },
    )
    return aid


async def test_surname_year_labels_never_change_once_they_appear(
    db_session: AsyncSession,
) -> None:  # D2
    svc = ExtractionExportService(db=db_session, user_id=str(SEED.primary_profile))
    a = await _insert_article(db_session, created_at=datetime(2001, 1, 1, tzinfo=UTC))

    refs = await svc._load_article_refs(project_id=SEED.secondary_project)
    assert refs[a].label == "Zyxsmith 2020"

    b = await _insert_article(db_session, created_at=datetime(2001, 1, 2, tzinfo=UTC))
    c = await _insert_article(db_session, created_at=datetime(2001, 1, 3, tzinfo=UTC))
    refs = await svc._load_article_refs(project_id=SEED.secondary_project)
    assert (refs[a].label, refs[b].label, refs[c].label) == (
        "Zyxsmith 2020",
        "Zyxsmith 2020b",
        "Zyxsmith 2020c",
    )
    assert SEED.primary_article not in refs  # project_id in WHERE


async def test_resolved_article_carries_label_refs_version_and_keyed_label(
    db_session: AsyncSession,
) -> None:
    ctx = await seeded_export_fixture(
        db_session, section_cardinality=ExtractionCardinality.MANY, instance_count=2
    )
    keyed, unkeyed = ctx.ordered_instance_ids
    await db_session.execute(
        text(
            "UPDATE public.extraction_instances SET label = '  XGBoost ', "
            "metadata = CAST(:meta AS jsonb) WHERE id = :id"
        ),
        {"id": str(keyed), "meta": json.dumps({"entity_key": "xgboost"})},
    )
    await db_session.execute(
        text("UPDATE public.articles SET doi = '10.1/x', pmid = '123' WHERE id = :id"),
        {"id": str(ctx.article_id)},
    )

    layout = await ctx.service.resolve_layout(
        project_id=ctx.project_id,
        template_id=ctx.template_id,
        mode=ExportMode.CONSENSUS,
        article_ids=[ctx.article_id],
        include_ai_metadata=False,
        anonymize_reviewer_names=False,
    )

    (art,) = layout.articles
    assert art.keyed_labels == {keyed: "XGBoost"}
    assert unkeyed not in art.keyed_labels
    assert (art.doi, art.pmid) == ("10.1/x", "123")
    assert art.article_label == "Integration Test Article"
    assert (
        art.template_version
        == (
            await db_session.execute(
                text("SELECT version FROM public.extraction_template_versions WHERE id = :v"),
                {"v": str(ctx.version_id)},
            )
        ).scalar_one()
    )
