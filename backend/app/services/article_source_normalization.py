"""
Canonical normalization for article ingestion sources.
"""

from __future__ import annotations

import re
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from typing import Any


def _clean(value: str | None) -> str | None:
    if value is None:
        return None
    cleaned = value.strip()
    return cleaned or None


def normalize_doi(doi: str | None) -> str | None:
    cleaned = _clean(doi)
    if not cleaned:
        return None
    return cleaned.lower().removeprefix("https://doi.org/").removeprefix("doi:")


def normalize_url(url: str | None) -> str | None:
    cleaned = _clean(url)
    if not cleaned:
        return None
    return cleaned.rstrip("/")


def extract_year(date_value: str | None) -> int | None:
    if not date_value:
        return None
    match = re.search(r"\b(\d{4})\b", date_value)
    if not match:
        return None
    return int(match.group(1))


def normalize_author_display_name(creator: dict[str, Any]) -> str:
    if creator.get("name"):
        return str(creator["name"]).strip()
    first = str(creator.get("firstName") or "").strip()
    last = str(creator.get("lastName") or "").strip()
    if first and last:
        return f"{last}, {first}"
    return first or last or "Unknown"


@dataclass(slots=True)
class CanonicalArticlePayload:
    canonical_identity: dict[str, str | None]
    article_fields: dict[str, Any]
    creator_rows: list[dict[str, Any]]


def normalize_zotero_item(
    *,
    item: dict[str, Any],
    collection_key: str,
) -> CanonicalArticlePayload:
    data = item.get("data", {})
    creators = list(data.get("creators") or [])
    doi = normalize_doi(data.get("DOI"))
    url_landing = normalize_url(data.get("url"))
    zotero_item_key = item.get("key")
    creator_rows = [
        {
            "creator_type": creator.get("creatorType") or "author",
            "display_name": normalize_author_display_name(creator),
            "raw": creator,
        }
        for creator in creators
        if isinstance(creator, dict)
    ]
    article_fields: dict[str, Any] = {
        "title": data.get("title") or "Untitled",
        "abstract": data.get("abstractNote"),
        "publication_year": extract_year(data.get("date")),
        "journal_title": data.get("publicationTitle"),
        "journal_issn": data.get("ISSN"),
        "volume": data.get("volume"),
        "issue": data.get("issue"),
        "pages": data.get("pages"),
        "doi": doi,
        "url_landing": url_landing,
        "authors": [row["display_name"] for row in creator_rows if row["creator_type"] == "author"]
        or None,
        "keywords": [tag.get("tag") for tag in data.get("tags", []) if tag.get("tag")] or None,
        "ingestion_source": "zotero",
        "source_payload": item,
        "zotero_item_key": zotero_item_key,
        "zotero_collection_key": collection_key,
        "zotero_version": item.get("version"),
        "sync_state": "active",
        "source_lineage": "zotero",
    }

    canonical_identity = {
        "zotero_item_key": zotero_item_key,
        "doi": doi,
        "url_landing": url_landing,
    }
    return CanonicalArticlePayload(
        canonical_identity=canonical_identity,
        article_fields=article_fields,
        creator_rows=creator_rows,
    )


_MONTHS = {
    name: number
    for number, name in enumerate(
        ("jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"),
        start=1,
    )
}


def _xml_text(parent: ET.Element, path: str) -> str | None:
    """Text of the first match, markup flattened (``<i>``, ``<sup>``), stripped; None if empty."""
    node = parent.find(path)
    if node is None:
        return None
    return _clean("".join(node.itertext()))


def _xml_texts(parent: ET.Element, path: str) -> list[str] | None:
    texts = [t for node in parent.findall(path) if (t := _clean("".join(node.itertext())))]
    return texts or None


def _pubmed_month(value: str | None) -> int | None:
    if not value:
        return None
    if value.isdigit():
        month = int(value)
        return month if 1 <= month <= 12 else None
    return _MONTHS.get(value[:3].lower())


def _pubmed_day(value: str | None) -> int | None:
    if not value or not value.isdigit():
        return None
    day = int(value)
    return day if 1 <= day <= 31 else None


