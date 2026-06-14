"""Pure validation tests for ``app.schemas.zotero``.

Wire shapes for SaveCredentialsResponse, TestConnectionResponse and
DownloadAttachmentResponse are pinned in ``test_typed_envelope_schemas.py``;
this file targets the untested surface: request-field constraints,
Literal fields, aliases + populate_by_name round-trips, ``extra='allow'``
preservation, and light construction of the remaining response DTOs.

NOTE: ``TestConnection*`` classes carry a ``Test`` prefix, which makes
pytest emit a harmless PytestCollectionWarning on import. That is
expected (see test_typed_envelope_schemas.py) and not worked around.
"""

from datetime import datetime

import pytest
from pydantic import TypeAdapter, ValidationError

from app.schemas.zotero import (
    DownloadAttachmentRequest,
    FetchAttachmentsRequest,
    FetchAttachmentsResponse,
    FetchItemsRequest,
    FetchItemsResponse,
    ImportResult,
    ImportToProjectRequest,
    ImportToProjectResponse,
    ListCollectionsResponse,
    SaveCredentialsRequest,
    SaveCredentialsResponse,
    SyncCollectionRequest,
    SyncCollectionResponse,
    SyncCountsResponse,
    SyncItemResultEntry,
    SyncItemResultRequest,
    SyncItemResultsResponse,
    SyncRetryFailedRequest,
    SyncRetryFailedResponse,
    SyncStatusRequest,
    SyncStatusResponse,
    TestConnectionResponse,
    ZoteroActionData,
    ZoteroAttachment,
    ZoteroCollection,
    ZoteroCreator,
    ZoteroItem,
    ZoteroItemData,
)

# =================== REQUEST SCHEMAS ===================


class TestSaveCredentialsRequest:
    def test_valid_with_aliases(self) -> None:
        req = SaveCredentialsRequest.model_validate(
            {"zoteroUserId": "12345", "apiKey": "secret", "libraryType": "user"}
        )
        assert req.zotero_user_id == "12345"
        assert req.api_key == "secret"
        assert req.library_type == "user"

    def test_populate_by_name(self) -> None:
        req = SaveCredentialsRequest.model_validate(
            {"zotero_user_id": "1", "api_key": "k", "library_type": "group"}
        )
        assert req.library_type == "group"

    def test_dump_by_alias(self) -> None:
        req = SaveCredentialsRequest.model_validate(
            {"zoteroUserId": "1", "apiKey": "k", "libraryType": "user"}
        )
        wire = req.model_dump(by_alias=True)
        assert wire == {"zoteroUserId": "1", "apiKey": "k", "libraryType": "user"}

    def test_empty_zotero_user_id_rejected(self) -> None:
        with pytest.raises(ValidationError):
            SaveCredentialsRequest.model_validate(
                {"zoteroUserId": "", "apiKey": "k", "libraryType": "user"}
            )

    def test_empty_api_key_rejected(self) -> None:
        with pytest.raises(ValidationError):
            SaveCredentialsRequest.model_validate(
                {"zoteroUserId": "1", "apiKey": "", "libraryType": "user"}
            )

    @pytest.mark.parametrize("library_type", ["user", "group"])
    def test_valid_library_types(self, library_type: str) -> None:
        req = SaveCredentialsRequest.model_validate(
            {"zoteroUserId": "1", "apiKey": "k", "libraryType": library_type}
        )
        assert req.library_type == library_type

    def test_bad_library_type_rejected(self) -> None:
        with pytest.raises(ValidationError):
            SaveCredentialsRequest.model_validate(
                {"zoteroUserId": "1", "apiKey": "k", "libraryType": "shared"}
            )


