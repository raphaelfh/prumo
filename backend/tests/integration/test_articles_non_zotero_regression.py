from app.services.article_source_normalization import normalize_manual_entry


def test_manual_import_keeps_manual_source() -> None:
    payload = normalize_manual_entry(
        {
            "title": "Manual article",
            "doi": "10.1234/manual",
            "authors": ["Manual Author"],
        }
    )
    assert payload.article_fields["ingestion_source"] == "manual"
    assert payload.article_fields.get("zotero_item_key") is None
