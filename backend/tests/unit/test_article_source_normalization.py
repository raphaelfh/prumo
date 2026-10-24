import xml.etree.ElementTree as ET
from pathlib import Path

import pytest

from app.services.article_source_normalization import (
    normalize_pubmed_record,
    normalize_zotero_item,
)

_FIXTURE = Path(__file__).parents[1] / "fixtures/pubmed/efetch_batch.xml"


def rec(pmid: str) -> ET.Element:
    root = ET.parse(_FIXTURE).getroot()
    for article in root.findall("PubmedArticle"):
        if article.findtext("MedlineCitation/PMID") == pmid:
            return article
    raise AssertionError(f"PMID {pmid} not in fixture")


def _inline(*, article_inner: str = "", pubmed_data: str = "", pmid: str = "1") -> ET.Element:
    return ET.fromstring(
        f"<PubmedArticle><MedlineCitation><PMID>{pmid}</PMID><Article>{article_inner}</Article>"
        f"</MedlineCitation><PubmedData>{pubmed_data}</PubmedData></PubmedArticle>"
    )


def test_normalize_zotero_item_preserves_identity() -> None:
    payload = normalize_zotero_item(
        item={
            "key": "ABCD1234",
            "version": 1,
            "data": {
                "title": "Title",
                "DOI": "https://doi.org/10.1000/xyz",
                "url": "https://example.org/paper/",
                "creators": [{"creatorType": "author", "name": "Jane Doe"}],
            },
        },
        collection_key="COLL01",
    )
    assert payload.canonical_identity["zotero_item_key"] == "ABCD1234"
    assert payload.canonical_identity["doi"] == "10.1000/xyz"
    assert payload.canonical_identity["url_landing"] == "https://example.org/paper"
    assert payload.article_fields["source_lineage"] == "zotero"


def test_structured_abstract_record() -> None:  # PMID 42908551
    p = normalize_pubmed_record(record=rec("42908551"))
    f = p.article_fields
    assert f["title"].startswith(
        "Development and validation of an interpretable machine learning model"
    )
    assert f["abstract"].startswith(
        "BACKGROUND: Acute kidney injury (AKI) and altered consciousnes"
    )
    assert "\n\nMETHODS: We retrospectively extracted data from the MIMIC-I" in f["abstract"]
    assert "\n\nRESULT: " in f["abstract"] and "\n\nCONCLUSION: " in f["abstract"]
    assert f["authors"][0] == "Yang, S" and len(f["authors"]) == 6
    assert (f["journal_title"], f["volume"], f["issue"], f["pages"]) == (
        "Frontiers in endocrinology",
        "17",
        None,
        "1959304",
    )
    assert (f["publication_year"], f["publication_month"], f["publication_day"]) == (
        2026,
        None,
        None,
    )
    assert f["doi"] == "10.3389/fendo.2026.1959304" and f["pmid"] == "42908551"
    assert f["pmcid"] == "PMC13682982"
    assert len(f["mesh_terms"]) == 14 and f["mesh_terms"][0] == "Humans"
    assert f["keywords"] == [
        "acute kidney injury",
        "altered consciousness",
        "cardiac surgery",
        "intensive care unit",
        "machine learning",
    ]
    assert (f["article_type"], f["language"]) == ("Journal Article", "eng")
    assert (f["ingestion_source"], f["source_lineage"]) == ("pubmed", "pubmed")
    assert set(f["source_payload"]) == {"efetch_xml"}
    assert f["source_payload"]["efetch_xml"].startswith("<PubmedArticle>")
    assert '<PMID Version="1">42908551</PMID>' in f["source_payload"]["efetch_xml"]
    assert p.canonical_identity == {
        "pmid": "42908551",
        "doi": "10.3389/fendo.2026.1959304",
        "url_landing": None,
    }
    assert p.creator_rows == []


def test_unstructured_abstract_and_own_pmc_only() -> None:
    # PMID 42875467: its ReferenceList carries other PMC ids
    f = normalize_pubmed_record(record=rec("42875467")).article_fields
    assert (
        f["abstract"].startswith("Patients with multiple myeloma accumulate hundreds")
        and ":" not in f["abstract"][:12]
    )
    assert f["pmcid"] == "PMC13669396"
    assert (f["publication_month"], f["publication_day"], f["issue"]) == (10, 14, "1")
    assert f["mesh_terms"] is None and f["keywords"] is None and f["pages"] is None
    assert len(f["authors"]) == 24


def test_letter_without_abstract() -> None:  # PMID 42706533
    f = normalize_pubmed_record(record=rec("42706533")).article_fields
    assert f["abstract"] is None and f["article_type"] == "Letter"
    assert f["publication_month"] == 9
    assert f["doi"] == "10.1186/s13054-026-06289-y"


def test_markup_and_non_ascii_survive() -> None:
    record = _inline(
        article_inner=(
            "<ArticleTitle>A <i>BRCA1</i> study</ArticleTitle>"
            "<Abstract><AbstractText>CRP<sup>2</sup> rose</AbstractText></Abstract>"
            "<AuthorList><Author><LastName>Lübberstedt</LastName><Initials>J</Initials></Author>"
            "</AuthorList>"
        )
    )
    f = normalize_pubmed_record(record=record).article_fields
    assert f["title"] == "A BRCA1 study"
    assert f["abstract"] == "CRP2 rose"
    assert f["authors"] == ["Lübberstedt, J"]


@pytest.mark.parametrize(
    ("pubdate", "expected"),
    [
        ("<Year>2023</Year><Month>Mar</Month><Day>07</Day>", (2023, 3, 7)),
        ("<Year>2023</Year><Month>03</Month>", (2023, 3, None)),
        ("<MedlineDate>2023 Jan-Feb</MedlineDate>", (2023, None, None)),
        ("<Year>2023</Year><Season>Spring</Season>", (2023, None, None)),
    ],
    ids=["named-month", "numeric-month", "medline-date", "season"],
)
def test_pubdate_variants(pubdate: str, expected: tuple[int, int | None, int | None]) -> None:
    record = _inline(
        article_inner=f"<Journal><JournalIssue><PubDate>{pubdate}</PubDate></JournalIssue></Journal>"
    )
    f = normalize_pubmed_record(record=record).article_fields
    assert (f["publication_year"], f["publication_month"], f["publication_day"]) == expected


def test_collective_author_and_doi_from_article_id_list() -> None:
    record = _inline(
        article_inner=(
            "<AuthorList><Author><CollectiveName>MIMIC-IV Investigators</CollectiveName></Author>"
            "<Author><LastName>Solo</LastName></Author></AuthorList>"
        ),
        pubmed_data='<ArticleIdList><ArticleId IdType="doi">10.1/ABC</ArticleId></ArticleIdList>',
    )
    p = normalize_pubmed_record(record=record)
    assert p.article_fields["authors"] == ["MIMIC-IV Investigators", "Solo"]
    assert p.article_fields["doi"] == "10.1/abc"
    assert p.canonical_identity["doi"] == "10.1/abc"
    assert p.article_fields["title"] == "Untitled"