class TestFetchItemsRequest:
    def test_defaults(self) -> None:
        req = FetchItemsRequest.model_validate({"collectionKey": "C1"})
        assert req.limit == 100
        assert req.start == 0

    def test_populate_by_name(self) -> None:
        req = FetchItemsRequest.model_validate({"collection_key": "C1"})
        assert req.collection_key == "C1"

    def test_empty_collection_key_rejected(self) -> None:
        with pytest.raises(ValidationError):
            FetchItemsRequest.model_validate({"collectionKey": ""})

    def test_limit_lower_boundary_accepted(self) -> None:
        assert FetchItemsRequest.model_validate({"collectionKey": "C", "limit": 1}).limit == 1

    def test_limit_upper_boundary_accepted(self) -> None:
        assert FetchItemsRequest.model_validate({"collectionKey": "C", "limit": 100}).limit == 100

    def test_limit_zero_rejected(self) -> None:
        with pytest.raises(ValidationError):
            FetchItemsRequest.model_validate({"collectionKey": "C", "limit": 0})

    def test_limit_above_max_rejected(self) -> None:
        with pytest.raises(ValidationError):
            FetchItemsRequest.model_validate({"collectionKey": "C", "limit": 101})

    def test_start_lower_boundary_accepted(self) -> None:
        assert FetchItemsRequest.model_validate({"collectionKey": "C", "start": 0}).start == 0

    def test_start_negative_rejected(self) -> None:
        with pytest.raises(ValidationError):
            FetchItemsRequest.model_validate({"collectionKey": "C", "start": -1})


class TestFetchAttachmentsRequest:
    def test_valid_with_alias(self) -> None:
        req = FetchAttachmentsRequest.model_validate({"itemKey": "I1"})
        assert req.item_key == "I1"

    def test_populate_by_name(self) -> None:
        assert FetchAttachmentsRequest.model_validate({"item_key": "I1"}).item_key == "I1"

    def test_empty_item_key_rejected(self) -> None:
        with pytest.raises(ValidationError):
            FetchAttachmentsRequest.model_validate({"itemKey": ""})


class TestDownloadAttachmentRequest:
    def test_valid_with_alias(self) -> None:
        req = DownloadAttachmentRequest.model_validate({"attachmentKey": "A1"})
        assert req.attachment_key == "A1"

    def test_empty_attachment_key_rejected(self) -> None:
        with pytest.raises(ValidationError):
            DownloadAttachmentRequest.model_validate({"attachmentKey": ""})


class TestImportToProjectRequest:
    def test_defaults(self) -> None:
        req = ImportToProjectRequest.model_validate({"projectId": "p1", "collectionKey": "C1"})
        assert req.item_keys == []
        assert req.import_pdfs is True

    def test_full_with_aliases_round_trip(self) -> None:
        req = ImportToProjectRequest.model_validate(
            {
                "projectId": "p1",
                "collectionKey": "C1",
                "itemKeys": ["a", "b"],
                "importPdfs": False,
            }
        )
        assert req.item_keys == ["a", "b"]
        wire = req.model_dump(by_alias=True)
        assert wire["itemKeys"] == ["a", "b"]
        assert wire["importPdfs"] is False


class TestSyncCollectionRequest:
    def test_defaults(self) -> None:
        req = SyncCollectionRequest.model_validate({"projectId": "p1", "collectionKey": "C1"})
        assert req.max_items == 1000
        assert req.include_attachments is True
        assert req.update_existing is True

    def test_empty_collection_key_rejected(self) -> None:
        with pytest.raises(ValidationError):
            SyncCollectionRequest.model_validate({"projectId": "p1", "collectionKey": ""})

    def test_max_items_lower_boundary_accepted(self) -> None:
        req = SyncCollectionRequest.model_validate(
            {"projectId": "p1", "collectionKey": "C", "maxItems": 1}
        )
        assert req.max_items == 1

    def test_max_items_upper_boundary_accepted(self) -> None:
        req = SyncCollectionRequest.model_validate(
            {"projectId": "p1", "collectionKey": "C", "maxItems": 10000}
        )
        assert req.max_items == 10000

    def test_max_items_zero_rejected(self) -> None:
        with pytest.raises(ValidationError):
            SyncCollectionRequest.model_validate(
                {"projectId": "p1", "collectionKey": "C", "maxItems": 0}
            )

    def test_max_items_above_max_rejected(self) -> None:
        with pytest.raises(ValidationError):
            SyncCollectionRequest.model_validate(
                {"projectId": "p1", "collectionKey": "C", "maxItems": 10001}
            )


