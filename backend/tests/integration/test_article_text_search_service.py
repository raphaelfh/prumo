"""`article_text_search_service.search_project_text` (spec §5.1, task 7b):
keyword search over article text, scoped to a project in the WHERE clause,
ranked (rank desc, block id), paged, with untrusted-wrapped snippets."""

from __future__ import annotations

import pytest

from app.services.article_text_search_service import search_project_text
from app.utils.untrusted import UNTRUSTED_CLOSE, UNTRUSTED_OPEN
from tests.integration.conftest import SEED
from tests.integration.mcp.article_seed import insert_article, insert_blocks, insert_pdf


async def test_search_confined_to_project(db_session) -> None:
    primary_article = await insert_article(db_session, SEED.primary_project, title="Primary hit")
    primary_file = await insert_pdf(db_session, SEED.primary_project, primary_article)
    await insert_blocks(
        db_session,
        primary_file,
        [(3, 5, "This cohort shows zebrafishmcp expression.", "paragraph")],
    )

    secondary_article = await insert_article(
        db_session, SEED.secondary_project, title="Secondary hit"
    )
    secondary_file = await insert_pdf(db_session, SEED.secondary_project, secondary_article)
    await insert_blocks(
        db_session,
        secondary_file,
        [(1, 0, "Another zebrafishmcp reference here.", "paragraph")],
    )

    primary_result = await search_project_text(
        db_session, project_id=SEED.primary_project, query="zebrafishmcp", article_id=None
    )
    assert len(primary_result.hits) == 1
    hit = primary_result.hits[0]
    assert hit.article_id == primary_article
    assert hit.page == 3
    assert hit.locator == "p3·b5"

    secondary_result = await search_project_text(
        db_session, project_id=SEED.secondary_project, query="zebrafishmcp", article_id=None
    )
    assert len(secondary_result.hits) == 1
    assert secondary_result.hits[0].article_id == secondary_article


async def test_search_article_filter(db_session) -> None:
    first_article = await insert_article(db_session, SEED.primary_project, title="First")
    first_file = await insert_pdf(db_session, SEED.primary_project, first_article)
    await insert_blocks(
        db_session, first_file, [(1, 0, "keywordarticlefilter appears here.", "paragraph")]
    )

    second_article = await insert_article(db_session, SEED.primary_project, title="Second")
    second_file = await insert_pdf(db_session, SEED.primary_project, second_article)
    await insert_blocks(
        db_session, second_file, [(1, 0, "keywordarticlefilter also here.", "paragraph")]
    )

    result = await search_project_text(
        db_session,
        project_id=SEED.primary_project,
        query="keywordarticlefilter",
        article_id=first_article,
    )
    assert len(result.hits) == 1
    assert result.hits[0].article_id == first_article


@pytest.mark.parametrize(
    "q",
    ["'", "&", "|", "!", ":*", "(", ")", "<->", "a & | b", "", "the"],
)
async def test_special_characters_never_raise(db_session, q: str) -> None:
    result = await search_project_text(
        db_session, project_id=SEED.primary_project, query=q, article_id=None
    )
    assert result is not None


async def test_search_paging_by_rank_then_id(db_session) -> None:
    article = await insert_article(db_session, SEED.primary_project, title="Paging article")
    file_id = await insert_pdf(db_session, SEED.primary_project, article)
    await insert_blocks(
        db_session,
        file_id,
        [(1, i, f"pagingtermxyz occurs in block {i}.", "paragraph") for i in range(25)],
    )

    page1 = await search_project_text(
        db_session, project_id=SEED.primary_project, query="pagingtermxyz", article_id=None
    )
    assert len(page1.hits) == 20
    assert page1.next_cursor is not None

    page2 = await search_project_text(
        db_session,
        project_id=SEED.primary_project,
        query="pagingtermxyz",
        article_id=None,
        cursor=page1.next_cursor,
    )
    assert len(page2.hits) == 5
    assert page2.next_cursor is None

    ids_1 = {hit.block_id for hit in page1.hits}
    ids_2 = {hit.block_id for hit in page2.hits}
    assert ids_1.isdisjoint(ids_2)


async def test_snippet_is_wrapped_and_capped(db_session) -> None:
    article = await insert_article(db_session, SEED.primary_project, title="Snippet article")
    file_id = await insert_pdf(db_session, SEED.primary_project, article)
    long_text = "snippetcaptest " + ("filler word " * 200)
    await insert_blocks(db_session, file_id, [(1, 0, long_text, "paragraph")])

    result = await search_project_text(
        db_session, project_id=SEED.primary_project, query="snippetcaptest", article_id=None
    )
    assert len(result.hits) == 1
    snippet = result.hits[0].snippet
    assert snippet.startswith(UNTRUSTED_OPEN)
    assert snippet.endswith(UNTRUSTED_CLOSE)
    inner = snippet[len(UNTRUSTED_OPEN) : -len(UNTRUSTED_CLOSE)]
    assert len(inner) <= 400
