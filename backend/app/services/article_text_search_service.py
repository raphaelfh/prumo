"""Project-scoped full-text search over article text (spec §5.1, task 7b).

Uses the `simple` text-search config, not `pg_trgm`: `simple` ranks matches
by term frequency/position via `ts_rank` (`pg_trgm` only measures character
trigram similarity, which ranks worse for keyword search) and reuses the
same GIN index shape that already backs the exact match expression
(migration 0080), where `pg_trgm` would need a second, larger index.

Two statements: the first finds a page of matching block ids ranked by
`(ts_rank desc, block id)` with `project_id` in the WHERE clause (the
ownership guard for this table has no dedicated helper -- scoping the raw
query IS the guard, spec §5.1); the second runs `ts_headline` only on that
page's rows, so headline generation (expensive per spec's own note) never
runs over an unbounded result set.
"""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.mcp.untrusted import wrap_untrusted
from app.schemas.mcp_search import McpSearchHit, McpSearchResult
from app.utils.opaque_cursor import decode_cursor, encode_cursor

_PAGE_SIZE = 20
_SNIPPET_CAP = 400
_NO_HITS_NOTE = (
    "No hits. The search does not stem or strip accents: try variant spellings "
    "(plural, pt/en, accented)."
)

_PAGE_QUERY_TEMPLATE = """
SELECT b.id, b.article_file_id, f.article_id, b.page_number, b.block_index, b.block_type,
       ts_rank(to_tsvector('simple', b.text), q) AS rank
FROM public.article_text_blocks b
JOIN public.article_files f ON f.id = b.article_file_id,
     websearch_to_tsquery('simple', :q) q
WHERE f.project_id = :pid
  AND to_tsvector('simple', b.text) @@ q
  {article_filter}
  {cursor_filter}
ORDER BY rank DESC, b.id
LIMIT :limit_plus_one
"""

_HEADLINE_QUERY = text(
    "SELECT b.id, a.title, "
    "ts_headline('simple', b.text, websearch_to_tsquery('simple', :q), "
    "'MaxWords=35, MinWords=15, MaxFragments=1') AS headline "
    "FROM public.article_text_blocks b "
    "JOIN public.article_files f ON f.id = b.article_file_id "
    "JOIN public.articles a ON a.id = f.article_id "
    "WHERE b.id = ANY(CAST(:ids AS uuid[])) AND f.project_id = :pid"
)


async def search_project_text(
    db: AsyncSession,
    *,
    project_id: UUID,
    query: str,
    article_id: UUID | None = None,
    cursor: str | None = None,
    limit: int = _PAGE_SIZE,
) -> McpSearchResult:
    decoded = decode_cursor(cursor, arity=2)

    params: dict[str, object] = {
        "q": query,
        "pid": str(project_id),
        "limit_plus_one": limit + 1,
    }
    article_filter = ""
    if article_id is not None:
        article_filter = "AND f.article_id = :aid"
        params["aid"] = str(article_id)

    cursor_filter = ""
    if decoded is not None:
        rank_value, block_id_value = decoded
        cursor_filter = (
            "AND (ts_rank(to_tsvector('simple', b.text), q) < CAST(CAST(:rank AS text) AS real) "
            "OR (ts_rank(to_tsvector('simple', b.text), q) = CAST(CAST(:rank AS text) AS real) "
            "AND b.id > CAST(:bid AS uuid)))"
        )
        params["rank"] = str(rank_value)
        params["bid"] = str(block_id_value)

    page_query = text(
        _PAGE_QUERY_TEMPLATE.format(article_filter=article_filter, cursor_filter=cursor_filter)
    )
    rows = (await db.execute(page_query, params)).all()

    has_more = len(rows) > limit
    page_rows = rows[:limit]

    if not page_rows:
        return McpSearchResult(hits=[], next_cursor=None, note=_NO_HITS_NOTE)

    next_cursor: str | None = None
    if has_more:
        last = page_rows[-1]
        next_cursor = encode_cursor([repr(last.rank), str(last.id)])

    headline_rows = (
        await db.execute(
            _HEADLINE_QUERY,
            {"q": query, "ids": [str(row.id) for row in page_rows], "pid": str(project_id)},
        )
    ).all()
    headline_by_id = {row.id: (row.title, row.headline) for row in headline_rows}

    hits = [
        McpSearchHit(
            article_id=row.article_id,
            title=headline_by_id[row.id][0],
            article_file_id=row.article_file_id,
            page=row.page_number,
            block_id=row.id,
            block_index=row.block_index,
            block_type=row.block_type,
            locator=f"p{row.page_number}·b{row.block_index}",
            snippet=wrap_untrusted(headline_by_id[row.id][1][:_SNIPPET_CAP]),
        )
        for row in page_rows
    ]

    return McpSearchResult(hits=hits, next_cursor=next_cursor, note=None)