class TestSyncStatusRequest:
    def test_construction(self) -> None:
        req = SyncStatusRequest.model_validate({"syncRunId": "s1"})
        assert req.sync_run_id == "s1"


class TestSyncRetryFailedRequest:
    def test_default_limit(self) -> None:
        req = SyncRetryFailedRequest.model_validate({"syncRunId": "s1"})
        assert req.limit == 100

    def test_limit_lower_boundary_accepted(self) -> None:
        assert SyncRetryFailedRequest.model_validate({"syncRunId": "s", "limit": 1}).limit == 1

    def test_limit_upper_boundary_accepted(self) -> None:
        assert (
            SyncRetryFailedRequest.model_validate({"syncRunId": "s", "limit": 1000}).limit == 1000
        )

    def test_limit_zero_rejected(self) -> None:
        with pytest.raises(ValidationError):
            SyncRetryFailedRequest.model_validate({"syncRunId": "s", "limit": 0})

    def test_limit_above_max_rejected(self) -> None:
        with pytest.raises(ValidationError):
            SyncRetryFailedRequest.model_validate({"syncRunId": "s", "limit": 1001})


class TestSyncItemResultRequest:
    def test_defaults(self) -> None:
        req = SyncItemResultRequest.model_validate({"syncRunId": "s1"})
        assert req.offset == 0
        assert req.limit == 50
        assert req.status_filter is None

    def test_offset_lower_boundary_accepted(self) -> None:
        assert SyncItemResultRequest.model_validate({"syncRunId": "s", "offset": 0}).offset == 0

    def test_offset_negative_rejected(self) -> None:
        with pytest.raises(ValidationError):
            SyncItemResultRequest.model_validate({"syncRunId": "s", "offset": -1})

    def test_limit_lower_boundary_accepted(self) -> None:
        assert SyncItemResultRequest.model_validate({"syncRunId": "s", "limit": 1}).limit == 1

    def test_limit_upper_boundary_accepted(self) -> None:
        assert SyncItemResultRequest.model_validate({"syncRunId": "s", "limit": 200}).limit == 200

    def test_limit_zero_rejected(self) -> None:
        with pytest.raises(ValidationError):
            SyncItemResultRequest.model_validate({"syncRunId": "s", "limit": 0})

    def test_limit_above_max_rejected(self) -> None:
        with pytest.raises(ValidationError):
            SyncItemResultRequest.model_validate({"syncRunId": "s", "limit": 201})


# =================== RESPONSE / DATA SCHEMAS ===================


class TestZoteroCreator:
    def test_valid_with_aliases(self) -> None:
        creator = ZoteroCreator.model_validate(
            {"creatorType": "author", "firstName": "Ada", "lastName": "Lovelace"}
        )
        assert creator.creator_type == "author"
        assert creator.first_name == "Ada"
        wire = creator.model_dump(by_alias=True)
        assert wire["creatorType"] == "author"
        assert wire["firstName"] == "Ada"

    def test_corporate_author_name_only(self) -> None:
        creator = ZoteroCreator.model_validate({"creatorType": "author", "name": "ACME Corp"})
        assert creator.name == "ACME Corp"
        assert creator.first_name is None


