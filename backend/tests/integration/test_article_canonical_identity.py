"""Canonical-identity lookup (PMID, DOI, URL) and the fill-only upsert, on real Postgres."""

from typing import Any
from uuid import UUID

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.article import Article
from app.repositories.article_repository import ArticleRepository
from app.services.article_source_normalization import PUBMED_FILL_FIELDS
from tests.integration.conftest import SEED

P = SEED.primary_project


async def _article(db: AsyncSession, project_id: UUID = P, **fields: Any) -> Article:
    fields.setdefault("title", "T")
    article = Article(project_id=project_id, **fields)
    db.add(article)
    await db.flush()
    return article


async def test_pmid_wins_over_doi(db_session: AsyncSession) -> None:
    a = await _article(db_session, pmid="111")
    await _article(db_session, doi="10.1/x")

    found = await ArticleRepository(db_session).get_by_canonical_identity(
        P, pmid="111", doi="10.1/x"
    )

    assert found is not None
    assert found.id == a.id


async def test_falls_back_to_doi_then_url(db_session: AsyncSession) -> None:
    await _article(db_session, pmid="111")
    b = await _article(db_session, doi="10.1/x")
    c = await _article(db_session, url_landing="https://example.org/c")
    repo = ArticleRepository(db_session)

    by_doi = await repo.get_by_canonical_identity(P, pmid="999", doi="10.1/x")
    by_url = await repo.get_by_canonical_identity(P, pmid="999", url_landing=c.url_landing)
    none = await repo.get_by_canonical_identity(P, pmid="999")

    assert by_doi is not None
    assert by_doi.id == b.id
    assert by_url is not None
    assert by_url.id == c.id
    assert none is None


@pytest.mark.parametrize(
    "stored",
    ["https://doi.org/10.1/ABC", "http://dx.doi.org/10.1/abc", "doi:10.1/ABC", " 10.1/Abc "],
    ids=["https-prefix", "dx-prefix", "doi-colon", "case-and-space"],
)
async def test_doi_match_ignores_stored_prefix_and_case(
    db_session: AsyncSession, stored: str
) -> None:
    a = await _article(db_session, doi=stored)

    found = await ArticleRepository(db_session).get_by_canonical_identity(P, doi="10.1/abc")

    assert found is not None
    assert found.id == a.id


async def test_zotero_key_short_circuits(db_session: AsyncSession) -> None:
    z = await _article(db_session, zotero_item_key="K", pmid="111")
    await _article(db_session, pmid="222")

    found = await ArticleRepository(db_session).get_by_canonical_identity(
        P, zotero_item_key="K", pmid="222"
    )

    assert found is not None
    assert found.id == z.id


async def test_lookup_is_project_scoped(db_session: AsyncSession) -> None:
    await _article(db_session, SEED.secondary_project, pmid="333")

    found = await ArticleRepository(db_session).get_by_canonical_identity(P, pmid="333")

    assert found is None


@pytest.mark.parametrize("source", ["zotero", "RIS"])
async def test_fill_only_upsert_fills_blanks_and_keeps_provenance(
    db_session: AsyncSession, source: str
) -> None:
    existing = await _article(
        db_session,
        title="Kept title",
        doi="https://doi.org/10.1/abc",
        ingestion_source=source,
        source_payload={"key": "K"},
        source_lineage=source,
        zotero_item_key="K" if source == "zotero" else None,
        volume="12",
        abstract="   ",
        mesh_terms=None,
        keywords=[],
        pmid=None,
    )
    payload = {
        "title": "PubMed title",
        "abstract": "A",
        "mesh_terms": ["M"],
        "keywords": ["k"],
        "pmid": "111",
        "volume": "99",
        "ingestion_source": "pubmed",
        "source_payload": {"efetch_xml": "<x/>"},
        "source_lineage": "pubmed",
    }
    repo = ArticleRepository(db_session)

    article, outcome = await repo.fill_only_upsert(
        project_id=P,
        payload=payload,
        canonical_identity={"pmid": "111", "doi": "10.1/abc", "url_landing": None},
        fill_fields=PUBMED_FILL_FIELDS,
    )

    assert outcome == "updated"
    assert article.id == existing.id
    assert article.abstract == "A"
    assert article.mesh_terms == ["M"]
    assert article.keywords == ["k"]
    assert article.pmid == "111"
    assert article.volume == "12"
    assert article.title == "Kept title"
    assert article.ingestion_source == source
    assert article.source_payload == {"key": "K"}
    assert article.source_lineage == source
    if source == "zotero":
        zotero = await repo.get_zotero_project_articles(P)
        assert existing.id in {z.id for z in zotero}


async def test_fill_only_upsert_inserts_on_no_match(db_session: AsyncSession) -> None:
    payload = {
        "title": "New",
        "abstract": "A",
        "pmid": "555",
        "doi": "10.1/new",
        "ingestion_source": "pubmed",
        "source_payload": {"efetch_xml": "<x/>"},
        "source_lineage": "pubmed",
    }

    article, outcome = await ArticleRepository(db_session).fill_only_upsert(
        project_id=P,
        payload=payload,
        canonical_identity={"pmid": "555", "doi": "10.1/new", "url_landing": None},
        fill_fields=PUBMED_FILL_FIELDS,
    )

    assert outcome == "inserted"
    for key, value in payload.items():
        assert getattr(article, key) == value
    assert article.project_id == P
    assert article.last_synced_at is not None


async def test_existing_pmids(db_session: AsyncSession) -> None:
    await _article(db_session, pmid="1")
    await _article(db_session, pmid="2")
    await _article(db_session, SEED.secondary_project, pmid="3")
    repo = ArticleRepository(db_session)

    assert await repo.existing_pmids(P, ["1", "3"]) == {"1"}
    assert await repo.existing_pmids(P, []) == set()


def test_pubmed_fill_fields_are_the_spec_list() -> None:
    assert PUBMED_FILL_FIELDS == (
        "abstract",
        "mesh_terms",
        "pmid",
        "pmcid",
        "keywords",
        "article_type",
        "language",
        "volume",
        "issue",
        "pages",
    )


async def test_fill_only_upsert_with_nothing_to_fill_is_unchanged(db_session: AsyncSession) -> None:
    repo = ArticleRepository(db_session)
    payload = {"title": "T", "abstract": "A", "pmid": "777", "ingestion_source": "pubmed"}
    identity = {"pmid": "777", "doi": None, "url_landing": None}
    first, _ = await repo.fill_only_upsert(
        project_id=P, payload=payload, canonical_identity=identity, fill_fields=PUBMED_FILL_FIELDS
    )

    again, outcome = await repo.fill_only_upsert(
        project_id=P, payload=payload, canonical_identity=identity, fill_fields=PUBMED_FILL_FIELDS
    )

    assert (again.id, outcome) == (first.id, "unchanged")
