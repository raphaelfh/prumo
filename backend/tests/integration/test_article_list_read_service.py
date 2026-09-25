"""Agent-facing article list/detail reads: `list_project_articles`,
`get_article_detail` (article_list_read_service), and the outline reader
`get_file_outline` (article_text_block_read_service)."""

from __future__ import annotations

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services import article_list_read_service
from app.services.article_text_block_read_service import get_file_outline
from tests.integration.conftest import SEED
from tests.integration.mcp.article_seed import insert_article, insert_blocks, insert_pdf


@pytest.mark.asyncio
async def test_list_orders_by_title_then_id_and_pages(db_session: AsyncSession) -> None:
    b = await insert_article(db_session, SEED.secondary_project, title="ZQ1-B")
    a1 = await insert_article(db_session, SEED.secondary_project, title="ZQ1-A")
    a2 = await insert_article(db_session, SEED.secondary_project, title="ZQ1-A")

    page1 = await article_list_read_service.list_project_articles(
        db_session,
        project_id=SEED.secondary_project,
        query="ZQ1-",
        has_pdf=None,
        has_text=None,
        cursor=None,
        limit=2,
    )
    assert [row.article_id for row in page1.articles] == sorted([a1, a2])
    assert all(row.title == "ZQ1-A" for row in page1.articles)
    assert page1.next_cursor is not None

    page2 = await article_list_read_service.list_project_articles(
        db_session,
        project_id=SEED.secondary_project,
        query="ZQ1-",
        has_pdf=None,
        has_text=None,
        cursor=page1.next_cursor,
        limit=2,
    )
    assert [row.article_id for row in page2.articles] == [b]
    assert page2.next_cursor is None


@pytest.mark.asyncio
async def test_query_matches_title_and_authors_and_escapes_wildcards(
    db_session: AsyncSession,
) -> None:
    by_author = await insert_article(
        db_session, SEED.secondary_project, title="ZQ2-Alpha", authors=["Smith, J"]
    )
    await insert_article(db_session, SEED.secondary_project, title="ZQ2-Beta", authors=["Doe, R"])
    literal_percent = await insert_article(
        db_session, SEED.secondary_project, title="ZQ2-50% Improvement"
    )

    by_author_page = await article_list_read_service.list_project_articles(
        db_session,
        project_id=SEED.secondary_project,
        query="smith",
        has_pdf=None,
        has_text=None,
        cursor=None,
        limit=25,
    )
    assert [row.article_id for row in by_author_page.articles] == [by_author]

    percent_page = await article_list_read_service.list_project_articles(
        db_session,
        project_id=SEED.secondary_project,
        query="%",
        has_pdf=None,
        has_text=None,
        cursor=None,
        limit=25,
    )
    assert [row.article_id for row in percent_page.articles] == [literal_percent]


@pytest.mark.asyncio
async def test_has_pdf_has_text_filters(db_session: AsyncSession) -> None:
    no_file = await insert_article(db_session, SEED.secondary_project, title="ZQ3-NoFile")
    pending_only = await insert_article(db_session, SEED.secondary_project, title="ZQ3-Pending")
    await insert_pdf(db_session, SEED.secondary_project, pending_only, status="pending")
    parsed_only = await insert_article(db_session, SEED.secondary_project, title="ZQ3-Parsed")
    await insert_pdf(db_session, SEED.secondary_project, parsed_only, status="parsed")
    stale_parsed = await insert_article(db_session, SEED.secondary_project, title="ZQ3-Stale")
    await insert_pdf(db_session, SEED.secondary_project, stale_parsed, status="parsed")
    await insert_pdf(db_session, SEED.secondary_project, stale_parsed, status="pending")

    page = await article_list_read_service.list_project_articles(
        db_session,
        project_id=SEED.secondary_project,
        query="ZQ3-",
        has_pdf=None,
        has_text=None,
        cursor=None,
        limit=25,
    )
    by_id = {row.article_id: row for row in page.articles}

    assert by_id[no_file].has_pdf is False
    assert by_id[no_file].has_text is False
    assert by_id[no_file].text_status is None

    assert by_id[pending_only].has_pdf is True
    assert by_id[pending_only].has_text is False
    assert by_id[pending_only].text_status == "pending"

    assert by_id[parsed_only].has_pdf is True
    assert by_id[parsed_only].has_text is True
    assert by_id[parsed_only].text_status == "parsed"

    # Older parsed + newer pending: has_text follows the LATEST pdf.
    assert by_id[stale_parsed].has_pdf is True
    assert by_id[stale_parsed].has_text is False
    assert by_id[stale_parsed].text_status == "pending"