class TestZoteroItemData:
    def test_valid_with_aliases(self) -> None:
        data = ZoteroItemData.model_validate(
            {"key": "K", "version": 1, "itemType": "journalArticle", "DOI": "10.1/x"}
        )
        assert data.item_type == "journalArticle"
        assert data.doi == "10.1/x"

    def test_populate_by_name(self) -> None:
        data = ZoteroItemData.model_validate(
            {"key": "K", "version": 1, "item_type": "journalArticle"}
        )
        assert data.item_type == "journalArticle"

    def test_dump_by_alias(self) -> None:
        data = ZoteroItemData.model_validate(
            {
                "key": "K",
                "version": 1,
                "itemType": "journalArticle",
                "abstractNote": "abs",
                "publicationTitle": "Nature",
                "ISSN": "1234-5678",
            }
        )
        wire = data.model_dump(by_alias=True)
        assert wire["itemType"] == "journalArticle"
        assert wire["abstractNote"] == "abs"
        assert wire["publicationTitle"] == "Nature"
        assert wire["ISSN"] == "1234-5678"

    def test_extra_field_preserved(self) -> None:
        data = ZoteroItemData.model_validate(
            {"key": "K", "version": 1, "itemType": "book", "extraField": "kept"}
        )
        dumped = data.model_dump()
        assert dumped["extraField"] == "kept"

    def test_nested_creators(self) -> None:
        data = ZoteroItemData.model_validate(
            {
                "key": "K",
                "version": 1,
                "itemType": "journalArticle",
                "creators": [{"creatorType": "author", "lastName": "Turing"}],
            }
        )
        assert data.creators[0].last_name == "Turing"


class TestZoteroItem:
    def test_valid_construction(self) -> None:
        item = ZoteroItem.model_validate(
            {
                "key": "K",
                "version": 1,
                "library": {"id": 1},
                "data": {"key": "K", "version": 1, "itemType": "book"},
            }
        )
        assert item.links == {}
        assert item.meta == {}
        assert item.data.item_type == "book"

    def test_extra_field_preserved(self) -> None:
        item = ZoteroItem.model_validate(
            {
                "key": "K",
                "version": 1,
                "library": {"id": 1},
                "data": {"key": "K", "version": 1, "itemType": "book"},
                "topLevel": "kept",
            }
        )
        assert item.model_dump()["topLevel"] == "kept"


class TestZoteroCollection:
    def test_valid_with_aliases(self) -> None:
        col = ZoteroCollection.model_validate(
            {
                "key": "C",
                "version": 1,
                "name": "Refs",
                "parentCollection": "P",
                "numItems": 5,
                "numCollections": 2,
            }
        )
        assert col.parent_collection == "P"
        assert col.num_items == 5
        wire = col.model_dump(by_alias=True)
        assert wire["parentCollection"] == "P"
        assert wire["numItems"] == 5
        assert wire["numCollections"] == 2

    def test_populate_by_name(self) -> None:
        col = ZoteroCollection.model_validate(
            {"key": "C", "version": 1, "name": "Refs", "num_items": 3}
        )
        assert col.num_items == 3

    def test_extra_field_preserved(self) -> None:
        col = ZoteroCollection.model_validate(
            {"key": "C", "version": 1, "name": "Refs", "extraField": "kept"}
        )
        assert col.model_dump()["extraField"] == "kept"


class TestZoteroAttachment:
    def test_valid_with_aliases(self) -> None:
        att = ZoteroAttachment.model_validate(
            {
                "key": "A",
                "version": 1,
                "linkMode": "imported_file",
                "contentType": "application/pdf",
            }
        )
        assert att.link_mode == "imported_file"
        assert att.content_type == "application/pdf"
        wire = att.model_dump(by_alias=True)
        assert wire["linkMode"] == "imported_file"
        assert wire["contentType"] == "application/pdf"

    def test_populate_by_name(self) -> None:
        att = ZoteroAttachment.model_validate({"key": "A", "version": 1, "link_mode": "linked_url"})
        assert att.link_mode == "linked_url"

    def test_extra_field_preserved(self) -> None:
        att = ZoteroAttachment.model_validate(
            {"key": "A", "version": 1, "linkMode": "imported_file", "extraField": "kept"}
        )
        assert att.model_dump()["extraField"] == "kept"


