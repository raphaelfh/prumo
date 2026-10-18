"""Project-scoped full-text search over article text (spec §5.1, task 7b).

Uses the `simple` text-search config, not `pg_trgm`: `simple` ranks matches
by term frequency/position via `ts_rank` (`pg_trgm` only measures character
trigram similarity, which ranks worse for keyword search) and reuses the
same GIN index shape that already backs the exact match expression
(migration 0080), where `pg_trgm` would need a second, larger index.

Two statements per page: the first finds a page of matching block ids (block
mode) or articles (article mode) with `project_id` in the WHERE clause (the
ownership guard for this table has no dedicated helper -- scoping the raw
query IS the guard, spec §5.1); the second runs `ts_headline` only on that
page's rows, so headline generation (expensive per spec's own note) never
runs over an unbounded result set.

Candidate blocks share one filter set in both modes: an optional article,
optional block types and, by default, no block whose nearest preceding
heading in the same file is a references heading (a later heading such as
an appendix ends that span).
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any, Literal
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.schemas.mcp_search import (
    BlockTypeLiteral,
    McpSearchArticle,
    McpSearchHit,
    McpSearchLocator,
    McpSearchResult,
)
from app.utils.compact_json import compact_json
from app.utils.opaque_cursor import cursor_rank, cursor_uuid, decode_cursor, encode_cursor
from app.utils.text_caps import cap_text

_PAGE_SIZE = 20
_SNIPPET_CAP = 400
_TOP_LOCATORS = 3
#: The 32,000-char result cap less the envelope (`next_cursor`, `note`, keys).
_HITS_BUDGET = 31_500
_NO_HITS_NOTE = (
    'No hits for "{query}". The search does not stem or strip accents: try variant '
    "spellings (plural, pt/en, accented)."
)
_ALL_IN_REFERENCES_NOTE = (
    "Every hit is inside a references section; retry with exclude_references=false."
)
#: A references heading, optionally numbered ("7. References"); matched `~*`.
_REFERENCES_HEADING_RE = (
    r"^\s*([0-9]+(\.[0-9]+)*\.?\s*)?"
    r"(references|bibliography|literature cited|referências|bibliografia)\s*$"
)


class EmptySearchQueryError(ValueError):
    """The query is blank or its tsquery has no searchable term."""


_TERM_COUNT_QUERY = text("SELECT numnode(websearch_to_tsquery('simple', :q))")

_RANK = "ts_rank(to_tsvector('simple', b.text), q)"

_CANDIDATES_TEMPLATE = f"""
SELECT b.id, b.article_file_id, f.article_id, b.page_number, b.block_index, b.block_type,
       {_RANK} AS rank
FROM public.article_text_blocks b
JOIN public.article_files f ON f.id = b.article_file_id
CROSS JOIN websearch_to_tsquery('simple', :q) q
{{lateral}}
WHERE f.project_id = :pid
  AND to_tsvector('simple', b.text) @@ q
  {{filters}}