@pytest.mark.asyncio
async def test_removed_at_source(db_session: AsyncSession) -> None:
    article_id = await insert_article(db_session, SEED.secondary_project, title="ZQ4-Removed")
    await db_session.execute(
        text("UPDATE public.articles SET removed_at_source_at = now() WHERE id = :id"),
        {"id": str(article_id)},
    )

    page = await article_list_read_service.list_project_articles(
        db_session,
        project_id=SEED.secondary_project,
        query="ZQ4-",
        has_pdf=None,
        has_text=None,
        cursor=None,
        limit=25,
    )
    assert page.articles[0].removed_at_source is True


@pytest.mark.asyncio
async def test_row_caps(db_session: AsyncSession) -> None:
    long_title = "T" * 500
    authors = [f"Author {i}" for i in range(10)]
    await insert_article(
        db_session, SEED.secondary_project, title="ZQ5-" + long_title, authors=authors
    )

    page = await article_list_read_service.list_project_articles(
        db_session,
        project_id=SEED.secondary_project,
        query="ZQ5-",
        has_pdf=None,
        has_text=None,
        cursor=None,
        limit=25,
    )
    row = page.articles[0]
    assert len(row.title) == 200
    assert len(row.authors) == 3
    assert row.authors_total == 10


@pytest.mark.asyncio
async def test_outline(db_session: AsyncSession) -> None:
    article_id = await insert_article(db_session, SEED.secondary_project, title="ZQ6-Outline")
    file_id = await insert_pdf(db_session, SEED.secondary_project, article_id)
    await insert_blocks(
        db_session,
        file_id,
        [
            (1, 0, "Intro", "heading"),
            (1, 1, "x", "paragraph"),
            (2, 0, "Methods", "heading"),
        ],
    )

    outline = await get_file_outline(db_session, article_file_id=file_id)
    assert outline.page_count == 2
    assert outline.block_count == 3
    assert [(h.page, h.block_index, h.text) for h in outline.headings] == [
        (1, 0, "Intro"),
        (2, 0, "Methods"),
    ]
    assert outline.headings_truncated is False


@pytest.mark.asyncio
async def test_outline_truncates_headings(db_session: AsyncSession) -> None:
    article_id = await insert_article(db_session, SEED.secondary_project, title="ZQ7-ManyHeadings")
    file_id = await insert_pdf(db_session, SEED.secondary_project, article_id)
    await insert_blocks(
        db_session,
        file_id,
        [(1, i, f"Heading {i}", "heading") for i in range(70)],
    )

    outline = await get_file_outline(db_session, article_file_id=file_id)
    assert len(outline.headings) == 60
    assert outline.headings_truncated is True


@pytest.mark.asyncio
async def test_get_article_detail_returns_files_and_abstract(db_session: AsyncSession) -> None:
    article_id = await insert_article(db_session, SEED.secondary_project, title="ZQ8-Detail")
    await db_session.execute(
        text("UPDATE public.articles SET abstract = :abstract WHERE id = :id"),
        {"abstract": "short abstract", "id": str(article_id)},
    )
    file_id = await insert_pdf(db_session, SEED.secondary_project, article_id)

    detail = await article_list_read_service.get_article_detail(db_session, article_id=article_id)
    assert detail.article_id == article_id
    assert detail.abstract == "short abstract"
    assert detail.abstract_truncated is False
    assert detail.outline is None
    assert [f.article_file_id for f in detail.files] == [file_id]


@pytest.mark.asyncio
async def test_get_article_detail_truncates_long_abstract(db_session: AsyncSession) -> None:
    article_id = await insert_article(db_session, SEED.secondary_project, title="ZQ9-LongAbstract")
    long_abstract = "x" * 7000
    await db_session.execute(
        text("UPDATE public.articles SET abstract = :abstract WHERE id = :id"),
        {"abstract": long_abstract, "id": str(article_id)},
    )

    detail = await article_list_read_service.get_article_detail(db_session, article_id=article_id)
    assert detail.abstract is not None
    assert len(detail.abstract) == 6000
    assert detail.abstract_truncated is True