class TestResponseDTOs:
    def test_save_credentials_response(self) -> None:
        assert (
            SaveCredentialsResponse.model_validate({"integration_id": "i1"}).integration_id == "i1"
        )

    def test_test_connection_response_defaults(self) -> None:
        resp = TestConnectionResponse.model_validate({"success": True})
        assert resp.access == {}
        assert resp.user_name is None
        assert resp.error is None

    def test_list_collections_response(self) -> None:
        resp = ListCollectionsResponse.model_validate({"collections": [{"key": "C"}]})
        assert resp.collections[0]["key"] == "C"

    def test_fetch_items_response_defaults(self) -> None:
        resp = FetchItemsResponse.model_validate({"items": []})
        assert resp.total_results is None
        assert resp.has_more is False

    def test_fetch_attachments_response(self) -> None:
        resp = FetchAttachmentsResponse.model_validate({"attachments": []})
        assert resp.attachments == []

    def test_import_result_defaults(self) -> None:
        result = ImportResult.model_validate({"zotero_key": "Z", "success": True})
        assert result.article_id is None
        assert result.pdf_imported is False

    def test_import_to_project_response(self) -> None:
        resp = ImportToProjectResponse.model_validate(
            {
                "total_items": 1,
                "imported": 1,
                "failed": 0,
                "results": [{"zotero_key": "Z", "success": True}],
            }
        )
        assert isinstance(resp.results[0], ImportResult)

    def test_sync_collection_response_alias(self) -> None:
        resp = SyncCollectionResponse.model_validate(
            {"syncRunId": "s1", "status": "queued", "message": "ok"}
        )
        assert resp.sync_run_id == "s1"
        assert resp.model_dump(by_alias=True)["syncRunId"] == "s1"

    def test_sync_counts_response_aliases(self) -> None:
        counts = SyncCountsResponse.model_validate(
            {
                "totalReceived": 10,
                "persisted": 5,
                "updated": 2,
                "skipped": 1,
                "failed": 1,
                "removedAtSource": 1,
                "reactivated": 0,
            }
        )
        assert counts.total_received == 10
        assert counts.removed_at_source == 1
        wire = counts.model_dump(by_alias=True)
        assert wire["totalReceived"] == 10
        assert wire["removedAtSource"] == 1

    def test_sync_status_response_with_datetimes(self) -> None:
        resp = SyncStatusResponse.model_validate(
            {
                "syncRunId": "s1",
                "status": "completed",
                "counts": {
                    "totalReceived": 0,
                    "persisted": 0,
                    "updated": 0,
                    "skipped": 0,
                    "failed": 0,
                    "removedAtSource": 0,
                    "reactivated": 0,
                },
                "startedAt": "2026-06-13T00:00:00Z",
                "traceId": "t1",
            }
        )
        assert isinstance(resp.started_at, datetime)
        assert resp.completed_at is None
        assert isinstance(resp.counts, SyncCountsResponse)

    def test_sync_retry_failed_response_aliases(self) -> None:
        resp = SyncRetryFailedResponse.model_validate(
            {"syncRunId": "s2", "retryOfSyncRunId": "s1", "queuedItems": 3}
        )
        assert resp.retry_of_sync_run_id == "s1"
        assert resp.queued_items == 3

    def test_sync_item_result_entry_aliases(self) -> None:
        entry = SyncItemResultEntry.model_validate(
            {
                "zoteroItemKey": "Z",
                "articleId": "a1",
                "status": "persisted",
                "errorCode": None,
                "errorMessage": None,
                "authorityRuleApplied": None,
                "processedAt": "2026-06-13T00:00:00Z",
            }
        )
        assert entry.zotero_item_key == "Z"
        assert isinstance(entry.processed_at, datetime)

    def test_sync_item_results_response(self) -> None:
        resp = SyncItemResultsResponse.model_validate(
            {"items": [], "total": 0, "offset": 0, "limit": 50}
        )
        assert resp.items == []
        assert resp.limit == 50


class TestZoteroActionDataUnion:
    def test_union_narrows_to_save_credentials(self) -> None:
        adapter = TypeAdapter(ZoteroActionData)
        parsed = adapter.validate_python({"integration_id": "i1"})
        assert isinstance(parsed, SaveCredentialsResponse)

    def test_union_narrows_to_fetch_items(self) -> None:
        adapter = TypeAdapter(ZoteroActionData)
        parsed = adapter.validate_python({"items": [], "total_results": 0, "has_more": False})
        assert isinstance(parsed, FetchItemsResponse)
