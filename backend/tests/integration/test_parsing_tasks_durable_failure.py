"""Durable parse_failed: a terminal failure must survive in its own txn."""

from uuid import UUID

import pytest
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.article import Article, ArticleFile
from app.worker._session import worker_session
from app.worker.tasks.parsing_tasks import _mark_parse_failed


async def _seed_pending_file(db: AsyncSession) -> UUID:
    """Insert an article + a pending PDF file under a seeded project."""
    project_id = (
        await db.execute(
            text(
                "SELECT p.id FROM public.projects p WHERE EXISTS (SELECT 1 FROM public.project_extraction_templates t JOIN public.extraction_entity_types et ON et.project_template_id = t.id JOIN public.extraction_fields f ON f.entity_type_id = et.id JOIN public.extraction_instances i ON i.template_id = t.id WHERE t.project_id = p.id) ORDER BY p.id LIMIT 1"
            )
        )
    ).scalar_one_or_none()
    if project_id is None:
        pytest.skip("Need at least one seeded project")
    article = Article(project_id=project_id, title="durable-fail-test")
    db.add(article)
    await db.flush()
    file = ArticleFile(
        project_id=project_id,
        article_id=article.id,
        file_type="PDF",
        storage_key=f"{project_id}/{article.id}/x.pdf",
        extraction_status="pending",
    )
    db.add(file)
    await db.commit()
    return file.id


@pytest.mark.asyncio
async def test_mark_parse_failed_persists_in_its_own_transaction(
    db_session_real: AsyncSession,
) -> None:
    file_id = await _seed_pending_file(db_session_real)

    await _mark_parse_failed(str(file_id), "boom: parser exploded")

    # Read back via a brand-new session to prove the write was committed.
    async with worker_session() as verify:
        row = (
            await verify.execute(select(ArticleFile).where(ArticleFile.id == file_id))
        ).scalar_one()
        assert row.extraction_status == "parse_failed"
        assert "boom" in (row.extraction_error or "")
