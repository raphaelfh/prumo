"""
Canonical normalization for article ingestion sources.
"""

from __future__ import annotations

import re
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
    source_lineage: str


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
        "authors": [row["display_name"] for row in creator_rows if row["creator_type"] == "author"] or None,
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
        source_lineage="zotero",
    )


def normalize_ris_entry(entry: dict[str, Any]) -> CanonicalArticlePayload:
    doi = normalize_doi(entry.get("doi"))
    url_landing = normalize_url(entry.get("url"))
    creators = entry.get("authors") or []
    creator_rows = [
        {
            "creator_type": "author",
            "display_name": str(name).strip(),
            "raw": {"name": name},
        }
        for name in creators
        if str(name).strip()
    ]
    article_fields: dict[str, Any] = {
        "title": entry.get("title") or "Untitled",
        "abstract": entry.get("abstract"),
        "publication_year": entry.get("year"),
        "journal_title": entry.get("journal"),
        "doi": doi,
        "url_landing": url_landing,
        "authors": [row["display_name"] for row in creator_rows] or None,
        "keywords": entry.get("keywords"),
        "ingestion_source": "ris",
        "source_payload": entry,
        "sync_state": "active",
        "source_lineage": "ris",
    }
    return CanonicalArticlePayload(
        canonical_identity={"zotero_item_key": None, "doi": doi, "url_landing": url_landing},
        article_fields=article_fields,
        creator_rows=creator_rows,
        source_lineage="ris",
    )


def normalize_manual_entry(entry: dict[str, Any]) -> CanonicalArticlePayload:
    doi = normalize_doi(entry.get("doi"))
    url_landing = normalize_url(entry.get("url_landing"))
    authors = entry.get("authors") or []
    creator_rows = [
        {"creator_type": "author", "display_name": str(name).strip(), "raw": {"name": name}}
        for name in authors
        if str(name).strip()
    ]
    article_fields: dict[str, Any] = {
        "title": entry.get("title") or "Untitled",
        "abstract": entry.get("abstract"),
        "publication_year": entry.get("publication_year"),
        "journal_title": entry.get("journal_title"),
        "doi": doi,
        "url_landing": url_landing,
        "authors": [row["display_name"] for row in creator_rows] or None,
        "ingestion_source": "manual",
        "source_payload": entry,
        "sync_state": "active",
        "source_lineage": "manual",
    }
    return CanonicalArticlePayload(
        canonical_identity={"zotero_item_key": None, "doi": doi, "url_landing": url_landing},
        article_fields=article_fields,
        creator_rows=creator_rows,
        source_lineage="manual",
    )