def _pubmed_abstract(article: ET.Element) -> str | None:
    parts: list[str] = []
    for node in article.findall("Abstract/AbstractText"):
        text = _clean("".join(node.itertext()))
        if not text:
            continue
        label = _clean(node.get("Label"))
        parts.append(f"{label}: {text}" if label else text)
    return "\n\n".join(parts) or None


def _pubmed_authors(article: ET.Element) -> list[str] | None:
    authors: list[str] = []
    for node in article.findall("AuthorList/Author"):
        collective = _xml_text(node, "CollectiveName")
        if collective:
            authors.append(collective)
            continue
        last = _xml_text(node, "LastName")
        if not last:
            continue
        initials = _xml_text(node, "Initials")
        authors.append(f"{last}, {initials}" if initials else last)
    return authors or None


# A translation marker, not a study design: never the article's type.
_NOT_AN_ARTICLE_TYPE = "English Abstract"


def _pubmed_article_type(article: ET.Element) -> str | None:
    """The first ``PublicationType`` that names a type; None when there is none."""
    types = _xml_texts(article, "PublicationTypeList/PublicationType") or []
    return next((t for t in types if t != _NOT_AN_ARTICLE_TYPE), None)


# Fields a PubMed fetch may fill on an article another source created, only
# where blank. ``authors`` is deliberately absent (spec-gate #16).
PUBMED_FILL_FIELDS = (
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


def normalize_pubmed_record(*, record: ET.Element) -> CanonicalArticlePayload:
    """Map one efetch ``<PubmedArticle>`` to the canonical article payload."""
    citation = record.find("MedlineCitation")
    article = citation.find("Article") if citation is not None else None
    if citation is None or article is None:
        raise ValueError("PubmedArticle without MedlineCitation/Article")

    pmid = _xml_text(citation, "PMID")
    doi = normalize_doi(
        _xml_text(article, "ELocationID[@EIdType='doi']")
        or _xml_text(record, "PubmedData/ArticleIdList/ArticleId[@IdType='doi']")
    )
    # Direct child list only: ReferenceList entries carry their own ArticleIdList.
    pmcid = _xml_text(record, "PubmedData/ArticleIdList/ArticleId[@IdType='pmc']")

    pub_date = article.find("Journal/JournalIssue/PubDate")
    year: int | None = None
    month: int | None = None
    day: int | None = None
    if pub_date is not None:
        year_text = _xml_text(pub_date, "Year")
        year = int(year_text) if year_text and year_text.isdigit() else None
        if year is None:
            year = extract_year(_xml_text(pub_date, "MedlineDate"))
        month = _pubmed_month(_xml_text(pub_date, "Month"))
        day = _pubmed_day(_xml_text(pub_date, "Day"))

    article_fields: dict[str, Any] = {
        "title": _xml_text(article, "ArticleTitle") or "Untitled",
        "abstract": _pubmed_abstract(article),
        "authors": _pubmed_authors(article),
        "journal_title": _xml_text(article, "Journal/Title"),
        "publication_year": year,
        "publication_month": month,
        "publication_day": day,
        "volume": _xml_text(article, "Journal/JournalIssue/Volume"),
        "issue": _xml_text(article, "Journal/JournalIssue/Issue"),
        "pages": _xml_text(article, "Pagination/MedlinePgn"),
        "doi": doi,
        "pmid": pmid,
        "pmcid": pmcid,
        "mesh_terms": _xml_texts(citation, "MeshHeadingList/MeshHeading/DescriptorName"),
        "keywords": _xml_texts(citation, "KeywordList/Keyword"),
        "article_type": _pubmed_article_type(article),
        "language": _xml_text(article, "Language"),
        "ingestion_source": "pubmed",
        "source_lineage": "pubmed",
        "source_payload": {"efetch_xml": ET.tostring(record, encoding="unicode")},
    }
    return CanonicalArticlePayload(
        canonical_identity={"pmid": pmid, "doi": doi, "url_landing": None},
        article_fields=article_fields,
        creator_rows=[],
    )
