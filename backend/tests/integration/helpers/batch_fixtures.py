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


async def make_agent_batch(
    db: AsyncSession,
    *,
    owner_id: UUID,
    project_id: UUID,
    template_id: UUID,
    token_id: UUID | None,
    count: int = 2,
    **fields: Any,
) -> UUID:
    """A batch with ``count`` queued articles; agent-started (``token_id``) or UI (``None``)."""
    articles = [await make_article(db, project_id, f"agent {i}") for i in range(count)]
    agent = (
        {}
        if token_id is None
        else {
            "agent_token_id": str(token_id),
            "agent_engine": (
                '{"provider": "openai", "model": "m", "mode": "fast", "connection_id": null}'
            ),
            "agent_plan_digest": uuid4().hex,
        }
    )
    return await make_batch(
        db,
        owner_id=owner_id,
        project_id=project_id,
        template_id=template_id,
        article_ids=articles,
        **agent,
        **fields,
    )


async def batch_halt(
    db: AsyncSession, batch_id: UUID
) -> tuple[str | None, list[tuple[str, str | None]]]:
    """(stop_code, [(item status, reason_code)]) of ``batch_id``."""
    stop_code = (
        await db.execute(
            text("SELECT stop_code FROM public.extraction_batches WHERE id = :b"),
            {"b": str(batch_id)},
        )
    ).scalar_one()
    items = (
        await db.execute(
            text(
                "SELECT status, reason_code FROM public.extraction_batch_items "
                "WHERE batch_id = :b ORDER BY created_at, id"
            ),
            {"b": str(batch_id)},
        )
    ).all()
    return stop_code, [(r[0], r[1]) for r in items]
