"""Integration tests for the article-file ingest/recovery endpoints."""

from collections.abc import AsyncGenerator
from unittest.mock import patch
from uuid import UUID, uuid4

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import TokenPayload, get_current_user
from app.main import app
from app.models.article import Article, ArticleFile


@pytest_asyncio.fixture
async def member_article(
    db_session: AsyncSession,
) -> AsyncGenerator[tuple[UUID, UUID, UUID], None]:
    """Yield (project_id, member_user_id, article_id); JWT override = member."""
    row = (
        await db_session.execute(
            text("SELECT pm.project_id, pm.user_id FROM public.project_members pm LIMIT 1")
        )
    ).first()
    if row is None:
        pytest.skip("Need a seeded project member")
    project_id, member_id = UUID(str(row[0])), UUID(str(row[1]))
    article = Article(project_id=project_id, title="confirm-upload-test")
    db_session.add(article)
    await db_session.commit()

    async def _override() -> TokenPayload:
        return TokenPayload(sub=str(member_id), email="m@x.com", role="authenticated", aal="aal1")

    app.dependency_overrides[get_current_user] = _override
    try:
        yield project_id, member_id, article.id
    finally:
        app.dependency_overrides.pop(get_current_user, None)


def _body(project_id: UUID, article_id: UUID, key: str | None = None) -> dict:
    return {
        "articleId": str(article_id),
        "storageKey": key or f"{project_id}/{article_id}/doc.pdf",
        "originalFilename": "doc.pdf",
        "contentType": "PDF",
        "bytes": 1234,
        "fileRole": "MAIN",
    }


@pytest.mark.asyncio
async def test_confirm_creates_row_and_enqueues(
    db_client: AsyncClient, db_session: AsyncSession, member_article
) -> None:
    project_id, _, article_id = member_article
    with patch(
        "app.api.v1.endpoints.article_files.ArticleFileIngestService.enqueue_parse_at_ingest",
        return_value="task-123",
    ) as enq:
        res = await db_client.post(
            f"/api/v1/articles/{article_id}/files", json=_body(project_id, article_id)
        )
    assert res.status_code == 201, res.text
    assert res.json()["data"]["extractionStatus"] == "pending"
    enq.assert_called_once()
    row = (
        await db_session.execute(select(ArticleFile).where(ArticleFile.article_id == article_id))
    ).scalar_one()
    assert row.storage_key == f"{project_id}/{article_id}/doc.pdf"


@pytest.mark.asyncio
async def test_confirm_rejects_non_member(db_client: AsyncClient, member_article) -> None:
    project_id, _, article_id = member_article

    async def _outsider() -> TokenPayload:
        return TokenPayload(sub=str(uuid4()), email="o@x.com", role="authenticated", aal="aal1")

    app.dependency_overrides[get_current_user] = _outsider
    res = await db_client.post(
        f"/api/v1/articles/{article_id}/files", json=_body(project_id, article_id)
    )
    assert res.status_code == 403, res.text


@pytest.mark.asyncio
async def test_confirm_rejects_foreign_storage_key(db_client: AsyncClient, member_article) -> None:
    project_id, _, article_id = member_article
    bad = _body(project_id, article_id, key=f"{uuid4()}/{uuid4()}/evil.pdf")
    res = await db_client.post(f"/api/v1/articles/{article_id}/files", json=bad)
    assert res.status_code == 400, res.text


@pytest.mark.asyncio
async def test_confirm_does_not_swallow_enqueue_failure(
    db_client: AsyncClient, db_session: AsyncSession, member_article
) -> None:
    project_id, _, article_id = member_article
    with patch(
        "app.api.v1.endpoints.article_files.ArticleFileIngestService.enqueue_parse_at_ingest",
        side_effect=RuntimeError("broker down"),
    ):
        res = await db_client.post(
            f"/api/v1/articles/{article_id}/files", json=_body(project_id, article_id)
        )
    assert res.status_code == 503, res.text
    row = (
        await db_session.execute(select(ArticleFile).where(ArticleFile.article_id == article_id))
    ).scalar_one()
    await db_session.refresh(row)
    assert row.extraction_status == "parse_failed"
