"""Agent-facing article list + detail reads (`list_articles`, `get_article`).

Sibling of the guards-only `article_read_service`: that module owns the
ownership predicates (`owned_article_file`, `resolve_article_file`); this one
builds the list/detail response shapes the MCP tools return. `get_article`'s
outline is filled by the tool, not here (it depends on which file the tool
resolved via `resolve_article_file`).
"""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import exists, func, or_, select, tuple_
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.article import Article, ArticleFile
from app.models.extraction import ExtractionRun
from app.repositories.article_repository import ArticleFileRepository
from app.schemas.mcp_articles import (
    McpArticleDetail,
    McpArticleFileRow,
    McpArticleList,
    McpArticleRow,
    McpArticleTemplateStatus,
)
from app.services.article_read_service import ArticleNotFoundError
from app.services.extraction_current_run import select_current_runs_by_article
from app.services.project_read_service import template_summaries
from app.utils.opaque_cursor import cursor_text, cursor_uuid, decode_cursor, encode_cursor
from app.utils.text_caps import cap_json_weight, cap_text


async def article_template_status(
    db: AsyncSession, *, project_id: UUID, article_id: UUID
) -> list[McpArticleTemplateStatus]:
    """Per-template extraction status for one article (spec §5.1's `get_article`
    extraction status). Reuses the shared current-run rule so this answer never
    disagrees with export or the HITL session path about which run is current."""
    templates = await template_summaries(db, project_id=project_id)
    run_rows = (
        (
            await db.execute(
                select(ExtractionRun).where(
                    ExtractionRun.article_id == article_id,
                    ExtractionRun.project_id == project_id,
                )
            )
        )
        .scalars()
        .all()
    )

    runs_by_template: dict[tuple[UUID, str], list[ExtractionRun]] = {}
    for run in run_rows:
        runs_by_template.setdefault((run.template_id, run.kind), []).append(run)

    statuses: list[McpArticleTemplateStatus] = []
    for summary in templates:
        template_runs = runs_by_template.get((summary.template_id, summary.kind), [])
        current = (
            select_current_runs_by_article(template_runs).get(article_id) if template_runs else None
        )
        statuses.append(
            McpArticleTemplateStatus(
                template_id=summary.template_id,
                template_name=summary.name,
                kind=summary.kind,
                run_id=current.id if current is not None else None,
                stage=current.stage if current is not None else None,
                reason=None if current is not None else "no_run",
            )
        )
    return statuses


# Module constants (spec §5.1 size caps; the title cap is `text_caps.TITLE_CAP`).
_LIST_AUTHORS_CAP = 3
_LIST_AUTHOR_CAP = 60
_DETAIL_AUTHORS_CAP = 20
# A char cap alone lets non-ASCII text through at up to 6x its length once
# `compact_json` escapes it: each author, each file's name and the abstract
# are cut by serialized weight. 202 = 200 ASCII chars + quotes; 20 authors ~ 4k.
_DETAIL_AUTHOR_WEIGHT = 202
_FILENAME_WEIGHT = 202
_ABSTRACT_CAP = 6_000
_ABSTRACT_WEIGHT = 12_000


def _escape_ilike(value: str) -> str:
    """Escape `%`, `_` and `\\` so a caller's query is a literal substring,
    not a wildcard pattern, under `ilike(..., escape="\\")`."""
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _cap_list_authors(authors: list[str] | None) -> tuple[list[str], int]:
    authors = authors or []
    capped = [a[:_LIST_AUTHOR_CAP] for a in authors[:_LIST_AUTHORS_CAP]]
    return capped, len(authors)


