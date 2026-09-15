"""Shared setup for the extraction batch suites (rows written in the test SAVEPOINT)."""

from __future__ import annotations

from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


async def make_article(db: AsyncSession, project_id: UUID, title: str = "batch article") -> UUID:
    article_id = uuid4()
    await db.execute(
        text(
            "INSERT INTO public.articles (id, project_id, title, row_version) VALUES (:id, :pid, :t, 1)"
        ),
        {"id": str(article_id), "pid": str(project_id), "t": title},
    )
    return article_id


async def make_batch(
    db: AsyncSession,
    *,
    owner_id: UUID,
    project_id: UUID,
    template_id: UUID,
    article_ids: list[UUID],
    **fields: Any,
) -> UUID:
    batch_id = uuid4()
    columns = {
        "id": str(batch_id),
        "owner_id": str(owner_id),
        "project_id": str(project_id),
        "template_id": str(template_id),
        **fields,
    }
    await db.execute(
        text(
            f"INSERT INTO public.extraction_batches ({', '.join(columns)}) "
            f"VALUES ({', '.join(':' + c for c in columns)})"
        ),
        columns,
    )
    for offset, article_id in enumerate(article_ids):
        await db.execute(
            text(
                "INSERT INTO public.extraction_batch_items (id, batch_id, article_id, created_at) "
                "VALUES (:i, :b, :a, now() + make_interval(secs => :o))"
            ),
            {"i": str(uuid4()), "b": str(batch_id), "a": str(article_id), "o": offset},
        )
    return batch_id