"""

_NEAREST_HEADING_JOIN = """
LEFT JOIN LATERAL (
    SELECT h.text FROM public.article_text_blocks h
    WHERE h.article_file_id = b.article_file_id
      AND h.block_type = 'heading'
      AND (h.page_number, h.block_index) <= (b.page_number, b.block_index)
    ORDER BY h.page_number DESC, h.block_index DESC
    LIMIT 1
) lh ON true
"""

_BLOCK_PAGE_TEMPLATE = """
SELECT * FROM ({candidates}) c
{cursor_filter}
ORDER BY rank DESC, id
LIMIT :limit_plus_one
"""

_ARTICLE_PAGE_TEMPLATE = """
SELECT * FROM (
    SELECT article_id, count(*) AS hit_count, max(rank) AS max_rank,
           (array_agg(id ORDER BY rank DESC, id))[1:{top}] AS top_ids
    FROM ({candidates}) c
    GROUP BY article_id
) a
{cursor_filter}
ORDER BY max_rank DESC, article_id
LIMIT :limit_plus_one
"""

_HEADLINE_QUERY = text(
    "SELECT b.id, a.title, "
    "ts_headline('simple', b.text, websearch_to_tsquery('simple', :q), "
    '\'MaxWords=35, MinWords=15, MaxFragments=1, StartSel="", StopSel=""\') AS headline '
    "FROM public.article_text_blocks b "
    "JOIN public.article_files f ON f.id = b.article_file_id "
    "JOIN public.articles a ON a.id = f.article_id "
    "WHERE b.id = ANY(CAST(:ids AS uuid[])) AND f.project_id = :pid"
)

_LOCATOR_QUERY = text(
    "SELECT b.id, b.article_file_id, b.page_number, b.block_index, b.block_type "
    "FROM public.article_text_blocks b "
    "JOIN public.article_files f ON f.id = b.article_file_id "
    "WHERE b.id = ANY(CAST(:ids AS uuid[])) AND f.project_id = :pid"
)


def _locator(row: Any) -> str:
    return f"p{row.page_number}·b{row.block_index}"


def _candidates_sql(
    params: dict[str, object],
    *,
    article_id: UUID | None,
    block_types: Sequence[BlockTypeLiteral] | None,
    exclude_references: bool,
) -> str:
    filters: list[str] = []
    if article_id is not None:
        filters.append("AND f.article_id = :aid")
        params["aid"] = str(article_id)
    if block_types:
        filters.append("AND b.block_type = ANY(CAST(:block_types AS text[]))")
        params["block_types"] = list(block_types)
    lateral = ""
    if exclude_references:
        lateral = _NEAREST_HEADING_JOIN
        filters.append("AND (lh.text IS NULL OR lh.text !~* :refs_re)")
        params["refs_re"] = _REFERENCES_HEADING_RE
    return _CANDIDATES_TEMPLATE.format(lateral=lateral, filters="\n  ".join(filters))


def _cursor_filter(
    params: dict[str, object], cursor: str | None, *, rank_col: str, id_col: str
) -> str:
    decoded = decode_cursor(cursor, arity=2)
    if decoded is None:
        return ""
    rank_value, id_value = decoded
    params["rank"] = repr(cursor_rank(rank_value))
    params["cid"] = str(cursor_uuid(id_value))
    rank = "CAST(CAST(:rank AS text) AS real)"
    return f"WHERE ({rank_col} < {rank} OR ({rank_col} = {rank} AND {id_col} > CAST(:cid AS uuid)))"


async def search_project_text(
    db: AsyncSession,
    *,
    project_id: UUID,
    query: str,
    article_id: UUID | None = None,
    cursor: str | None = None,
    group_by: Literal["block", "article"] = "block",
    exclude_references: bool = True,
    block_types: Sequence[BlockTypeLiteral] | None = None,
    limit: int = _PAGE_SIZE,
) -> McpSearchResult:
    if not query.strip() or (await db.execute(_TERM_COUNT_QUERY, {"q": query})).scalar_one() == 0:
        raise EmptySearchQueryError(query)

    params: dict[str, object] = {"q": query, "pid": str(project_id), "limit_plus_one": limit + 1}
    candidates = _candidates_sql(
        params,
        article_id=article_id,
        block_types=block_types,
        exclude_references=exclude_references,
    )
    if group_by == "article":
        cursor_filter = _cursor_filter(params, cursor, rank_col="max_rank", id_col="article_id")
        page_sql = _ARTICLE_PAGE_TEMPLATE.format(
            candidates=candidates, cursor_filter=cursor_filter, top=_TOP_LOCATORS
        )
    else:
        cursor_filter = _cursor_filter(params, cursor, rank_col="rank", id_col="id")
        page_sql = _BLOCK_PAGE_TEMPLATE.format(candidates=candidates, cursor_filter=cursor_filter)
    rows = (await db.execute(text(page_sql), params)).all()

    if not rows:
        all_in_refs = (
            exclude_references
            and cursor is None
            and await _has_hits_without_exclusion(
                db,
                project_id=project_id,
                query=query,
                article_id=article_id,
                block_types=block_types,
            )
        )
        return McpSearchResult(
            articles=[],
            next_cursor=None,
            note=_ALL_IN_REFERENCES_NOTE if all_in_refs else _NO_HITS_NOTE.format(query=query),
            references_excluded=exclude_references,
        )

    has_more = len(rows) > limit
    page_rows = rows[:limit]
    if group_by == "article":
        articles, next_cursor = await _article_page(db, project_id, query, page_rows, has_more)
    else:
        articles, next_cursor = await _block_page(db, project_id, query, page_rows, has_more)
    return McpSearchResult(
        articles=articles,
        next_cursor=next_cursor,
        note=None,
        references_excluded=exclude_references,
    )


async def _has_hits_without_exclusion(
    db: AsyncSession,
    *,
    project_id: UUID,
    query: str,
    article_id: UUID | None,
    block_types: Sequence[BlockTypeLiteral] | None,
) -> bool:
    params: dict[str, object] = {"q": query, "pid": str(project_id)}
    candidates = _candidates_sql(
        params, article_id=article_id, block_types=block_types, exclude_references=False
    )
    return (await db.execute(text(f"{candidates} LIMIT 1"), params)).first() is not None


async def _headlines(
    db: AsyncSession, project_id: UUID, query: str, ids: list[UUID]
) -> dict[UUID, tuple[str, str]]:
    rows = (
        await db.execute(
            _HEADLINE_QUERY,
            {"q": query, "ids": [str(i) for i in ids], "pid": str(project_id)},
        )
    ).all()
    return {row.id: (row.title, row.headline[:_SNIPPET_CAP]) for row in rows}


async def _block_page(
    db: AsyncSession, project_id: UUID, query: str, page_rows: Sequence[Any], has_more: bool
) -> tuple[list[McpSearchArticle], str | None]:
    headline_by_id = await _headlines(db, project_id, query, [row.id for row in page_rows])

    # Hits are grouped one row per (article, file) in first-hit order and
    # packed under the result cap on their `compact_json` weight, not counted:
    # JSON escaping (quotes, backslashes, control characters) can still double
    # a title or snippet, so 20 hits can exceed 32,000 chars (final review F1).
    # Packing stops at the first hit that does not fit, so the kept hits are a
    # rank-order prefix and a page cut short resumes after its last kept hit,
    # exactly like a full page does.
    groups: dict[tuple[UUID, UUID], McpSearchArticle] = {}
    used = 0
    last_kept = None
    for row in page_rows:
        hit = McpSearchHit(
            locator=_locator(row),
            page=row.page_number,
            block_index=row.block_index,
            block_type=row.block_type,
            snippet=headline_by_id[row.id][1],
        )
        cost = len(compact_json(hit.model_dump(mode="json"))) + 2  # + the ", " separator
        key = (row.article_id, row.article_file_id)
        group = groups.get(key)
        if group is None:
            title, title_truncated = cap_text(headline_by_id[row.id][0])
            group = McpSearchArticle(
                article_id=row.article_id,
                title=title,
                title_truncated=title_truncated,
                file_id=row.article_file_id,
            )
            cost += len(compact_json(group.model_dump(mode="json"))) + 2
        if last_kept is not None and used + cost > _HITS_BUDGET:
            has_more = True
            break
        group.hits.append(hit)
        groups[key] = group
        used += cost
        last_kept = row

    next_cursor: str | None = None
    if has_more and last_kept is not None:
        next_cursor = encode_cursor([repr(last_kept.rank), str(last_kept.id)])
    return list(groups.values()), next_cursor


async def _article_page(
    db: AsyncSession, project_id: UUID, query: str, page_rows: Sequence[Any], has_more: bool
) -> tuple[list[McpSearchArticle], str | None]:
    """One row per article, packed under the same budget as block mode; a
    page cut short resumes after its last kept article."""
    headline_by_id = await _headlines(db, project_id, query, [row.top_ids[0] for row in page_rows])
    locator_rows = (
        await db.execute(
            _LOCATOR_QUERY,
            {
                "ids": [str(i) for row in page_rows for i in row.top_ids],
                "pid": str(project_id),
            },
        )
    ).all()
    locator_by_id = {
        row.id: McpSearchLocator(
            locator=_locator(row),
            page=row.page_number,
            block_index=row.block_index,
            block_type=row.block_type,
            file_id=row.article_file_id,
        )
        for row in locator_rows
    }

    articles: list[McpSearchArticle] = []
    used = 0
    last_kept = None
    for row in page_rows:
        title, snippet = headline_by_id[row.top_ids[0]]
        capped_title, title_truncated = cap_text(title)
        article = McpSearchArticle(
            article_id=row.article_id,
            title=capped_title,
            title_truncated=title_truncated,
            file_id=None,
            hit_count=row.hit_count,
            locators=[locator_by_id[i] for i in row.top_ids],
            snippet=snippet,
        )
        cost = len(compact_json(article.model_dump(mode="json"))) + 2
        if last_kept is not None and used + cost > _HITS_BUDGET:
            has_more = True
            break
        articles.append(article)
        used += cost
        last_kept = row

    next_cursor: str | None = None
    if has_more and last_kept is not None:
        next_cursor = encode_cursor([repr(last_kept.max_rank), str(last_kept.article_id)])
    return articles, next_cursor