async def list_project_articles(
    db: AsyncSession,
    *,
    project_id: UUID,
    query: str | None,
    has_pdf: bool | None,
    has_text: bool | None,
    cursor: str | None,
    limit: int,
) -> McpArticleList:
    # Mirrors `ArticleFileRepository.get_latest_pdf`: the latest PDF's
    # extraction_status decides an article's text_status/has_text.
    latest_pdf_status = (
        select(ArticleFile.extraction_status)
        .where(ArticleFile.article_id == Article.id, ArticleFile.file_type.ilike("%pdf%"))
        .order_by(ArticleFile.created_at.desc())
        .limit(1)
        .correlate(Article)
        .scalar_subquery()
    )
    has_pdf_expr = exists(
        select(1)
        .where(ArticleFile.article_id == Article.id, ArticleFile.file_type.ilike("%pdf%"))
        .correlate(Article)
    )

    stmt = select(
        Article.id,
        Article.title,
        Article.authors,
        Article.publication_year,
        Article.removed_at_source_at,
        latest_pdf_status.label("text_status"),
        has_pdf_expr.label("has_pdf"),
    ).where(Article.project_id == project_id)

    if query:
        pattern = f"%{_escape_ilike(query)}%"
        stmt = stmt.where(
            or_(
                Article.title.ilike(pattern, escape="\\"),
                func.array_to_string(Article.authors, " ").ilike(pattern, escape="\\"),
            )
        )

    if has_pdf is not None:
        stmt = stmt.where(has_pdf_expr if has_pdf else ~has_pdf_expr)

    if has_text is not None:
        is_parsed = latest_pdf_status == "parsed"
        stmt = stmt.where(is_parsed if has_text else ~is_parsed)

    values = decode_cursor(cursor, arity=2)
    if values is not None:
        cursor_title, cursor_id = cursor_text(values[0]), cursor_uuid(values[1])
        stmt = stmt.where(tuple_(Article.title, Article.id) > (cursor_title, cursor_id))

    stmt = stmt.order_by(Article.title, Article.id).limit(limit + 1)

    rows = (await db.execute(stmt)).all()
    has_more = len(rows) > limit
    page = rows[:limit]

    articles = []
    for row in page:
        authors, authors_total = _cap_list_authors(row.authors)
        articles.append(
            McpArticleRow(
                article_id=row.id,
                title=cap_text(row.title)[0],
                authors=authors,
                authors_total=authors_total,
                year=row.publication_year,
                text_status=row.text_status,
                removed_at_source=row.removed_at_source_at is not None,
                has_pdf=row.has_pdf,
                has_text=row.text_status == "parsed",
            )
        )

    next_cursor = encode_cursor([page[-1].title, str(page[-1].id)]) if has_more and page else None
    return McpArticleList(articles=articles, next_cursor=next_cursor)


def _capped(value: str | None) -> str | None:
    """An optional unbounded-Text field, cut like a title (spec §5.1)."""
    return cap_text(value)[0] if value is not None else None


async def get_article_detail(db: AsyncSession, *, article_id: UUID) -> McpArticleDetail:
    row = (await db.execute(select(Article).where(Article.id == article_id))).scalar_one_or_none()
    if row is None:  # removed between the choke point's check and this read
        raise ArticleNotFoundError(f"Article {article_id} not found")

    files = await ArticleFileRepository(db).list_for_article_ordered(article_id)

    abstract = row.abstract
    abstract_truncated = False
    if abstract is not None:
        abstract, cut_by_chars = cap_text(abstract, _ABSTRACT_CAP)
        abstract, cut_by_weight = cap_json_weight(abstract, _ABSTRACT_WEIGHT)
        abstract_truncated = cut_by_chars or cut_by_weight

    title, title_truncated = cap_text(row.title)
    return McpArticleDetail(
        article_id=row.id,
        project_id=row.project_id,
        title=title,
        title_truncated=title_truncated,
        authors=[
            cap_json_weight(a, _DETAIL_AUTHOR_WEIGHT)[0]
            for a in (row.authors or [])[:_DETAIL_AUTHORS_CAP]
        ],
        year=row.publication_year,
        journal_title=_capped(row.journal_title),
        doi=row.doi,
        pmid=row.pmid,
        publication_status=row.publication_status,
        removed_at_source=row.removed_at_source_at is not None,
        abstract=abstract,
        abstract_truncated=abstract_truncated,
        files=[
            McpArticleFileRow(
                article_file_id=f.id,
                role=f.file_role,
                file_type=f.file_type,
                original_filename=(
                    cap_json_weight(f.original_filename, _FILENAME_WEIGHT)[0]
                    if f.original_filename is not None
                    else None
                ),
                extraction_status=f.extraction_status,
                created_at=f.created_at,
            )
            for f in files
        ],
        outline=None,
        extraction_status=[],  # filled by the get_article tool via article_template_status
    )
