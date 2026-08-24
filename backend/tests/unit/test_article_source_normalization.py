from app.services.article_source_normalization import normalize_zotero_item


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
