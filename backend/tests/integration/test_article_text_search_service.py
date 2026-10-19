"""`article_text_search_service.search_project_text` (spec §5.1, task 7b):
keyword search over article text, scoped to a project in the WHERE clause,
ranked (rank desc, block id), paged, with raw capped snippets."""

from __future__ import annotations

import pytest

from app.services.article_text_search_service import EmptySearchQueryError, search_project_text
from app.utils.compact_json import compact_json
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
    assert [row.article_id for row in primary_result.articles] == [primary_article]
    assert primary_result.articles[0].file_id == primary_file
    hit = primary_result.articles[0].hits[0]
    assert len(primary_result.articles[0].hits) == 1
    assert hit.page == 3
    assert hit.locator == "p3·b5"

    secondary_result = await search_project_text(
        db_session, project_id=SEED.secondary_project, query="zebrafishmcp", article_id=None
    )
    assert [row.article_id for row in secondary_result.articles] == [secondary_article]
    assert len(secondary_result.articles[0].hits) == 1


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
    assert [row.article_id for row in result.articles] == [first_article]
    assert len(result.articles[0].hits) == 1


@pytest.mark.parametrize("q", ["a & | b", "the", "x:*", "(a) <-> b"])
async def test_special_characters_never_raise(db_session, q: str) -> None:
    result = await search_project_text(
        db_session, project_id=SEED.primary_project, query=q, article_id=None
    )
    assert result is not None


@pytest.mark.parametrize("q", ["'", "&", "|", "!", ":*", "(", ")", "<->", "", "  "])
async def test_termless_query_raises_empty_search_query(db_session, q: str) -> None:
    with pytest.raises(EmptySearchQueryError):
        await search_project_text(
            db_session, project_id=SEED.primary_project, query=q, article_id=None
        )


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
    assert len(_hits(page1)) == 20
    assert page1.next_cursor is not None

    page2 = await search_project_text(
        db_session,
        project_id=SEED.primary_project,
        query="pagingtermxyz",
        article_id=None,
        cursor=page1.next_cursor,
    )
    assert len(_hits(page2)) == 5
    assert page2.next_cursor is None

    locators_1 = {hit.locator for hit in _hits(page1)}
    locators_2 = {hit.locator for hit in _hits(page2)}
    assert locators_1.isdisjoint(locators_2)
    assert len(locators_1 | locators_2) == 25


async def test_snippet_is_raw_and_capped(db_session) -> None:
    article = await insert_article(db_session, SEED.primary_project, title="Snippet article")
    file_id = await insert_pdf(db_session, SEED.primary_project, article)
    long_text = "snippetcaptest " + ("filler word " * 200)
    await insert_blocks(db_session, file_id, [(1, 0, long_text, "paragraph")])

    result = await search_project_text(
        db_session, project_id=SEED.primary_project, query="snippetcaptest", article_id=None
    )
    assert len(_hits(result)) == 1
    snippet = _hits(result)[0].snippet
    assert "snippetcaptest" in snippet
    assert len(snippet) <= 400
    assert "ARTICLE_TEXT" not in snippet


async def test_search_hit_titles_are_capped(db_session) -> None:
    """F1 (final review): `articles.title` is unbounded Text -- 20 hits on
    1,024-char titles must stay under the 32,000-char result cap, each title
    cut to 200 chars and flagged. Control characters render as 6-char escapes,
    so a 20-hit page of them is cut on weight, not count."""
    for i in range(21):
        article_id = await insert_article(
            db_session, SEED.primary_project, title=f"{i:02d}" + "\x07" * 1_022
        )
        file_id = await insert_pdf(db_session, SEED.primary_project, article_id)
        await insert_blocks(
            db_session,
            file_id,
            [(1, 0, "titlecapkeyword " + "é" * 380, "paragraph")],
        )

    seen: list[str] = []
    page_sizes: list[int] = []
    cursor = None
    while True:
        result = await search_project_text(
            db_session, project_id=SEED.primary_project, query="titlecapkeyword", cursor=cursor
        )
        assert len(compact_json(result.model_dump(mode="json"))) <= 32_000
        page_sizes.append(len(_hits(result)))
        for row in result.articles:
            assert len(row.title) == 200
            assert row.title_truncated is True
            seen.extend(row.title[:2] for _ in row.hits)
        cursor = result.next_cursor
        if cursor is None:
            break
    assert sorted(seen) == [f"{i:02d}" for i in range(21)]  # every hit once, none lost
    assert page_sizes[0] < 20  # the first page was cut on weight


def _hits(result):
    return [hit for row in result.articles for hit in row.hits]


@pytest.mark.parametrize(
    ("heading", "excluded"),
    [
        ("Referências", True),
        ("Literature Cited", True),
        ("1.2. bibliografia", True),
        ("  REFERENCES  ", True),
        ("References and notes", False),
        ("Reference standard", False),
    ],
    ids=["pt-accented", "literature-cited", "numbered-pt", "padded-upper", "suffix", "prefix"],
)
async def test_references_heading_variants(db_session, heading: str, excluded: bool) -> None:
    article = await insert_article(db_session, SEED.primary_project, title="Heading variants")
    file_id = await insert_pdf(db_session, SEED.primary_project, article)
    await insert_blocks(
        db_session,
        file_id,
        [(1, 0, heading, "heading"), (1, 1, "headvariantmarker cited.", "list_item")],
    )
    result = await search_project_text(
        db_session, project_id=SEED.primary_project, query="headvariantmarker"
    )
    assert (len(_hits(result)) == 0) is excluded
    assert result.references_excluded is True
