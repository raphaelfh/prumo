"""0076: batch tables are backend-only and never block a delete (spec §6, G17)."""

from __future__ import annotations

from uuid import UUID, uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession

from tests.integration.conftest import SEED
from tests.integration.helpers.batch_fixtures import make_article
from tests.integration.helpers.template_fixtures import fresh_charms


async def _batch_with_item(
    db: AsyncSession, *, project_id: UUID, template_id: UUID, article_id: UUID
) -> tuple[UUID, UUID]:
    batch_id, item_id = uuid4(), uuid4()
    await db.execute(
        text(
            "INSERT INTO public.extraction_batches (id, owner_id, project_id, template_id) "
            "VALUES (:id, :owner, :pid, :tid)"
        ),
        {
            "id": str(batch_id),
            "owner": str(SEED.primary_profile),
            "pid": str(project_id),
            "tid": str(template_id),
        },
    )
    await db.execute(
        text(
            "INSERT INTO public.extraction_batch_items (id, batch_id, article_id) "
            "VALUES (:id, :bid, :aid)"
        ),
        {"id": str(item_id), "bid": str(batch_id), "aid": str(article_id)},
    )
    return batch_id, item_id


async def _exists(db: AsyncSession, table: str, row_id: UUID) -> bool:
    return (
        await db.execute(text(f"SELECT 1 FROM public.{table} WHERE id = :id"), {"id": str(row_id)})
    ).first() is not None


@pytest.mark.asyncio
async def test_item_status_defaults_to_queued_and_is_checked(db_session: AsyncSession) -> None:
    article_id = await make_article(db_session, SEED.primary_project)
    _, item_id = await _batch_with_item(
        db_session,
        project_id=SEED.primary_project,
        template_id=SEED.primary_template,
        article_id=article_id,
    )
    status = (
        await db_session.execute(
            text("SELECT status FROM public.extraction_batch_items WHERE id = :id"),
            {"id": str(item_id)},
        )
    ).scalar_one()
    assert status == "queued"
    with pytest.raises(DBAPIError):
        async with db_session.begin_nested():
            await db_session.execute(
                text("UPDATE public.extraction_batch_items SET status = 'running' WHERE id = :id"),
                {"id": str(item_id)},
            )


@pytest.mark.asyncio
async def test_one_item_per_article_per_batch(db_session: AsyncSession) -> None:
    article_id = await make_article(db_session, SEED.primary_project)
    batch_id, _ = await _batch_with_item(
        db_session,
        project_id=SEED.primary_project,
        template_id=SEED.primary_template,
        article_id=article_id,
    )
    with pytest.raises(DBAPIError):
        async with db_session.begin_nested():
            await db_session.execute(
                text(
                    "INSERT INTO public.extraction_batch_items (batch_id, article_id) VALUES (:b, :a)"
                ),
                {"b": str(batch_id), "a": str(article_id)},
            )


@pytest.mark.asyncio
async def test_deleting_the_article_removes_its_item(db_session: AsyncSession) -> None:
    article_id = await make_article(db_session, SEED.primary_project)
    batch_id, item_id = await _batch_with_item(
        db_session,
        project_id=SEED.primary_project,
        template_id=SEED.primary_template,
        article_id=article_id,
    )
    await db_session.execute(
        text("DELETE FROM public.articles WHERE id = :id"), {"id": str(article_id)}
    )
    assert not await _exists(db_session, "extraction_batch_items", item_id)
    assert await _exists(db_session, "extraction_batches", batch_id)


@pytest.mark.asyncio
async def test_deleting_the_project_removes_the_batch(db_session: AsyncSession) -> None:
    project_id, template_id, _ = await fresh_charms(db_session)
    article_id = await make_article(db_session, project_id)
    batch_id, item_id = await _batch_with_item(
        db_session, project_id=project_id, template_id=template_id, article_id=article_id
    )
    await db_session.execute(
        text("DELETE FROM public.projects WHERE id = :id"), {"id": str(project_id)}
    )
    assert not await _exists(db_session, "extraction_batches", batch_id)
    assert not await _exists(db_session, "extraction_batch_items", item_id)


@pytest.mark.asyncio
@pytest.mark.parametrize("role", ["anon", "authenticated"])
@pytest.mark.parametrize("table", ["extraction_batches", "extraction_batch_items"])
async def test_client_roles_cannot_read_batch_tables(
    db_session: AsyncSession, role: str, table: str
) -> None:
    with pytest.raises(DBAPIError, match="permission denied"):
        async with db_session.begin_nested():
            await db_session.execute(text(f"SET LOCAL ROLE {role}"))
            await db_session.execute(text(f"SELECT 1 FROM public.{table} LIMIT 1"))
