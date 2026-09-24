"""The FTS index migration 0080 (spec §5.1): `search_project_text` matches
with exactly `to_tsvector('simple', text) @@ websearch_to_tsquery('simple',
:q)`, so an expression GIN index on the same expression keeps it off a
sequential scan."""

from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


async def test_fts_index_exists_with_exact_expression(db_session: AsyncSession) -> None:
    indexdef = (
        await db_session.execute(
            text(
                "SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' "
                "AND indexname = 'idx_article_text_blocks_fts'"
            )
        )
    ).scalar_one()
    assert "gin" in indexdef.lower()
    assert "to_tsvector('simple'::regconfig, text)" in indexdef


async def test_fts_query_uses_index(db_session: AsyncSession) -> None:
    await db_session.execute(text("SET LOCAL enable_seqscan = off"))
    plan = "\n".join(
        r[0]
        for r in await db_session.execute(
            text(
                "EXPLAIN SELECT id FROM public.article_text_blocks "
                "WHERE to_tsvector('simple', text) @@ websearch_to_tsquery('simple', 'cohort')"
            )
        )
    )
    assert "idx_article_text_blocks_fts" in plan
